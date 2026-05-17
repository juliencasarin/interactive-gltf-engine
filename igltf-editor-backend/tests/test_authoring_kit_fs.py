from __future__ import annotations

import pytest

from app import authoring_kit_fs as akfs


@pytest.fixture(scope="session")
def kit_root(tmp_path_factory):
    base = tmp_path_factory.mktemp("authoring-kit")
    (base / "js").mkdir(parents=True, exist_ok=True)
    (base / "hidden").mkdir()
    (base / "nested").mkdir(parents=True, exist_ok=True)
    (base / "js" / "b.js").write_text("console.log()", encoding="utf-8")
    (base / "readme.md").write_text("# Hello", encoding="utf-8")
    (base / "nested" / "x.txt").write_text("x", encoding="utf-8")
    (base / "hidden" / "no.html").write_text("<!doctype>", encoding="utf-8")
    return base.resolve()


def test_list_framework_kit_files_sorted_and_filtered(kit_root):
    rels = akfs.list_framework_kit_files_rel(kit_root)
    assert rels == ["js/b.js", "nested/x.txt", "readme.md"]


def test_read_framework_file_ok_and_size(kit_root):
    txt, nbytes = akfs.read_framework_kit_file("readme.md", kit_root)
    assert txt.startswith("# Hello")
    assert nbytes == len(txt.encode("utf-8"))


def test_read_rejects_traversal(kit_root):
    with pytest.raises(ValueError):
        akfs.read_framework_kit_file("../../outside", kit_root)


def test_read_rejects_oob_file(kit_root):
    with pytest.raises((ValueError, FileNotFoundError)):
        akfs.read_framework_kit_file("hidden/no.html", kit_root)

