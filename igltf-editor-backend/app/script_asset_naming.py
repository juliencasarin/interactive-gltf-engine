"""Unity-like script assets: exported class stem == filename stem == scriptExports[0]."""

from __future__ import annotations

import re

# export class Foo / export abstract class Foo / export default class Foo
_EXPORT_CLASS = re.compile(
    r"""export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)""",
    re.MULTILINE,
)
_STEM_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def list_export_class_names(source: str) -> list[str]:
    return _EXPORT_CLASS.findall(source)


def primary_export_class_name(source: str) -> str | None:
    names = list_export_class_names(source)
    uniq = sorted({n for n in names})
    if len(uniq) != 1:
        return None
    return uniq[0]


def sanitize_stem(raw: str) -> str | None:
    s = raw.strip()
    if not s or _STEM_RE.fullmatch(s) is None:
        return None
    return s


def stem_matches_export(stem: str, source: str) -> bool:
    exp = primary_export_class_name(source)
    san = sanitize_stem(stem)
    if exp is None or san is None:
        return False
    return exp == san
