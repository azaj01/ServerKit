"""Probe catalog lint + index (plan 27 Phase 2, #3/#6).

The shipped catalog must load and lint clean; malformed catalogs must fail loudly
(a survey that quietly checks nothing is worse than a crash), and the index the
UI shows must reflect exactly the catalog's declared locations.

Reconstructed for plan 42 Phase 1 from the clean ``test_survey_catalog`` pyc.
The survey feature SURVIVED but its contract evolved since the pyc was built:
``lint_catalog`` now returns the catalog (not ``True``), required probe fields are
``id/kind/title/reads`` and the operator index publishes ``reads`` (not the old
``locations`` key). The reconstructed positive/index assertions track the current
contract; the reject cases are unchanged (they still raise loudly).
"""
import pytest

from app.services import survey_service
from app.services.survey_service import SurveyError, lint_catalog


def test_shipped_catalog_loads_and_lints():
    catalog = survey_service.load_catalog(force=True)
    assert lint_catalog(catalog) == catalog
    assert catalog['version'] >= 1
    assert isinstance(catalog['probes'], list) and catalog['probes']
    ids = {p['id'] for p in catalog['probes']}
    assert 'foreign-panel' in ids
    assert 'nginx' in ids


def test_catalog_version_and_index_agree():
    idx = survey_service.probe_index()
    assert idx['version'] == survey_service.catalog_version()
    for probe in idx['probes']:
        assert probe['id']
        assert 'title' in probe
        assert 'reads' in probe
    marker = next(p for p in idx['probes'] if p['id'] == 'foreign-panel')
    assert marker['reads'], 'index probe must publish what it reads'


def test_lint_rejects_non_mapping():
    with pytest.raises(SurveyError):
        lint_catalog([])


def test_lint_rejects_bad_version():
    with pytest.raises(SurveyError):
        lint_catalog({'version': 0, 'probes': [{'id': 'x'}]})
    with pytest.raises(SurveyError):
        lint_catalog({'version': 'one', 'probes': [{'id': 'x'}]})


def test_lint_rejects_empty_probes():
    with pytest.raises(SurveyError):
        lint_catalog({'version': 1, 'probes': []})


def test_lint_rejects_duplicate_ids():
    with pytest.raises(SurveyError):
        lint_catalog({'version': 1, 'probes': [{'id': 'a'}, {'id': 'a'}]})


def test_lint_rejects_missing_id():
    with pytest.raises(SurveyError):
        lint_catalog({'version': 1, 'probes': [{'kind': 'service'}]})


def test_lint_rejects_unknown_detect_key():
    with pytest.raises(SurveyError):
        lint_catalog({'version': 1, 'probes': [{'id': 'a', 'detect': {'exec': 'rm -rf /'}}]})


def test_lint_rejects_marker_without_paths():
    with pytest.raises(SurveyError):
        lint_catalog({'version': 1, 'probes': [
            {'id': 'panel', 'kind': 'marker', 'detect': {'units': ['x']}}]})


def test_lint_accepts_valid_minimal_catalog():
    catalog = {
        'version': 2,
        'probes': [
            {'id': 'nginx', 'kind': 'service+config', 'title': 'Nginx',
             'reads': 'service status + vhosts',
             'detect': {'ports': [80], 'units': ['nginx']},
             'map': {'vhosts': ['/etc/nginx/sites-enabled/*']}},
            {'id': 'panel', 'kind': 'marker', 'title': 'Other panel',
             'reads': 'marker directories',
             'detect': {'paths': ['/usr/local/cpanel']}},
        ],
    }
    assert lint_catalog(catalog) == catalog
