"""Panel version helpers.

Single source for "what version is this panel" plus semver-ish comparison used by
extension compatibility gates (min_panel_version / max_panel_version) and the
update flow. The version string lives in the repo-root VERSION file.
"""
import os
import logging

logger = logging.getLogger(__name__)

_cached_version = None


def get_panel_version():
    """Return the panel version from the VERSION file, or '0.0.0' if unknown.

    Cached after first read (the file doesn't change while the process runs).
    """
    global _cached_version
    if _cached_version is not None:
        return _cached_version

    here = os.path.dirname(os.path.abspath(__file__))       # backend/app/utils
    backend_root = os.path.dirname(os.path.dirname(here))    # backend/
    candidates = [
        '/opt/serverkit/VERSION',
        os.path.join(backend_root, '..', 'VERSION'),
        os.path.join(backend_root, 'VERSION'),
    ]
    version = '0.0.0'
    for path in candidates:
        try:
            if os.path.exists(path):
                with open(path, 'r', encoding='utf-8') as f:
                    version = f.read().strip() or version
                break
        except Exception:
            pass
    _cached_version = version
    return version


def _parse(v):
    """Best-effort parse into a comparable object. Uses packaging when possible,
    falling back to a tuple of leading integer components."""
    if not v:
        return None
    try:
        from packaging.version import Version
        return Version(str(v))
    except Exception:
        parts = []
        for chunk in str(v).split('.'):
            num = ''.join(ch for ch in chunk if ch.isdigit())
            parts.append(int(num) if num else 0)
        return tuple(parts) if parts else None


def compare_versions(a, b):
    """Return -1/0/1 for a<b / a==b / a>b. Unparseable values sort as equal."""
    pa, pb = _parse(a), _parse(b)
    if pa is None or pb is None:
        return 0
    try:
        if pa < pb:
            return -1
        if pa > pb:
            return 1
        return 0
    except TypeError:
        return 0


def version_satisfies(current, min_version=None, max_version=None):
    """True if `current` is within [min_version, max_version] (inclusive).

    Missing bounds are open. Unparseable bounds are ignored (fail open) so a
    malformed manifest never hard-blocks an install for the wrong reason.
    """
    if min_version and _parse(min_version) is not None:
        if compare_versions(current, min_version) < 0:
            return False
    if max_version and _parse(max_version) is not None:
        if compare_versions(current, max_version) > 0:
            return False
    return True
