// Surface a create response's structured `warnings: []` (publishing gaps + host
// resolvability) as toasts naming the exact missing piece. Each warning is
// { code, message, fix:{kind:'link', to} } — mirrors a Setup Health item, so the
// same standing gap also shows on the dashboard card and the Doctor.
export function showCreationWarnings(toast, warnings) {
    (warnings || []).forEach((w) => {
        if (w && w.message) toast.warning(w.message, { duration: 9000 });
    });
}
