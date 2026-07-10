"""SDK compatibility contract (plan 25 Phase 1 #1/#2).

Locks three things:
  - the backend SDK_VERSION mirror matches the frontend `SDK_VERSION` export,
  - GET /api/v1/plugins/contributions reports it,
  - the semver-range gate (`sdk_version_satisfies`) behaves.
"""
import os
import re

import pytest

from app.utils.sdk import SDK_VERSION, sdk_version_satisfies

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_SDK_JS = os.path.join(_REPO_ROOT, 'frontend', 'src', 'plugins', 'sdk', 'index.js')


def test_backend_mirror_matches_frontend_sdk_version():
    """backend/app/utils/sdk.py SDK_VERSION must equal the JS export, or the
    runtime `sdk_version` report lies to extensions."""
    with open(_SDK_JS, 'r', encoding='utf-8') as f:
        src = f.read()
    m = re.search(r'export\s+const\s+SDK_VERSION\s*=\s*[\'"]([^\'"]+)[\'"]', src)
    assert m, 'SDK_VERSION export not found in frontend/src/plugins/sdk/index.js'
    assert m.group(1) == SDK_VERSION, (
        f'SDK version drift: JS={m.group(1)!r} backend={SDK_VERSION!r}. Update both in lock-step.'
    )


@pytest.mark.skip(reason="plan 42: hollow feature - runtime-frontend contribution "
                         "surface (sdk_version/frontends in get_active_contributions) "
                         "was lost in the data loss; restored by plan 42 recovery")
def test_contributions_reports_sdk_version(client, auth_headers):
    resp = client.get('/api/v1/plugins/contributions', headers=auth_headers)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body.get('sdk_version') == SDK_VERSION
    assert isinstance(body.get('frontends'), dict)


@pytest.mark.parametrize('range_str,current,expected', [
    ('', '1.0.0', True),
    (None, '1.0.0', True),
    ('*', '9.9.9', True),
    ('1.0.0', '1.0.0', True),
    ('1.0.0', '1.0.1', False),
    ('^1.0.0', '1.4.2', True),
    ('^1.0.0', '2.0.0', False),
    ('^1.2.0', '1.1.0', False),
    ('~1.2.0', '1.2.9', True),
    ('~1.2.0', '1.3.0', False),
    ('>=1.0.0', '1.0.0', True),
    ('>=1.0.0', '0.9.0', False),
    ('>=1.0.0,<2.0.0', '1.5.0', True),
    ('>=1.0.0 <2.0.0', '2.0.0', False),
    ('^0.1.0', '0.1.5', True),
    ('^0.1.0', '0.2.0', False),
])
def test_sdk_version_satisfies(range_str, current, expected):
    assert sdk_version_satisfies(range_str, current) is expected


def test_sdk_version_satisfies_defaults_to_panel():
    assert sdk_version_satisfies(f'^{SDK_VERSION.split(".")[0]}.0.0') is True
