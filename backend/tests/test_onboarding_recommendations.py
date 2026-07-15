"""Plan 47 Phase 1 — the setup wizard installs what it recommends.

Proves the use-case → extension-slug map has no dead slugs, the recommendation
resolver/endpoint returns real extension metadata, complete-onboarding persists
what the wizard installed, and wizard-optional flagships (WordPress) are gated on
fresh installs but kept on completed-setup ones.
"""
import pytest

from app import db
from app.models.plugin import InstalledPlugin
from app.models.user import User
from app.services import plugin_service as ps
from app.services.settings_service import SettingsService
from werkzeug.security import generate_password_hash
from flask_jwt_extended import create_access_token


# ── map integrity ────────────────────────────────────────────────────────────

def test_recommendation_map_has_no_dead_slugs(app):
    """Every slug in the use-case map resolves to a builtin or registry entry."""
    with app.app_context():
        index = ps._recommendation_index()
        dead = [
            slug
            for slugs in ps.RECOMMENDED_EXTENSIONS_BY_USE_CASE.values()
            for slug in slugs
            if slug not in index
        ]
        assert dead == [], f'recommendation map points at dead slugs: {dead}'


def test_recommend_resolves_and_dedupes(app):
    with app.app_context():
        recs = ps.recommend_extensions_for_use_cases(['web-apps', 'devops'])
        slugs = [r['slug'] for r in recs]
        # git appears in both use cases — must be de-duped, first-seen order kept
        assert slugs.count('serverkit-git') == 1
        assert 'serverkit-status' in slugs
        assert 'serverkit-k8s' in slugs
        assert 'serverkit-tramo' in slugs
        # every entry carries real metadata (not just a display string)
        for r in recs:
            assert r['display_name']
            assert r['source'] in ('builtin', 'registry')
            assert 'installed' in r


def test_recommend_empty_use_cases(app):
    with app.app_context():
        assert ps.recommend_extensions_for_use_cases([]) == []
        assert ps.recommend_extensions_for_use_cases(None) == []


# ── endpoint ─────────────────────────────────────────────────────────────────

def test_recommendations_endpoint(client, auth_headers):
    resp = client.get('/api/v1/plugins/recommendations?use_cases=wordpress',
                       headers=auth_headers)
    assert resp.status_code == 200
    slugs = [r['slug'] for r in resp.get_json()['recommendations']]
    assert 'serverkit-wordpress' in slugs


def test_recommendations_endpoint_requires_auth(client):
    resp = client.get('/api/v1/plugins/recommendations?use_cases=wordpress')
    assert resp.status_code == 401


# ── complete-onboarding persists installed slugs ─────────────────────────────

def test_complete_onboarding_persists_installed_extensions(client, auth_headers):
    resp = client.post('/api/v1/auth/complete-onboarding',
                       json={'use_cases': ['devops'],
                             'installed_extensions': ['serverkit-k8s', 'serverkit-git']},
                       headers=auth_headers)
    assert resp.status_code == 200
    assert SettingsService.get('onboarding_installed_extensions') == [
        'serverkit-k8s', 'serverkit-git']
    assert SettingsService.get('onboarding_use_cases') == ['devops']


def test_complete_onboarding_rejects_bad_installed_extensions(client, auth_headers):
    resp = client.post('/api/v1/auth/complete-onboarding',
                       json={'use_cases': [], 'installed_extensions': 'nope'},
                       headers=auth_headers)
    assert resp.status_code == 400


def test_complete_onboarding_still_completes_without_installs(client, auth_headers):
    """A wizard run that installs nothing (the lean outcome) still finishes."""
    resp = client.post('/api/v1/auth/complete-onboarding',
                       json={'use_cases': []},
                       headers=auth_headers)
    assert resp.status_code == 200
    assert SettingsService.get('setup_completed') is True


# ── wizard-optional flagship gating ──────────────────────────────────────────

def test_finalize_setup_flagships_marks_uninstalled_when_absent(app):
    with app.app_context():
        InstalledPlugin.query.filter_by(slug='serverkit-wordpress').delete()
        db.session.commit()
        ps.finalize_setup_flagships()
        assert 'serverkit-wordpress' in ps._flagship_uninstalled_set()


def test_finalize_setup_flagships_keeps_installed(app):
    with app.app_context():
        # fixture seeds WordPress under the TESTING bypass; finalize must not
        # mark an installed flagship as uninstalled
        assert InstalledPlugin.query.filter_by(slug='serverkit-wordpress').first()
        ps.finalize_setup_flagships()
        assert 'serverkit-wordpress' not in ps._flagship_uninstalled_set()


def test_wordpress_flagship_skipped_on_fresh_install(app):
    """With the TESTING bypass off, a fresh install (no setup) skips WordPress."""
    with app.app_context():
        InstalledPlugin.query.filter_by(slug='serverkit-wordpress').delete()
        db.session.commit()
        app.config['TESTING'] = False
        try:
            assert SettingsService.needs_setup() is True
            ps.seed_flagship_extensions()
            assert InstalledPlugin.query.filter_by(
                slug='serverkit-wordpress').first() is None
            # cloudflare-ops (not wizard-optional) is still seeded
            assert InstalledPlugin.query.filter_by(
                slug='serverkit-cloudflare-ops').first() is not None
        finally:
            app.config['TESTING'] = True


def test_wordpress_flagship_seeded_on_completed_setup(app):
    """An existing/completed-setup install keeps seeding WordPress (no regression)."""
    with app.app_context():
        InstalledPlugin.query.filter_by(slug='serverkit-wordpress').delete()
        db.session.commit()
        user = User(email='a@t.local', username='admin', is_active=True,
                    role=User.ROLE_ADMIN, password_hash=generate_password_hash('x'))
        db.session.add(user)
        db.session.commit()
        SettingsService.complete_setup(user_id=user.id)
        app.config['TESTING'] = False
        try:
            assert SettingsService.needs_setup() is False
            ps.seed_flagship_extensions()
            assert InstalledPlugin.query.filter_by(
                slug='serverkit-wordpress').first() is not None
        finally:
            app.config['TESTING'] = True
