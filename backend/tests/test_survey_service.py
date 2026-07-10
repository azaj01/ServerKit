"""Survey normalization, snapshot storage + diff (plan 27 Phase 2, #5/#6)."""
from app.services import survey_service


# A representative raw agent survey payload (see docs/AGENT_SURVEY_SPEC.md).
FIXTURE_PAYLOAD = {
    'catalog_version': 1,
    'probes': {
        'nginx': {
            'detected': True,
            'service': {'active': True, 'ports': [80, 443]},
            'vhosts': [
                {'server_name': 'example.com', 'root': '/var/www/example', 'upstream': None},
                {'server_name': 'api.example.com', 'root': None, 'upstream': 'http://127.0.0.1:8001'},
            ],
        },
        'apache': {'detected': False},
        'php-fpm': {'detected': True, 'service': {'active': True}},
        'foreign-panel': {'detected': True, 'markers': ['/usr/local/cpanel']},
        'databases': {'detected': True, 'engines': [{'name': 'mysql', 'active': True, 'port': 3306}]},
        'crontabs': {'crontabs': [{'user': 'root', 'lines': ['0 3 * * * /usr/bin/backup']}]},
        'certs': {'certs': [{'domain': 'example.com', 'expires_at': '2026-10-01T00:00:00Z'}]},
        'listeners': {'listeners': [{'port': 80, 'proto': 'tcp', 'process': 'nginx'}]},
    },
}


def test_normalize_produces_canonical_shape():
    m = survey_service.normalize_map(FIXTURE_PAYLOAD)

    assert m['catalog_version'] == 1
    # Services: nginx, php-fpm, databases were detected; apache was not.
    svc_ids = {s['id'] for s in m['services']}
    assert svc_ids == {'nginx', 'php-fpm', 'databases'}

    # Sites come from nginx vhosts, tagged managed_by other-panel (foreign present).
    domains = {s['domain'] for s in m['sites']}
    assert domains == {'example.com', 'api.example.com'}
    api_site = next(s for s in m['sites'] if s['domain'] == 'api.example.com')
    assert api_site['upstream'] == 'http://127.0.0.1:8001'
    assert api_site['managed_by'] == 'other-panel'

    assert m['foreign_panel_detected'] is True
    assert m['foreign_panels'] == [{'marker': '/usr/local/cpanel'}]
    assert m['databases'][0]['engine'] == 'mysql'
    assert m['certs'][0]['domain'] == 'example.com'
    assert m['cron'][0]['user'] == 'root'
    assert m['listeners'][0]['port'] == 80
    assert 'nginx' in m['probes_run']


def test_normalize_is_defensive_on_empty_and_partial():
    assert survey_service.normalize_map({})['services'] == []
    assert survey_service.normalize_map(None)['sites'] == []
    partial = survey_service.normalize_map({'probes': {'nginx': {'detected': True}}})
    assert partial['services'][0]['id'] == 'nginx'
    assert partial['sites'] == []
    assert partial['foreign_panel_detected'] is False


def test_normalize_managed_by_is_stack_when_no_foreign_panel():
    payload = {
        'probes': {
            'nginx': {'detected': True, 'vhosts': [{'server_name': 'a.com', 'root': '/srv/a'}]},
        }
    }
    m = survey_service.normalize_map(payload)
    assert m['sites'][0]['managed_by'] == 'nginx'


def test_diff_maps_detects_added_removed_changed():
    old = survey_service.normalize_map(FIXTURE_PAYLOAD)

    payload2 = {
        'catalog_version': 1,
        'probes': {
            'nginx': {
                'detected': True,
                'service': {'active': True, 'ports': [80, 443]},
                'vhosts': [
                    # example.com doc root changed
                    {'server_name': 'example.com', 'root': '/var/www/new', 'upstream': None},
                    # api.example.com removed; shop.example.com added
                    {'server_name': 'shop.example.com', 'root': '/var/www/shop', 'upstream': None},
                ],
            },
            'foreign-panel': {'detected': True, 'markers': ['/usr/local/cpanel']},
        },
    }
    new = survey_service.normalize_map(payload2)
    diff = survey_service.diff_maps(old, new)

    added = {s['domain'] for s in diff['sites']['added']}
    removed = {s['domain'] for s in diff['sites']['removed']}
    changed = {c['key'] for c in diff['sites']['changed']}
    assert added == {'shop.example.com'}
    assert removed == {'api.example.com'}
    assert changed == {'example.com'}
    assert diff['catalog_changed'] is False


def test_diff_flags_catalog_change():
    old = {'catalog_version': 1, 'sites': []}
    new = {'catalog_version': 2, 'sites': []}
    assert survey_service.diff_maps(old, new)['catalog_changed'] is True


def test_record_and_list_snapshots(app):
    from app import db
    from app.models.server import Server

    with app.app_context():
        server = Server(name='obs-box', permissions=['survey:read'])
        db.session.add(server)
        db.session.commit()
        sid = server.id

        m1 = survey_service.normalize_map(FIXTURE_PAYLOAD)
        s1 = survey_service.record_survey(sid, m1)
        s2 = survey_service.record_survey(sid, m1)

        surveys = survey_service.list_surveys(sid)
        assert len(surveys) == 2
        # Newest first.
        assert surveys[0].id == s2.id
        assert survey_service.latest_survey(sid).id == s2.id
        # Round-trips the map.
        assert s1.get_map()['foreign_panel_detected'] is True
