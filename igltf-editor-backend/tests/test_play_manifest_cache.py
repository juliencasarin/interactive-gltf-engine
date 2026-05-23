from __future__ import annotations

from pathlib import Path

import pytest
from starlette.testclient import TestClient

import app.main as mainapp
import app.storage as storage


def test_play_manifest_urls_include_mtime_version(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    igltf_app_client: TestClient,
) -> None:
    ws = tmp_path / "play_ws"
    build = ws / "build"
    build.mkdir(parents=True)
    glb = build / "scene.glb"
    js = build / "scene.js"
    glb.write_bytes(b"glb")
    js.write_text("// scene", encoding="utf-8")

    monkeypatch.setattr(storage, "resolve_project_root", lambda _pid: ws)

    r = igltf_app_client.get("/play/play-cache-test")
    assert r.status_code == 200, r.text
    data = r.json()
    glb_v = storage.file_mtime_version(glb)
    js_v = storage.file_mtime_version(js)
    assert data["glbUrl"].endswith(f"build/scene.glb?v={glb_v}")
    assert data["jsUrl"].endswith(f"build/scene.js?v={js_v}")


def test_play_bundle_files_served_with_no_store(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    igltf_app_client: TestClient,
) -> None:
    ws = tmp_path / "play_ws2"
    build = ws / "build"
    build.mkdir(parents=True)
    glb = build / "scene.glb"
    glb.write_bytes(b"glb")

    monkeypatch.setattr(mainapp, "resolve_project_root", lambda _pid: ws)

    r = igltf_app_client.get("/files/play-cache-test/build/scene.glb")
    assert r.status_code == 200
    assert r.headers.get("cache-control") == "no-store"
