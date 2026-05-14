from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

from dotenv import load_dotenv

# Load igltf-editor-backend/.env before reading os.environ (storage, CORS, etc.)
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.apply_document import apply_and_persist_project
from app.models import AssetUploadResponse, ProjectDocumentV2, Scene, SceneNode
from app.storage import (
    ensure_project_layout,
    file_url,
    get_storage_root,
    project_dir,
    project_json_path,
)

_MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "200"))

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


def _cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return [o.strip() for o in raw.split(",") if o.strip()]


app = FastAPI(title="igltf-editor-backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve everything under STORAGE_ROOT at /files/{path} — first segment is project id
app.mount("/files", StaticFiles(directory=str(get_storage_root())), name="files")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


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
    return {"status": "ok", "document": json.loads(normalized.model_dump_json())}


@app.post("/projects/{project_id}/assets/stage", response_model=AssetUploadResponse)
async def post_asset_stage(project_id: str, file: UploadFile = File(...)) -> AssetUploadResponse:
    try:
        ensure_project_layout(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    filename = (file.filename or "model.glb").lower()
    if not (filename.endswith(".glb") or filename.endswith(".gltf")):
        raise HTTPException(status_code=400, detail="only .glb or .gltf uploads supported")

    asset_id = str(uuid.uuid4())
    ext = ".glb" if filename.endswith(".glb") else ".gltf"
    relative_path = f"_staging/{asset_id}{ext}"
    dest = project_dir(project_id) / relative_path

    max_bytes = _MAX_UPLOAD_MB * 1024 * 1024
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


@app.get("/play/{project_id}")
def play_manifest(project_id: str) -> dict[str, str]:
    """Built glb+js manifest; returns 404 until build artifacts exist."""
    try:
        base = project_dir(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    glb = base / "test.glb"
    js = base / "test.js"
    if not glb.is_file():
        raise HTTPException(
            status_code=404,
            detail="play bundle not built (expected test.glb after compile step)",
        )
    out: dict[str, str] = {"glbUrl": file_url(project_id, "test.glb")}
    if js.is_file():
        out["jsUrl"] = file_url(project_id, "test.js")
    return out


# --- End routes ---
