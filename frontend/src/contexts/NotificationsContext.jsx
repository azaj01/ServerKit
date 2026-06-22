import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import socketService from '../services/socket';
import { useAuth } from './AuthContext';

// Global in-app notification state: the bell's unread badge + recent list, kept
// live via the Socket.IO 'notification' push (see services/socket.js). The full
// history page paginates independently; this context holds only the recent slice.
const NotificationsContext = createContext(null);

const RECENT_LIMIT = 12;
const MAX_BUFFERED = 30;

export function useNotifications() {
    return useContext(NotificationsContext);
}

export function NotificationsProvider({ children }) {
    const { isAuthenticated } = useAuth();
    const [items, setItems] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);

    const refresh = useCallback(async () => {
        if (!isAuthenticated) return;
        setLoading(true);
        try {
            const data = await api.getInbox({ limit: RECENT_LIMIT });
            setItems(data.items || []);
            setUnreadCount(data.unread_count || 0);
        } catch {
            // Non-fatal: the bell just stays at its last known state.
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated]);

    useEffect(() => {
        if (!isAuthenticated) {
            socketService.disconnect();
            setItems([]);
            setUnreadCount(0);
            return undefined;
        }
        refresh();
        socketService.connect();
        const off = socketService.on('notification', (n) => {
            setItems((prev) => [{ ...n, read: false }, ...prev].slice(0, MAX_BUFFERED));
            setUnreadCount((count) => count + 1);
        });
        return off;
    }, [isAuthenticated, refresh]);

    const markRead = useCallback(async (deliveryId) => {
        setItems((prev) => prev.map((it) => (
            it.delivery_id === deliveryId ? { ...it, read: true } : it
        )));
        try {
            const res = await api.markNotificationRead(deliveryId);
            if (res && typeof res.unread_count === 'number') setUnreadCount(res.unread_count);
        } catch {
            // ignore — the next refresh reconciles
        }
    }, []);

    const markAllRead = useCallback(async () => {
        setItems((prev) => prev.map((it) => ({ ...it, read: true })));
        setUnreadCount(0);
        try {
            await api.markAllNotificationsRead();
        } catch {
            // ignore — the next refresh reconciles
        }
    }, []);

    const value = { items, unreadCount, loading, refresh, markRead, markAllRead };
    return (
        <NotificationsContext.Provider value={value}>
            {children}
        </NotificationsContext.Provider>
    );
}

export default NotificationsContext;
