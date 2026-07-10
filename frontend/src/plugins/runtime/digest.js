/**
 * Digest seam (plan 32 Decision 2) — the SINGLE place `crypto.subtle` is used.
 *
 * `digestBytes()` returns the lowercase sha256 hex of a bundle's bytes,
 * choosing the implementation by context:
 *
 *   - Secure context (HTTPS / localhost): the browser's native `crypto.subtle`.
 *   - Insecure context (HTTP-only panel): a bundled pure-JS sha256.
 *
 * Both compute the IDENTICAL digest, so integrity checking is the same in both
 * contexts — an HTTP-only panel is NOT a "skip verification" mode. Keeping this
 * the only `crypto.subtle` reference is enforced by the plan's grep gate.
 */
// Explicit `.js` so the digest agreement test can import this under plain node.
import { sha256Hex } from './sha256.js';

function subtle() {
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    return c && c.subtle && typeof c.subtle.digest === 'function' ? c.subtle : null;
}

// True when the native WebCrypto digest is available (secure context). Exposed
// so callers/docs can note which path a given panel will take.
export function hasNativeDigest() {
    return subtle() !== null;
}

function toHex(buffer) {
    return [...new Uint8Array(buffer)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

export async function digestBytes(bytes) {
    const s = subtle();
    if (s) {
        return toHex(await s.digest('SHA-256', bytes));
    }
    return sha256Hex(bytes);
}
