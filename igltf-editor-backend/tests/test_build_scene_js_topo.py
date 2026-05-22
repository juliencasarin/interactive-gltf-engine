from __future__ import annotations

from pathlib import Path

import pytest

from app.build_scene_js import collect_script_assets, resolve_esbuild_command, toposort_script_assets, write_scene_js_bundle
from app.models import ProjectAsset, ProjectDocumentV2, Scene, SceneNode


def _scene() -> Scene:
    root = SceneNode(
        id="root",
        name="Scene",
        parentId=None,
        position=[0.0, 0.0, 0.0],
        rotation=[0.0, 0.0, 0.0],
        scale=[1.0, 1.0, 1.0],
    )
    return Scene(nodes=[root])


def _asset(aid: str, rel: str, **kw: object) -> ProjectAsset:
    return ProjectAsset(assetId=aid, relativePath=rel, assetKind="script", scriptRole="interaction", **kw)


def test_toposort_respects_dependency_order() -> None:
    a = _asset("a", "assets/a.js")
    b = _asset("b", "assets/b.js", scriptDependsOnAssetIds=["a"])
    c = _asset("c", "assets/c.js", scriptDependsOnAssetIds=["b"])
    got = toposort_script_assets([c, a, b])
    assert [x.assetId for x in got] == ["a", "b", "c"]


def test_toposort_parallel_stable_by_asset_id() -> None:
    z = _asset("z", "assets/z.js")
    m = _asset("m", "assets/m.js")
    got = toposort_script_assets([z, m])
    assert [x.assetId for x in got] == ["m", "z"]


def test_toposort_cycle_errors() -> None:
    a = _asset("a", "assets/a.js", scriptDependsOnAssetIds=["b"])
    b = _asset("b", "assets/b.js", scriptDependsOnAssetIds=["a"])
    with pytest.raises(ValueError, match="cycle"):
        toposort_script_assets([a, b])


def test_toposort_unknown_dep_errors() -> None:
    a = _asset("a", "assets/a.js", scriptDependsOnAssetIds=["missing"])
    with pytest.raises(ValueError, match="unknown dependency"):
        toposort_script_assets([a])


def test_collect_script_assets_skips_missing_files(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    (ws / "assets").mkdir(parents=True)
    (ws / "assets" / "here.js").write_text("export const x = 1;\n", encoding="utf-8")
    doc = ProjectDocumentV2(
        scene=_scene(),
        assets=[
            _asset("h", "assets/here.js"),
            _asset("g", "assets/ghost.js"),
            ProjectAsset(assetId="glb", relativePath="assets/m.glb", assetKind="gltf"),
        ],
        assetFolders=[],
    )
    got = collect_script_assets(doc, ws)
    assert len(got) == 1 and got[0].assetId == "h"


def _esbuild_installed() -> bool:
    try:
        resolve_esbuild_command(Path(__file__).resolve().parents[1])
        return True
    except FileNotFoundError:
        return False


@pytest.mark.skipif(not _esbuild_installed(), reason="esbuild / npm deps not installed")
def test_write_scene_js_bundle_smoke(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    (ws / "assets").mkdir(parents=True)
    (ws / "assets" / "a.js").write_text("export class A {}\n", encoding="utf-8")
    (ws / "assets" / "b.js").write_text("export class B {}\n", encoding="utf-8")
    doc = ProjectDocumentV2(
        scene=_scene(),
        assets=[
            _asset("aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeaaaa", "assets/a.js"),
            _asset(
                "bbbbbbbb-cccc-4ddd-eeee-ffffffffbbbb",
                "assets/b.js",
                scriptDependsOnAssetIds=["aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeaaaa"],
            ),
        ],
        assetFolders=[],
    )
    out_js = ws / "build" / "scene.js"
    assert write_scene_js_bundle(ws, doc, out_js) is True
    text = out_js.read_text(encoding="utf-8")
    assert "A" in text and "class" in text
