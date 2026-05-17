from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class InteractionScriptAttachment(BaseModel):
    """Script component on a scene node; preview/export derives target from node id."""

    id: str
    scriptAssetRef: str
    serializedProps: dict[str, Any] | None = None

    model_config = {"extra": "ignore"}


class ProjectAsset(BaseModel):
    assetId: str
    relativePath: str
    name: str | None = None
    logicalFolder: str | None = None
    assetKind: Literal["gltf", "script"] | None = None
    scriptRole: Literal["interaction", "behaviour"] | None = None
    interactionKind: str | None = None
    scriptExports: list[str] | None = None

    model_config = {"extra": "ignore"}


class SceneNode(BaseModel):
    id: str
    name: str
    parentId: str | None = None
    position: list[float]
    rotation: list[float]
    scale: list[float]
    assetRef: str | None = None
    visible: bool | None = None
    layerId: str | None = None
    interactionAttachments: list[InteractionScriptAttachment] | None = None
    # Legacy (pre–multi-script); still accepted when loading old project.json
    interactionScriptAssetRef: str | None = None
    interactionTargetNodeId: str | None = None
    interactionTargetSerializedId: str | None = None
    interactionSerializedProps: dict[str, Any] | None = None

    @field_validator("position", "rotation", "scale")
    @classmethod
    def _len3(cls, v: list[float]) -> list[float]:
        if len(v) != 3:
            raise ValueError("expected exactly 3 floats")
        return v


class Scene(BaseModel):
    nodes: list[SceneNode] = Field(default_factory=list)


class ProjectDocumentV2(BaseModel):
    format: Literal["igltf-editor-project"] = "igltf-editor-project"
    version: Literal[2] = 2
    scene: Scene
    assets: list[ProjectAsset] = Field(default_factory=list)
    assetFolders: list[str] = Field(default_factory=list)

    model_config = {"extra": "ignore"}


class AssetSourceBody(BaseModel):
    """UTF-8 script body for PUT /projects/{id}/assets/{asset_id}/source"""

    content: str = Field(default="", max_length=2_000_000)


class AssetUploadResponse(BaseModel):
    assetId: str
    relativePath: str
    url: str


class RenameScriptStemBody(BaseModel):
    stem: str = Field(..., min_length=1, max_length=160)


class RenameScriptStemResponse(BaseModel):
    status: Literal["ok"] = "ok"
    relativePath: str
    scriptExports: list[str]
    mismatch: bool


class CreateIgltfProjectBody(BaseModel):
    """Create a workspace directory under ``parentDirectory`` + ``folderName``."""

    parentDirectory: str
    folderName: str


class RegisterIgltfProjectBody(BaseModel):
    """Add an existing on-disk workspace to the hub registry."""

    projectDirectory: str
