from __future__ import annotations

from pathlib import Path

import pytest
from starlette.testclient import TestClient

import app.main as mainapp
import app.storage as storage
from app.models import ProjectDocumentV2, ProjectAsset
from tests.test_assets_disk_sync import _minimal_doc


def test_rename_script_stem_moves_file_sets_exports_and_reports_mismatch(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    igltf_app_client: TestClient,
) -> None:
    monkeypatch.setattr(mainapp, "touch_saved_metadata", lambda *a, **k: None)

    ws = tmp_path / "rename_ws"
    ws.mkdir(parents=True)
    (ws / "assets").mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(storage, "resolve_project_root", lambda _pid: ws)

    aid = "11111111-1111-4111-a111-111111111111"
    pid = "proj-rename-script"
    (ws / "assets" / "Foo.js").write_text("export class Foo {}\n", encoding="utf-8")

    doc = _minimal_doc(
        assets=[
            ProjectAsset(
                assetId=aid,
                relativePath="assets/Foo.js",
                assetKind="script",
                scriptRole="interaction",
                interactionKind="event",
                scriptExports=["Foo"],
                name=None,
            ),
        ]
    )
    (ws / "project.json").write_text(doc.model_dump_json(indent=2), encoding="utf-8")

    r = igltf_app_client.patch(
        f"/projects/{pid}/assets/{aid}/rename-stem",
        json={"stem": "Bar"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["relativePath"] == "assets/Bar.js"
    assert data["scriptExports"] == ["Bar"]
    assert data["mismatch"] is True
    assert not (ws / "assets" / "Foo.js").is_file()
    assert (ws / "assets" / "Bar.js").read_text(encoding="utf-8") == "export class Foo {}\n"

    reloaded = ProjectDocumentV2.model_validate_json((ws / "project.json").read_text(encoding="utf-8"))
    row = next(a for a in reloaded.assets if a.assetId == aid)
    assert row.relativePath.replace("\\", "/") == "assets/Bar.js"
    assert row.scriptExports == ["Bar"]
