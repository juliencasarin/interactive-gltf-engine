from __future__ import annotations

import json
import mimetypes
import os
import shutil
from contextlib import asynccontextmanager
from pathlib import Path, PurePosixPath
from uuid import uuid4

from dotenv import load_dotenv

# Load igltf-editor-backend/.env before reading os.environ (storage, CORS, etc.)
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI, File, HTTPException, Query, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from starlette.responses import FileResponse
from unicodedata import normalize

from app.apply_document import apply_and_persist_project
from app.assets_watch import handle_assets_watch_websocket
from app.build_play_glb import build_scene_to_play_glb
from app.models import (
    AssetSourceBody,
    AssetUploadResponse,
    CreateIgltfProjectBody,
    ProjectAsset,
    ProjectDocumentV2,
    RegisterIgltfProjectBody,
    RenameScriptStemBody,
    RenameScriptStemResponse,
    Scene,
    SceneNode,
)
from app.project_fs_lock import project_fs_lock
from app.script_asset_naming import sanitize_stem, stem_matches_export
from app.mcp_project_config import MCP_MOUNT_PATH, write_project_mcp_json_if_absent
from app.mcp_server import framework_fast_mcp, prime_mcp_mount_handler
from app.open_ide import spawn_ide_for_folder
from app.projects_registry import (
    add_registered_project_at_disk,
    get_or_register_directory,
    list_registered_public,
    touch_saved_metadata,
)
from app.storage import (
    ensure_project_layout,
    file_url,
    project_dir,
    project_json_path,
    resolve_project_root,
)
from app.version_info import ENGINE_VERSION
from pygltflib import GLTF2

from app.gltf_interior_hierarchy import catalog_interior_manifest

_MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "200"))
_MAX_SCRIPT_UPLOAD_MB = int(os.environ.get("MAX_SCRIPT_UPLOAD_MB", "8"))

PLAY_GLB_REL = Path("build") / "scene.glb"
PLAY_SCENE_JS_REL = Path("build") / "scene.js"


def _canonical_rel_asset(p: str) -> str:
    return p.lstrip("/").replace("\\", "/")

# Returned when project.json does not exist yet (not persisted until first PUT).
_SYNTHETIC_PROJECT_DOCUMENT_V2 = ProjectDocumentV2(
    scene=Scene(
        nodes=[
            SceneNode(
                id="root",
                name="Scene",
                parentId=None,
                position=[0.0, 0.0, 0.0],
                rotation=[0.0, 0.0, 0.0],
                scale=[1.0, 1.0, 1.0],
            )
        ]
    ),
    assets=[],
)

_GITIGNORE_TEMPLATE = "# igltf editor build outputs\nbuild/\n"


def _folder_name_ok(name: str) -> None:
    s = normalize("NFC", name.strip())
    if not s or s in (".", ".."):
        raise ValueError("folder name cannot be empty, '.', or '..'")
    if ".." in s or "/" in s or "\\" in s:
        raise ValueError("folder name cannot contain slashes or '..'")


def _safe_resolved_project_file(project_id: str, file_path: str) -> Path:
    try:
        root = resolve_project_root(project_id).resolve()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    rel = file_path.replace("\\", "/").strip().lstrip("/")
    if not rel:
        raise HTTPException(status_code=400, detail="missing file path")
    parts = PurePosixPath(rel).parts
    for part in parts:
        if part == "..":
            raise HTTPException(status_code=400, detail="invalid path")
    disk = Path(root.joinpath(*parts)).resolve()
    disk.relative_to(root)
    return disk


def _cors_origins() -> list[str]:
    raw = os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:5173,"
        "http://127.0.0.1:5173,"
        "https://tauri.localhost,"
        "http://tauri.localhost,"
        "http://localhost:1420,"
        "http://127.0.0.1:1420",
    )
    return [o.strip() for o in raw.split(",") if o.strip()]


@asynccontextmanager
async def _app_lifespan(_application: FastAPI):
    prime_mcp_mount_handler()
    async with framework_fast_mcp.session_manager.run():
        yield


app = FastAPI(
    title="igltf-editor-backend",
    version=ENGINE_VERSION,
    lifespan=_app_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/files/{project_id}/{file_path:path}")
def serve_project_file(project_id: str, file_path: str):
    disk = _safe_resolved_project_file(project_id, file_path)
    if not disk.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    mt = mimetypes.guess_type(disk.name)[0]
    if disk.suffix.lower() in {".js", ".mjs", ".cjs"}:
        mt = "text/javascript; charset=utf-8"

    return FileResponse(str(disk), media_type=mt or "application/octet-stream")


@app.get("/studio/projects")
def studio_list_projects() -> list[dict]:
    return list_registered_public()


@app.post("/studio/projects/create")
def studio_create_project(body: CreateIgltfProjectBody) -> dict[str, str]:
    try:
        _folder_name_ok(body.folderName)
        parent = Path(body.parentDirectory).expanduser().resolve()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not parent.is_dir():
        raise HTTPException(status_code=400, detail="parent directory does not exist")
    folder = normalize("NFC", body.folderName.strip())
    dest = (parent / folder).resolve()
    try:
        dest.relative_to(parent.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid destination path") from None
    if dest.exists():
        raise HTTPException(status_code=409, detail="project folder already exists")
    dest.mkdir(parents=False)
    (dest / "assets").mkdir(parents=True, exist_ok=True)
    (dest / "_staging").mkdir(parents=True, exist_ok=True)
    (dest / ".gitignore").write_text(_GITIGNORE_TEMPLATE, encoding="utf-8")
    try:
        pid = add_registered_project_at_disk(dest)
    except ValueError as e:
        shutil.rmtree(dest, ignore_errors=True)
        raise HTTPException(status_code=409, detail=str(e)) from e
    write_project_mcp_json_if_absent(dest)
    return {"id": pid}


@app.post("/studio/projects/register")
def studio_register_existing(body: RegisterIgltfProjectBody) -> dict[str, str]:
    raw = normalize("NFC", body.projectDirectory.strip())
    if not raw:
        raise HTTPException(status_code=400, detail="project directory cannot be empty")
    try:
        p = Path(raw).expanduser().resolve()
    except (OSError, ValueError):
        raise HTTPException(status_code=400, detail="invalid path") from None
    try:
        pid = get_or_register_directory(p)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"id": pid}


@app.delete("/studio/projects/{project_id}")
def studio_unregister_project(project_id: str) -> dict[str, str]:
    from app.projects_registry import delete_project_registration

    if not delete_project_registration(project_id):
        raise HTTPException(status_code=404, detail="unknown project registration")
    return {"status": "ok"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "engineVersion": ENGINE_VERSION, "mcpPath": MCP_MOUNT_PATH}


@app.get("/projects/{project_id}/document")
def get_document(project_id: str) -> JSONResponse:
    try:
        ensure_project_layout(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    path = project_json_path(project_id)
    if not path.is_file():
        return JSONResponse(content=_SYNTHETIC_PROJECT_DOCUMENT_V2.model_dump(mode="json"))
    try:
        text = path.read_text(encoding="utf-8")
        data = json.loads(text)
    except (OSError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=500, detail=f"invalid project.json: {e}") from e
    return JSONResponse(content=data)


@app.put("/projects/{project_id}/document")
def put_document(project_id: str, body: ProjectDocumentV2) -> dict:
    try:
        ensure_project_layout(project_id)
        normalized = apply_and_persist_project(project_id, body)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except OSError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    touch_saved_metadata(project_id, engine_version=ENGINE_VERSION)
    return {"status": "ok", "document": json.loads(normalized.model_dump_json())}


@app.post("/projects/{project_id}/assets/stage", response_model=AssetUploadResponse)
async def post_asset_stage(project_id: str, file: UploadFile = File(...)) -> AssetUploadResponse:
    try:
        ensure_project_layout(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    filename = (file.filename or "model.glb").lower()
    ext: str
    max_bytes: int
    if filename.endswith(".glb"):
        ext = ".glb"
        max_bytes = _MAX_UPLOAD_MB * 1024 * 1024
    elif filename.endswith(".gltf"):
        ext = ".gltf"
        max_bytes = _MAX_UPLOAD_MB * 1024 * 1024
    elif filename.endswith(".mjs"):
        ext = ".mjs"
        max_bytes = _MAX_SCRIPT_UPLOAD_MB * 1024 * 1024
    elif filename.endswith(".cjs"):
        ext = ".cjs"
        max_bytes = _MAX_SCRIPT_UPLOAD_MB * 1024 * 1024
    elif filename.endswith(".js"):
        ext = ".js"
        max_bytes = _MAX_SCRIPT_UPLOAD_MB * 1024 * 1024
    else:
        raise HTTPException(
            status_code=400,
            detail="only .glb, .gltf, .js, .mjs, or .cjs uploads supported",
        )

    asset_id = str(uuid4())
    relative_path = f"_staging/{asset_id}{ext}"
    dest = project_dir(project_id) / relative_path

    size = 0
    try:
        with dest.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(status_code=413, detail="file too large")
                out.write(chunk)
    except HTTPException:
        if dest.exists():
            dest.unlink(missing_ok=True)
        raise

    return AssetUploadResponse(
        assetId=asset_id,
        relativePath=relative_path,
        url=file_url(project_id, relative_path),
    )


@app.get("/projects/{project_id}/assets/{asset_id}/source", response_class=PlainTextResponse)
def get_asset_source(project_id: str, asset_id: str) -> PlainTextResponse:
    try:
        ensure_project_layout(project_id)
        base = project_dir(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    pj = project_json_path(project_id)
    if not pj.is_file():
        raise HTTPException(status_code=404, detail="project not persisted")
    doc = ProjectDocumentV2.model_validate_json(pj.read_text(encoding="utf-8"))
    match = next((a for a in doc.assets if a.assetId == asset_id), None)
    if match is None:
        raise HTTPException(status_code=404, detail="unknown asset")
    rel = match.relativePath.lstrip("/").replace("\\", "/")
    disk = (base / rel).resolve()
    try:
        disk.relative_to(base.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid asset path") from exc
    if not disk.is_file():
        raise HTTPException(status_code=404, detail="asset file missing")
    suf = disk.suffix.lower()
    if suf not in (".js", ".mjs", ".cjs"):
        raise HTTPException(status_code=400, detail="not a JavaScript asset")
    return PlainTextResponse(disk.read_text(encoding="utf-8"))


@app.get("/projects/{project_id}/assets/{asset_id}/gltf-interior-manifest")
def get_gltf_interior_manifest(project_id: str, asset_id: str) -> dict[str, object]:
    """Preorder table of default‑scene nodes for expanding a catalogue ``.glb`` in the editor."""

    try:
        ensure_project_layout(project_id)
        base = project_dir(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    pj = project_json_path(project_id)
    if not pj.is_file():
        raise HTTPException(status_code=404, detail="project not persisted")
    doc = ProjectDocumentV2.model_validate_json(pj.read_text(encoding="utf-8"))
    match = next((a for a in doc.assets if a.assetId == asset_id), None)
    if match is None:
        raise HTTPException(status_code=404, detail="unknown asset")
    rel = match.relativePath.lstrip("/").replace("\\", "/")
    disk = (base / rel).resolve()
    try:
        disk.relative_to(base.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid asset path") from exc
    if not disk.is_file():
        raise HTTPException(status_code=404, detail="asset file missing")
    if disk.suffix.lower() != ".glb":
        raise HTTPException(status_code=400, detail="interior manifest supports .glb only")
    try:
        loaded = GLTF2().load_binary(str(disk))
    except (OSError, ValueError) as e:
        raise HTTPException(status_code=500, detail=f"cannot parse glb: {e}") from e

    manifest = catalog_interior_manifest(loaded)
    manifest.setdefault("assetId", asset_id)
    manifest.setdefault("relativePath", rel.replace("\\", "/"))
    return manifest


@app.put("/projects/{project_id}/assets/{asset_id}/source")
def put_asset_source(project_id: str, asset_id: str, body: AssetSourceBody) -> dict[str, str]:
    try:
        ensure_project_layout(project_id)
        base = project_dir(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    pj = project_json_path(project_id)
    if not pj.is_file():
        raise HTTPException(status_code=404, detail="project not persisted")
    doc = ProjectDocumentV2.model_validate_json(pj.read_text(encoding="utf-8"))
    match = next((a for a in doc.assets if a.assetId == asset_id), None)
    if match is None:
        raise HTTPException(status_code=404, detail="unknown asset")
    rel = match.relativePath.lstrip("/").replace("\\", "/")
    if not rel.startswith("assets/") and not rel.startswith("_staging/"):
        raise HTTPException(
            status_code=400,
            detail="asset path must be under assets/ or _staging/",
        )
    disk = (base / rel).resolve()
    try:
        disk.relative_to(base.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid asset path") from exc
    suf = disk.suffix.lower()
    if suf not in (".js", ".mjs", ".cjs"):
        raise HTTPException(status_code=400, detail="not a JavaScript asset")
    max_txt = _MAX_SCRIPT_UPLOAD_MB * 1024 * 1024
    if len(body.content.encode("utf-8")) > max_txt:
        raise HTTPException(status_code=413, detail="script source too large")
    disk.parent.mkdir(parents=True, exist_ok=True)
    disk.write_text(body.content, encoding="utf-8")
    return {"status": "ok"}


@app.patch(
    "/projects/{project_id}/assets/{asset_id}/rename-stem",
    response_model=RenameScriptStemResponse,
)
def patch_rename_script_asset_stem(
    project_id: str, asset_id: str, body: RenameScriptStemBody
) -> RenameScriptStemResponse:
    """Rename on-disk script to ``assets/{Stem}.{ext}``, keep ``assetId`` (attachments safe)."""
    stem_in = sanitize_stem(body.stem)
    if stem_in is None:
        raise HTTPException(
            status_code=400,
            detail="stem must be a JavaScript identifier (letters, digits, underscore)",
        )

    with project_fs_lock(project_id):
        try:
            ensure_project_layout(project_id)
            base = project_dir(project_id).resolve()
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        pj = project_json_path(project_id)
        if not pj.is_file():
            raise HTTPException(status_code=404, detail="project not persisted")
        raw = pj.read_text(encoding="utf-8")
        doc = ProjectDocumentV2.model_validate_json(raw)

        idx = next((i for i, x in enumerate(doc.assets) if x.assetId == asset_id), None)
        if idx is None:
            raise HTTPException(status_code=404, detail="unknown asset")
        prev = doc.assets[idx]

        old_rel = prev.relativePath.lstrip("/").replace("\\", "/")
        if not old_rel.startswith("assets/"):
            raise HTTPException(status_code=400, detail="script must live under assets/")

        ext = Path(old_rel).suffix.lower()
        if ext not in (".js", ".mjs", ".cjs"):
            raise HTTPException(status_code=400, detail="stem rename applies to script files only (.js/.mjs/.cjs)")

        old_disk = (base / old_rel).resolve()
        try:
            old_disk.relative_to(base)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid asset path") from exc
        if not old_disk.is_file():
            raise HTTPException(status_code=404, detail="script file missing on disk")

        new_rel = f"assets/{stem_in}{ext}"
        nk = new_rel.replace("\\", "/")

        nk_key = _canonical_rel_asset(nk).lower()
        occupied = {
            _canonical_rel_asset(a.relativePath).lower()
            for j, a in enumerate(doc.assets)
            if j != idx
        }
        if nk_key in occupied:
            raise HTTPException(
                status_code=409,
                detail=f"path '{nk}' already used by another catalogue entry",
            )

        target_disk = (base / nk).resolve()
        try:
            target_disk.relative_to(base)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid target path") from exc

        old_resolved = old_disk.resolve()
        if target_disk != old_resolved:
            if target_disk.exists():
                raise HTTPException(
                    status_code=409,
                    detail=f"a file already exists at '{nk}'",
                )
            target_disk.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(old_resolved), str(target_disk))

        try:
            after_text = target_disk.read_text(encoding="utf-8")
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"cannot read renamed script: {e}") from e

        mismatch = not stem_matches_export(stem_in, after_text)
        refreshed = ProjectAsset(
            assetId=prev.assetId,
            relativePath=nk,
            name=None,
            logicalFolder=prev.logicalFolder,
            assetKind="script",
            scriptRole=prev.scriptRole or "interaction",
            interactionKind=prev.interactionKind or "event",
            scriptExports=[stem_in],
        )

        assets2 = list(doc.assets)
        assets2[idx] = refreshed
        out_doc = ProjectDocumentV2(
            scene=doc.scene,
            assets=assets2,
            assetFolders=list(doc.assetFolders or []),
        )
        pj.write_text(out_doc.model_dump_json(indent=2), encoding="utf-8")
        try:
            touch_saved_metadata(project_id, engine_version=ENGINE_VERSION)
        except ValueError:
            pass

    return RenameScriptStemResponse(
        relativePath=nk,
        scriptExports=[stem_in],
        mismatch=mismatch,
    )


@app.get("/projects/{project_id}/dev-local-path")
def dev_local_project_path(project_id: str) -> dict[str, str]:
    """Absolute project directory on the API host (local desktop / same-machine authoring)."""
    try:
        p = project_dir(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"path": str(p.resolve())}


@app.post("/projects/{project_id}/open-in-ide")
def post_open_in_ide(
    project_id: str,
    preset: str = Query("cursor", description="cursor | vscode | jetbrains"),
) -> dict[str, str]:
    """Spawn the IDE CLI on the API host (new window when supported, e.g. ``cursor -n``)."""
    key = preset.strip().lower()
    if key not in ("cursor", "vscode", "jetbrains"):
        raise HTTPException(
            status_code=400,
            detail="preset must be cursor, vscode, or jetbrains",
        )
    try:
        folder = project_dir(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    try:
        spawn_ide_for_folder(folder, key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except OSError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {"status": "ok"}


@app.post("/projects/{project_id}/build-play-glb")
def post_build_play_glb(project_id: str) -> dict[str, str]:
    """Persisted project → ``build/scene.glb``. Requires saved ``project.json``."""
    try:
        ensure_project_layout(project_id)
        build_scene_to_play_glb(project_id)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except OSError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    pj_base = project_dir(project_id)
    out: dict[str, str] = {"status": "ok", "relativePath": PLAY_GLB_REL.as_posix()}
    if (pj_base / PLAY_SCENE_JS_REL).is_file():
        out["jsRelativePath"] = PLAY_SCENE_JS_REL.as_posix()
    return out


@app.get("/play/{project_id}")
def play_manifest(project_id: str) -> dict[str, str]:
    """Built GLB (+ optional JS alongside); prefers ``build/scene.glb``, legacy ``test.glb``."""
    try:
        base = project_dir(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    glb_candidates = [
        (base / "build" / "scene.glb", "build/scene.glb"),
        (base / "test.glb", "test.glb"),
    ]
    glb_path: Path | None = None
    glb_rel = ""
    for pth, rel in glb_candidates:
        if pth.is_file():
            glb_path, glb_rel = pth, rel
            break
    if glb_path is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "play bundle not built (expected build/scene.glb "
                "or legacy test.glb after compile)"
            ),
        )
    out: dict[str, str] = {"glbUrl": file_url(project_id, glb_rel)}
    js_candidates = [
        base / "build" / "scene.js",
        base / "build" / "play.js",
        base / "test.js",
    ]
    for jp in js_candidates:
        if jp.is_file():
            out["jsUrl"] = file_url(project_id, jp.relative_to(base.resolve()).as_posix())
            break
    return out


@app.websocket("/projects/{project_id}/assets/watch")
async def websocket_assets_disk_watch(websocket: WebSocket, project_id: str) -> None:
    """Live notifications after disk sync merges ``assets/`` → ``project.json``."""
    await handle_assets_watch_websocket(project_id, websocket)


app.mount(MCP_MOUNT_PATH, prime_mcp_mount_handler())


# --- End routes ---