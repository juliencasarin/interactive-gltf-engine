from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ProjectAsset(BaseModel):
    assetId: str
    relativePath: str
    name: str | None = None
    logicalFolder: str | None = None


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


class AssetUploadResponse(BaseModel):
    assetId: str
    relativePath: str
    url: str
