"""Registry of control-panel archive importers.

Each supported source panel format (cPanel, DirectAdmin, Hestia)
contributes a :class:`~.base.BaseSiteImporter` subclass and registers it here.
The orchestrator (``SiteImportService``) resolves importers exclusively
through :func:`get_importer` / :func:`detect_format`, so adding a format is:
write the subclass, decorate it with ``@register_importer``, import the
module below.
"""
from .base import BaseSiteImporter  # noqa: F401  (re-exported for subclasses)

_IMPORTERS = {}


def register_importer(cls):
    """Register an importer class (usable as a decorator). Keyed by
    ``cls.format``; re-registering a format replaces it (plugin reloads)."""
    if not getattr(cls, 'format', None):
        raise ValueError('importer class must define a non-empty `format`')
    _IMPORTERS[cls.format] = cls
    return cls


def get_importer(source_type):
    """Return an importer INSTANCE for ``source_type``, or None if unknown."""
    cls = _IMPORTERS.get(source_type)
    return cls() if cls else None


def available_formats():
    return sorted(_IMPORTERS.keys())


def detect_format(extracted_dir):
    """Run every registered importer's detect() and return the first
    (format, importer instance) match, or (None, None)."""
    for fmt in available_formats():
        importer = _IMPORTERS[fmt]()
        try:
            if importer.detect(extracted_dir):
                return fmt, importer
        except Exception:  # a broken detect() must not mask other formats
            continue
    return None, None


# ── built-in formats ──
from .cpanel import CpanelImporter  # noqa: E402
from .directadmin import DirectadminImporter  # noqa: E402
from .hestia import HestiaImporter  # noqa: E402

register_importer(CpanelImporter)
register_importer(DirectadminImporter)
register_importer(HestiaImporter)
