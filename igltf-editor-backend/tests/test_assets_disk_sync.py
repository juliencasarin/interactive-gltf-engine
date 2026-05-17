from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from starlette.testclient import TestClient

import app.assets_disk_sync as ads
import app.apply_document as appl
import app.storage as storage
from app.assets_watch import AssetsWatchHub
from app.models import ProjectAsset, ProjectDocumentV2, Scene, SceneNode


def _minimal_scene() -> Scene:
    root = SceneNode(
        id="root",
        name="Scene",
        parentId=None,
        position=[0.0, 0.0, 0.0],
        rotation=[0.0, 0.0, 0.0],
        scale=[1.0, 1.0, 1.0],
    )
    return Scene(nodes=[root])


def _minimal_doc(assets: list[ProjectAsset] | None = None) -> ProjectDocumentV2:
    return ProjectDocumentV2(scene=_minimal_scene(), assets=list(assets or []), assetFolders=[])


def _bind_workspace(monkeypatch: pytest.MonkeyPatch, ws: Path) -> None:
    ws.mkdir(parents=True, exist_ok=True)
    (ws / "assets").mkdir(parents=True, exist_ok=True)
    (ws / "_staging").mkdir(parents=True, exist_ok=True)

    def project_dir_fn(_pid: str) -> Path:
        return ws

    def project_json_fn(_pid: str) -> Path:
        return ws / "project.json"

    def assets_dir_fn(_pid: str) -> Path:
        return ws / "assets"

    def staging_dir_fn(_pid: str) -> Path:
        return ws / "_staging"

    monkeypatch.setattr(ads, "project_dir", project_dir_fn)
    monkeypatch.setattr(ads, "project_json_path", project_json_fn)
    monkeypatch.setattr(ads, "assets_dir", assets_dir_fn)
    monkeypatch.setattr(appl, "project_dir", project_dir_fn)
    monkeypatch.setattr(appl, "project_json_path", project_json_fn)
    monkeypatch.setattr(appl, "assets_dir", assets_dir_fn)
    monkeypatch.setattr(appl, "staging_dir", staging_dir_fn)
    monkeypatch.setattr(ads, "touch_saved_metadata", lambda *a, **k: None)


def test_disk_sync_moves_human_named_script_and_writes_catalog(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    ws = tmp_path / "proj"
    _bind_workspace(monkeypatch, ws)
    doc = _minimal_doc()
    (ws / "project.json").write_text(doc.model_dump_json(indent=2), encoding="utf-8")
    (ws / "assets" / "MyHandler.js").write_text("export class MyHandler {}\n", encoding="utf-8")

    events = asyncio.run(ads.sync_assets_from_disk_async("pid-any"))
    assert any(e.get("type") == "asset_added" for e in events)

    reloaded = ProjectDocumentV2.model_validate_json((ws / "project.json").read_text(encoding="utf-8"))
    assert len(reloaded.assets) == 1
    a0 = reloaded.assets[0]
    assert a0.assetKind == "script"
    rel = a0.relativePath.replace("\\", "/")
    assert rel.startswith("assets/") and rel.endswith(".js")
    assert rel == "assets/MyHandler.js"
    assert a0.scriptExports == ["MyHandler"]
    assert Path(ws / rel).is_file()


def test_disk_sync_drops_catalog_row_when_asset_file_removed(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    ws = tmp_path / "proj2"
    _bind_workspace(monkeypatch, ws)
    path_rel = "assets/gone.glb"
    fp = ws / path_rel
    fp.write_bytes(b"gltfx")
    aid = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee"

    assets = [
        ProjectAsset(assetId=aid, relativePath=path_rel, name="gone.glb", assetKind="gltf"),
    ]
    (ws / "project.json").write_text(_minimal_doc(assets).model_dump_json(indent=2), encoding="utf-8")
    fp.unlink()

    events = asyncio.run(ads.sync_assets_from_disk_async("pid-any"))
    assert any(e.get("type") == "asset_removed" and e.get("assetId") == aid for e in events)

    doc2 = ProjectDocumentV2.model_validate_json((ws / "project.json").read_text(encoding="utf-8"))
    assert doc2.assets == []


def test_apply_document_keeps_asset_after_prior_disk_sync(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    ws = tmp_path / "proj3"
    _bind_workspace(monkeypatch, ws)

    bare = ProjectDocumentV2(scene=_minimal_scene(), assets=[], assetFolders=[])
    (ws / "project.json").write_text(bare.model_dump_json(indent=2), encoding="utf-8")

    (ws / "assets" / "Dropped.js").write_text("export class Dropped {}\n", encoding="utf-8")
    asyncio.run(ads.sync_assets_from_disk_async("pid-any"))

    doc = ProjectDocumentV2.model_validate_json((ws / "project.json").read_text(encoding="utf-8"))
    assert len(doc.assets) == 1

    appl.apply_and_persist_project("ignored", doc)

    rel = doc.assets[0].relativePath.replace("\\", "/")
    assert rel == "assets/Dropped.js"
    assert Path(ws / rel).is_file()


def test_websocket_assets_watch_sends_hello(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    igltf_app_client: TestClient,
):
    ws = tmp_path / "proj4"
    _bind_workspace(monkeypatch, ws)
    monkeypatch.setattr(storage, "resolve_project_root", lambda _pid: ws)
    monkeypatch.setattr(AssetsWatchHub, "_watch_loop", AsyncMock())

    (ws / "project.json").write_text(_minimal_doc().model_dump_json(indent=2), encoding="utf-8")

    with igltf_app_client.websocket_connect("/projects/demo/assets/watch") as socket:
        msg = socket.receive_json()
        assert msg.get("channel") == "assets_disk"
        assert msg.get("payload", {}).get("hello") is True
        assert isinstance(msg.get("payload", {}).get("events"), list)
