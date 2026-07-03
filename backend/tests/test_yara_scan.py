"""Proving tests for the YARA web-shell pass (YaraScanService).

Fixture "malware" files contain fragment-assembled indicator strings only —
they never execute and are planted in tmp_path. The pure-Python fallback
matcher is forced (yara CLI patched absent) so these run on any OS.
"""
import os
from unittest.mock import patch

import pytest

from app.services.yara_scan_service import YaraScanService


# Assemble indicators from fragments so this test file doesn't itself carry
# literal signatures.
EVAL_B64 = 'eval(' + 'base64_' + 'decode' + '($x));'
GZ_B64 = 'gzinflate(' + 'base64_' + 'decode' + '($y));'
PHP_TAG = '<?' + 'php'
APF = 'auto_prepend_' + 'file'
FMAN = 'Files' + 'Man'


@pytest.fixture(autouse=True)
def force_fallback():
    """Force the pure-Python engine regardless of the host having yara."""
    with patch('app.services.yara_scan_service.is_command_available', return_value=False):
        yield


@pytest.fixture
def docroot(tmp_path):
    (tmp_path / 'shell.php').write_text(f'{PHP_TAG}\n{EVAL_B64}\n')
    (tmp_path / 'packed.php').write_text(f'{PHP_TAG} {GZ_B64}')
    (tmp_path / 'clean.php').write_text(
        f'{PHP_TAG}\necho "hello";\n$data = base64_encode("ok");\n')
    (tmp_path / 'favicon.ico').write_text(f'{PHP_TAG} echo 1;')
    (tmp_path / '.htaccess').write_text(f'php_value {APF} "/tmp/x.php"\n')
    (tmp_path / 'dropper.php').write_text(
        f'{PHP_TAG}\nmove_uploaded_file($f, $d);\nchmod($d, 0777);\n')
    (tmp_path / 'manager.php').write_text(f'{PHP_TAG} // {FMAN} v2')
    return tmp_path


class TestFallbackMatcher:
    def test_engine_is_fallback_without_yara(self):
        assert YaraScanService.yara_available() is False
        assert YaraScanService.engine() == 'fallback'

    def test_detections_and_severities(self, docroot):
        findings = YaraScanService.scan_path(str(docroot))
        by_rule = {}
        for f in findings:
            by_rule.setdefault(f['rule'], []).append(f)

        assert 'php_eval_base64' in by_rule
        assert by_rule['php_eval_base64'][0]['severity'] == 'critical'
        assert by_rule['php_eval_base64'][0]['file'].endswith('shell.php')

        assert 'php_gzinflate_base64' in by_rule
        assert by_rule['php_gzinflate_base64'][0]['severity'] == 'critical'

        assert 'upload_chmod_777_combo' in by_rule
        assert by_rule['upload_chmod_777_combo'][0]['severity'] == 'high'

        assert 'filesman_marker' in by_rule

        # All findings share the result shape + source tag
        for f in findings:
            assert f['source'] == 'yara'
            assert set(f) >= {'rule', 'severity', 'file', 'matched', 'description'}
            assert len(f['matched']) <= YaraScanService.SNIPPET_CAP

    def test_no_false_positive_on_clean_file(self, docroot):
        findings = YaraScanService.scan_path(str(docroot))
        assert not any(f['file'].endswith('clean.php') for f in findings)

    def test_php_in_image_only_fires_on_images(self, docroot):
        findings = YaraScanService.scan_path(str(docroot))
        img = [f for f in findings if f['rule'] == 'php_in_image']
        assert len(img) == 1
        assert img[0]['file'].endswith('favicon.ico')
        assert img[0]['severity'] == 'high'

    def test_htaccess_auto_prepend_scoped_to_config_files(self, docroot):
        findings = YaraScanService.scan_path(str(docroot))
        apf = [f for f in findings if f['rule'] == 'htaccess_auto_prepend']
        assert len(apf) == 1
        assert os.path.basename(apf[0]['file']) == '.htaccess'

    def test_single_file_scan(self, docroot):
        findings = YaraScanService.scan_path(str(docroot / 'shell.php'))
        assert any(f['rule'] == 'php_eval_base64' for f in findings)

    def test_missing_path_raises(self, tmp_path):
        with pytest.raises(ValueError):
            YaraScanService.scan_path(str(tmp_path / 'nope'))

    def test_matched_snippet_capped(self, tmp_path):
        payload = 'eval(   ' + 'base64_' + 'decode' + '(' + 'A' * 500 + '));'
        (tmp_path / 'big.php').write_text(f'{PHP_TAG} {payload}')
        findings = YaraScanService.scan_path(str(tmp_path))
        assert findings
        assert all(len(f['matched']) <= YaraScanService.SNIPPET_CAP for f in findings)


class TestCliOutputParser:
    def test_parse_rule_and_snippet_lines(self):
        out = (
            'php_eval_base64 /var/www/site/shell.php\n'
            '0x1c:$a: ' + 'eval(base64_' + 'decode' + '(\n'
            'custom_rule_x /var/www/site/other.php\n'
        )
        findings = YaraScanService._parse_cli_output(out)
        assert findings[0]['rule'] == 'php_eval_base64'
        assert findings[0]['severity'] == 'critical'
        assert findings[0]['matched'].startswith('eval(')
        # Unknown (custom) rules get a default severity
        assert findings[1]['rule'] == 'custom_rule_x'
        assert findings[1]['severity'] == 'medium'


class TestCustomRulesManagement:
    @pytest.fixture(autouse=True)
    def custom_dir(self, tmp_path):
        with patch.object(YaraScanService, 'CUSTOM_RULES_DIR', str(tmp_path / 'custom')):
            yield tmp_path / 'custom'

    def test_save_and_list_and_delete(self, custom_dir):
        content = 'rule my_rule { strings: $a = "abc" condition: $a }'
        result = YaraScanService.save_custom_rule('mine.yar', content)
        assert result['success'] is True
        listing = YaraScanService.list_rules()
        assert listing['builtin_count'] >= 10
        assert any(c['name'] == 'mine.yar' for c in listing['custom'])
        assert listing['engine'] == 'fallback'

        deleted = YaraScanService.delete_custom_rule('mine.yar')
        assert deleted['success'] is True
        assert not (custom_dir / 'mine.yar').exists()

    def test_rejects_non_yar_extension(self):
        result = YaraScanService.save_custom_rule('evil.php', 'rule x {condition: true}')
        assert result['success'] is False
        assert '.yar' in result['error']

    def test_rejects_oversized_rule(self):
        content = 'rule big { condition: true } //' + 'x' * (YaraScanService.MAX_CUSTOM_RULE_SIZE + 1)
        result = YaraScanService.save_custom_rule('big.yar', content)
        assert result['success'] is False

    def test_rejects_path_traversal_names(self):
        assert YaraScanService.save_custom_rule('../esc.yar', 'rule x {condition: true}')['success'] is False
        assert YaraScanService.delete_custom_rule('../../etc.yar')['success'] is False

    def test_rejects_non_rule_content(self):
        result = YaraScanService.save_custom_rule('junk.yar', 'just some text')
        assert result['success'] is False


class TestYaraRulesApi:
    @pytest.fixture(autouse=True)
    def custom_dir(self, tmp_path):
        with patch.object(YaraScanService, 'CUSTOM_RULES_DIR', str(tmp_path / 'custom')):
            yield

    def test_list_requires_auth(self, client):
        resp = client.get('/api/v1/security/yara/rules')
        assert resp.status_code in (401, 422)

    def test_list_rules(self, client, auth_headers):
        resp = client.get('/api/v1/security/yara/rules', headers=auth_headers)
        assert resp.status_code == 200
        body = resp.get_json()
        assert body['builtin_count'] >= 10
        assert any(r['name'] == 'php_eval_base64' for r in body['builtin'])

    def test_upload_rejects_php(self, client, auth_headers):
        resp = client.post('/api/v1/security/yara/rules', headers=auth_headers,
                           json={'filename': 'shell.php', 'content': 'rule x {condition: true}'})
        assert resp.status_code == 400
        assert 'error' in resp.get_json()

    def test_upload_and_delete_roundtrip(self, client, auth_headers):
        resp = client.post('/api/v1/security/yara/rules', headers=auth_headers,
                           json={'filename': 'ops.yar',
                                 'content': 'rule ops { strings: $a = "zz" condition: $a }'})
        assert resp.status_code == 200

        resp = client.get('/api/v1/security/yara/rules', headers=auth_headers)
        assert any(c['name'] == 'ops.yar' for c in resp.get_json()['custom'])

        resp = client.delete('/api/v1/security/yara/rules/ops.yar', headers=auth_headers)
        assert resp.status_code == 200
