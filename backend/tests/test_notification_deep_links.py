"""Deep links + history filters (plan 24 Phase 5).

Proves the action_path is computed at send time and persisted (so a route move
never breaks old rows), producer overrides win, the inbox category/severity
filters work, and mark-group-read only touches one category.
"""
import pytest
from werkzeug.security import generate_password_hash

from app import db
from app.models import User
from app.models.notification_preferences import NotificationPreferences
from app.notifications import catalog
from app.notifications.models import Notification
from app.notifications.service import NotificationBusService
from app.queue_bus.service import QueueBusService


@pytest.fixture(autouse=True)
def reset_broker(app):
    QueueBusService.reset_broker()


def _make_user(username='alice', email='alice@example.com'):
    user = User(email=email, username=username,
                password_hash=generate_password_hash('x'), role='developer', is_active=True)
    db.session.add(user)
    db.session.commit()
    prefs = NotificationPreferences.get_or_create(user.id)
    prefs.set_severities(['critical', 'warning', 'info', 'success'])
    db.session.commit()
    return user


class TestLinkBuilder:
    def test_catalog_link_persisted_at_send(self, app):
        user = _make_user()
        res = NotificationBusService.send('dns.unresolved', to=user,
                                          data={'count': 2}, severity='warning')
        notif = Notification.query.get(res['notification_id'])
        assert notif.action_path == '/domains'
        assert notif.action_label

    def test_producer_override_wins(self, app):
        user = _make_user()
        res = NotificationBusService.send('backup.completed', to=user, data={'app': 'blog'},
                                          action_path='/backups?policy=7', action_label='Open policy')
        notif = Notification.query.get(res['notification_id'])
        assert notif.action_path == '/backups?policy=7'
        assert notif.action_label == 'Open policy'

    def test_link_survives_a_catalog_route_change(self, app):
        # A row keeps the path it was sent with even if the catalog builder later
        # points elsewhere — old rows never break.
        user = _make_user()
        res = NotificationBusService.send('cron.job_failed', to=user, data={'name': 'nightly'})
        notif = Notification.query.get(res['notification_id'])
        assert notif.action_path == '/cron'

        original = catalog._LINKS['cron.job_failed']
        catalog._LINKS['cron.job_failed'] = '/scheduled-tasks'
        try:
            db.session.refresh(notif)
            assert notif.action_path == '/cron'  # persisted, not recomputed
        finally:
            catalog._LINKS['cron.job_failed'] = original

    def test_unknown_event_has_no_link(self, app):
        user = _make_user()
        res = NotificationBusService.send('totally.unknown', to=user, data={})
        notif = Notification.query.get(res['notification_id'])
        assert notif.action_path is None


class TestHistoryFilters:
    def _seed(self, user):
        NotificationBusService.send('backup.completed', to=user, data={'app': 'a'}, severity='success')
        NotificationBusService.send('security.alert', to=user, data={'message': 'x'}, severity='critical')
        NotificationBusService.send('system.alert', to=user, data={'message': 'y'}, severity='warning')

    def test_category_filter(self, app):
        user = _make_user()
        self._seed(user)
        items = NotificationBusService.inbox(user.id, category='security')
        assert len(items) == 1
        assert items[0]['category'] == 'security'

    def test_severity_filter(self, app):
        user = _make_user()
        self._seed(user)
        items = NotificationBusService.inbox(user.id, severity='critical')
        assert all(i['severity'] == 'critical' for i in items)
        assert len(items) == 1

    def test_inbox_items_carry_action_path(self, app):
        user = _make_user()
        NotificationBusService.send('dns.unresolved', to=user, data={'count': 1}, severity='warning')
        items = NotificationBusService.inbox(user.id)
        assert items[0]['action_path'] == '/domains'

    def test_mark_group_read_only_touches_category(self, app):
        user = _make_user()
        self._seed(user)
        assert NotificationBusService.unread_count(user.id) == 3
        marked = NotificationBusService.mark_all_read(user.id, category='security')
        assert marked == 1
        assert NotificationBusService.unread_count(user.id) == 2


class TestApi:
    def test_inbox_filter_params(self, app, client, auth_headers):
        admin = User.query.filter_by(username='testadmin').first()
        prefs = NotificationPreferences.get_or_create(admin.id)
        prefs.set_severities(['critical', 'warning', 'info', 'success'])
        db.session.commit()
        NotificationBusService.send('security.alert', to=admin, data={'message': 'x'}, severity='critical')
        NotificationBusService.send('backup.completed', to=admin, data={'app': 'a'}, severity='success')

        resp = client.get('/api/v1/notifications/inbox?category=security', headers=auth_headers)
        assert resp.status_code == 200
        items = resp.get_json()['items']
        assert all(i['category'] == 'security' for i in items)

        grp = client.post('/api/v1/notifications/inbox/read-all?category=security', headers=auth_headers)
        assert grp.status_code == 200
        assert grp.get_json()['updated'] >= 1
