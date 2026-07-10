"""Pin extension manifest hygiene across both parallel manifest trees.

Two hand-synced manifest trees exist (plan 32 "baked dual-path"):
  - builtin-extensions/*/plugin.json
  - frontend/src/plugins/*/plugin.json

This is a pure file walk — no Flask app fixture needed.
"""
import json
from pathlib import Path

import pytest

# tests/ -> backend/ -> repo root
REPO_ROOT = Path(__file__).resolve().parents[2]
BUILTIN_DIR = REPO_ROOT / 'builtin-extensions'
FRONTEND_DIR = REPO_ROOT / 'frontend' / 'src' / 'plugins'

EM_DASH = '—'
EN_DASH = '–'


def _manifest_paths(root):
    return sorted(root.glob('*/plugin.json'))


def _load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def _all_manifest_paths():
    return _manifest_paths(BUILTIN_DIR) + _manifest_paths(FRONTEND_DIR)


@pytest.mark.parametrize('path', _all_manifest_paths(), ids=lambda p: str(p.relative_to(REPO_ROOT)))
def test_description_has_no_em_or_en_dash(path):
    desc = _load(path).get('description', '')
    assert EM_DASH not in desc, f'{path} description contains an em dash (U+2014)'
    assert EN_DASH not in desc, f'{path} description contains an en dash (U+2013)'


def test_shared_slug_descriptions_match_across_trees():
    builtin = {p.parent.name: _load(p).get('description', '')
               for p in _manifest_paths(BUILTIN_DIR)}
    frontend = {p.parent.name: _load(p).get('description', '')
                for p in _manifest_paths(FRONTEND_DIR)}

    shared = set(builtin) & set(frontend)
    assert shared, 'expected overlapping slugs between the two manifest trees'

    mismatches = {slug: (builtin[slug], frontend[slug])
                  for slug in sorted(shared)
                  if builtin[slug] != frontend[slug]}
    assert not mismatches, f'description drift between trees: {list(mismatches)}'
