from __future__ import annotations

from app.script_asset_naming import list_export_class_names, primary_export_class_name, sanitize_stem, stem_matches_export


def test_primary_export_requires_single_export_class():
    src = """export class A {}
export class B {}
"""
    assert primary_export_class_name(src) is None
    assert list_export_class_names(src) == ["A", "B"]


def test_primary_export_ok():
    src = """import x from \"y\"\nexport class Foo extends Bar {\n}\n"""
    assert primary_export_class_name(src) == "Foo"


def test_default_export_class():
    src = "export default class Def {\n}\n"
    assert primary_export_class_name(src) == "Def"


def test_sanitize_stem():
    assert sanitize_stem("Foo") == "Foo"
    assert sanitize_stem("Foo-Bar") is None
    assert sanitize_stem("9bad") is None


def test_stem_matches_export():
    src = "export class Qux {}\n"
    assert stem_matches_export("Qux", src)
