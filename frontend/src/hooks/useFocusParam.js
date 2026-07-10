import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Opens a page's existing drawer / panel / modal from a notification deep link.
 *
 * Notification links follow the fragment contract `path?focus=<kind>:<id>`
 * (e.g. `/backups?focus=policy:12`). A destination page calls this hook once
 * with the kind it handles and a handler that opens the matching surface; the
 * hook fires the handler a single time, then clears the `focus` param so a
 * refresh or back-nav doesn't re-trigger it.
 *
 * @param {string} kind - the focus kind this page handles ('policy'|'domain'|'job'|…)
 * @param {(id: string) => void} handler - opens the surface for the given id
 */
export default function useFocusParam(kind, handler) {
    const [searchParams, setSearchParams] = useSearchParams();
    const handledRef = useRef(false);

    useEffect(() => {
        if (handledRef.current) return;
        const focus = searchParams.get('focus');
        if (!focus) return;

        const sep = focus.indexOf(':');
        if (sep === -1) return;
        const focusKind = focus.slice(0, sep);
        const id = focus.slice(sep + 1);
        if (focusKind !== kind || !id) return;

        handledRef.current = true;
        handler(id);

        // Clear the param so a refresh doesn't re-open the surface.
        const next = new URLSearchParams(searchParams);
        next.delete('focus');
        setSearchParams(next, { replace: true });
    }, [searchParams, kind, handler, setSearchParams]);
}
