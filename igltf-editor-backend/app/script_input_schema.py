"""Portable script input refs in serializedProps (mirrors frontend scriptInputSchema.ts)."""

from __future__ import annotations

from typing import Any, Callable


def _is_node_ref(v: Any) -> bool:
    return isinstance(v, dict) and v.get("kind") == "node" and isinstance(v.get("id"), str)


def remap_node_refs_in_value(
    value: Any,
    node_id_to_gltf_index: Callable[[str], str | None],
) -> Any:
    if _is_node_ref(value):
        idx = node_id_to_gltf_index(value["id"])
        if idx is not None:
            return {"kind": "node", "id": idx}
        return value
    if _is_script_attachment_ref(value):
        idx = node_id_to_gltf_index(value["nodeId"])
        if idx is not None:
            return {**value, "nodeId": idx}
        return value
    if isinstance(value, dict) and not _is_node_ref(value) and not _is_script_attachment_ref(value):
        return {
            k: remap_node_refs_in_value(sub, node_id_to_gltf_index)
            for k, sub in value.items()
        }
    return value


def remap_node_refs_in_serialized_props(
    props: dict[str, Any] | None,
    node_id_to_gltf_index: Callable[[str], str | None],
) -> dict[str, Any] | None:
    if not props:
        return props
    out: dict[str, Any] = {}
    for key, val in props.items():
        if key == "targetId" and isinstance(val, str):
            idx = node_id_to_gltf_index(val)
            out[key] = idx if idx is not None else val
            continue
        out[key] = remap_node_refs_in_value(val, node_id_to_gltf_index)
    return out


def parse_igltf_input_annotations(source: str, export_name: str) -> dict[str, dict[str, Any]]:
    """Lightweight JSDoc @igltfInput parser for MCP (aligned with TS golden tests)."""
    import json
    import re

    out: dict[str, dict[str, Any]] = {}
    class_re = re.compile(
        rf"export\s+(?:default\s+)?class\s+{re.escape(export_name)}\s*[^{{]*\{{",
        re.MULTILINE,
    )
    m = class_re.search(source)
    if not m:
        return out
    start = m.end()
    depth = 1
    i = start
    while i < len(source) and depth > 0:
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
        i += 1
    body = source[start : i - 1] if depth == 0 else ""

    field_re = re.compile(
        r"/\*\*([\s\S]*?)\*/\s*(?://[^\n]*\n\s*)*(?:@\w[^\n]*\n\s*)*(\w+)\s*(?:=\s*[^;,\n]+)?",
    )
    for fm in field_re.finditer(body):
        doc, field_name = fm.group(1), fm.group(2)
        if field_name.startswith("_"):
            continue
        if "@igltfInput" not in doc:
            continue
        tag_idx = doc.index("@igltfInput")
        brace = doc.find("{", tag_idx)
        if brace < 0:
            continue
        depth_j = 0
        parsed = None
        for j in range(brace, len(doc)):
            if doc[j] == "{":
                depth_j += 1
            elif doc[j] == "}":
                depth_j -= 1
                if depth_j == 0:
                    try:
                        parsed = json.loads(doc[brace : j + 1])
                    except json.JSONDecodeError:
                        parsed = None
                    break
        if isinstance(parsed, dict) and isinstance(parsed.get("kind"), str):
            out[field_name] = parsed
    return out


def _input_kind(defn: dict[str, Any]) -> str:
    kind = defn.get("kind")
    if kind in ("string", "number", "boolean"):
        return "scalar"
    return str(kind)


def annotation_to_mcp_field(field_name: str, defn: dict[str, Any]) -> dict[str, Any]:
    return {"field": field_name, "inputKind": _input_kind(defn), "inputDef": defn}


def _is_script_ref(v: Any) -> bool:
    return isinstance(v, dict) and v.get("kind") == "script" and isinstance(v.get("assetId"), str)


def _is_gltf_asset_ref(v: Any) -> bool:
    return isinstance(v, dict) and v.get("kind") == "gltfAsset" and isinstance(v.get("assetId"), str)


def _is_script_attachment_ref(v: Any) -> bool:
    return (
        isinstance(v, dict)
        and v.get("kind") == "scriptAttachment"
        and isinstance(v.get("nodeId"), str)
        and isinstance(v.get("attachmentId"), str)
    )


def _asset_by_id(assets: list[dict[str, Any]] | None, asset_id: str) -> dict[str, Any] | None:
    if not assets:
        return None
    for raw in assets:
        if isinstance(raw, dict) and raw.get("assetId") == asset_id:
            return raw
    return None


def validate_input_value(
    field_name: str,
    defn: dict[str, Any],
    value: Any,
    *,
    node_ids: set[str] | None = None,
    assets: list[dict[str, Any]] | None = None,
) -> str | None:
    if value is None:
        return None
    kind = _input_kind(defn)

    if kind == "scalar":
        if isinstance(value, (str, int, float, bool)):
            return None
        return f"Expected scalar for {field_name}"

    if kind == "node":
        if not _is_node_ref(value):
            return f"Expected node ref for {field_name}"
        nid = value["id"].strip()
        if not nid:
            return f"Node ref id required for {field_name}"
        if node_ids is not None and nid not in node_ids:
            return f"Unknown node id {nid} for {field_name}"
        return None

    if kind == "script":
        if not _is_script_ref(value):
            return f"Expected script ref for {field_name}"
        aid = value["assetId"].strip()
        if not aid:
            return f"Script assetId required for {field_name}"
        asset = _asset_by_id(assets, aid)
        if assets is not None and asset is None:
            return f"Unknown script asset {aid} for {field_name}"
        if asset is not None and asset.get("assetKind") not in (None, "script"):
            return f"Asset {aid} is not a script for {field_name}"
        required_export = defn.get("exportName") or value.get("exportName")
        exports = asset.get("scriptExports") if asset else None
        if required_export and isinstance(exports, list) and exports:
            if required_export not in exports:
                return f"Script asset {aid} does not export {required_export}"
        return None

    if kind == "scriptAttachment":
        if not _is_script_attachment_ref(value):
            return f"Expected scriptAttachment ref for {field_name}"
        if not value["nodeId"].strip():
            return f"Node id required for {field_name}"
        if not value["attachmentId"].strip():
            return f"Attachment id required for {field_name}"
        if node_ids is not None and value["nodeId"] not in node_ids:
            return f"Unknown node id {value['nodeId']} for {field_name}"
        return None

    if kind == "gltfAsset":
        if not _is_gltf_asset_ref(value):
            return f"Expected gltfAsset ref for {field_name}"
        aid = value["assetId"].strip()
        if not aid:
            return f"gltfAsset assetId required for {field_name}"
        asset = _asset_by_id(assets, aid)
        if assets is not None and asset is None:
            return f"Unknown gltf asset {aid} for {field_name}"
        if asset is not None and asset.get("assetKind") not in (None, "gltf"):
            return f"Asset {aid} is not gltf for {field_name}"
        return None

    if kind == "object":
        if (
            not isinstance(value, dict)
            or _is_node_ref(value)
            or _is_script_ref(value)
            or _is_gltf_asset_ref(value)
            or _is_script_attachment_ref(value)
        ):
            return f"Expected object for {field_name}"
        fields = defn.get("fields") if isinstance(defn.get("fields"), dict) else {}
        for sub_key, sub_def in fields.items():
            if not isinstance(sub_def, dict):
                continue
            err = validate_input_value(
                f"{field_name}.{sub_key}",
                sub_def,
                value.get(sub_key),
                node_ids=node_ids,
                assets=assets,
            )
            if err:
                return err
        return None

    return None


def coerce_input_value(field_name: str, defn: dict[str, Any], semantic: Any) -> Any:
    kind = _input_kind(defn)

    if kind == "node":
        if isinstance(semantic, dict) and isinstance(semantic.get("nodeId"), str):
            return {"kind": "node", "id": semantic["nodeId"].strip()}
        if isinstance(semantic, str):
            return {"kind": "node", "id": semantic.strip()}
        if _is_node_ref(semantic):
            return semantic
        raise ValueError(f"Invalid semantic node value for {field_name}")

    if kind == "script":
        if isinstance(semantic, dict) and isinstance(semantic.get("scriptAssetId"), str):
            ref: dict[str, Any] = {"kind": "script", "assetId": semantic["scriptAssetId"].strip()}
            en = semantic.get("exportName") if isinstance(semantic.get("exportName"), str) else defn.get("exportName")
            if isinstance(en, str) and en.strip():
                ref["exportName"] = en.strip()
            return ref
        if _is_script_ref(semantic):
            return semantic
        raise ValueError(f"Invalid semantic script value for {field_name}")

    if kind == "scriptAttachment":
        if isinstance(semantic, dict) and isinstance(semantic.get("nodeId"), str) and isinstance(
            semantic.get("attachmentId"), str
        ):
            return {
                "kind": "scriptAttachment",
                "nodeId": semantic["nodeId"].strip(),
                "attachmentId": semantic["attachmentId"].strip(),
            }
        if _is_script_attachment_ref(semantic):
            return semantic
        raise ValueError(f"Invalid semantic scriptAttachment value for {field_name}")

    if kind == "gltfAsset":
        if isinstance(semantic, dict) and isinstance(semantic.get("gltfAssetId"), str):
            return {"kind": "gltfAsset", "assetId": semantic["gltfAssetId"].strip()}
        if _is_gltf_asset_ref(semantic):
            return semantic
        raise ValueError(f"Invalid semantic gltfAsset value for {field_name}")

    if kind == "object":
        if not isinstance(semantic, dict):
            raise ValueError(f"Invalid semantic object for {field_name}")
        fields = defn.get("fields") if isinstance(defn.get("fields"), dict) else {}
        out: dict[str, Any] = {}
        for sub_key, sub_def in fields.items():
            if not isinstance(sub_def, dict) or sub_key not in semantic:
                continue
            out[sub_key] = coerce_input_value(f"{field_name}.{sub_key}", sub_def, semantic[sub_key])
        for k, v in semantic.items():
            if k in out:
                continue
            if v is None or isinstance(v, (str, int, float, bool)):
                out[k] = v
        return out

    if semantic is None:
        return None
    if isinstance(semantic, bool):
        return semantic
    if isinstance(semantic, (int, float)):
        return semantic
    if isinstance(semantic, str):
        if defn.get("kind") == "number":
            try:
                return float(semantic)
            except ValueError:
                return 0
        return semantic
    raise ValueError(f"Invalid semantic scalar for {field_name}")


def format_stored_for_display(
    defn: dict[str, Any],
    stored: Any,
    *,
    node_name: Callable[[str], str] | None = None,
    asset_name: Callable[[str], str] | None = None,
    attachment_label: Callable[[str, str], str] | None = None,
) -> str:
    if stored is None:
        return "—"
    kind = _input_kind(defn)
    if kind == "node" and _is_node_ref(stored):
        return node_name(stored["id"]) if node_name else stored["id"]
    if kind == "script" and _is_script_ref(stored):
        base = asset_name(stored["assetId"]) if asset_name else stored["assetId"]
        en = stored.get("exportName")
        return f"{base} ({en})" if isinstance(en, str) and en else base
    if kind == "scriptAttachment" and _is_script_attachment_ref(stored):
        if attachment_label:
            return attachment_label(stored["nodeId"], stored["attachmentId"])
        return f"{stored['nodeId']} / {stored['attachmentId']}"
    if kind == "gltfAsset" and _is_gltf_asset_ref(stored):
        return asset_name(stored["assetId"]) if asset_name else stored["assetId"]
    if kind == "object" and isinstance(stored, dict):
        import json

        return json.dumps(stored, separators=(",", ":"))
    return str(stored)


def read_script_asset_source(
    project_id: str,
    script_asset_id: str,
    snapshot: dict[str, Any],
) -> tuple[str | None, dict[str, Any] | None, str | None]:
    """Return (source, asset_row, error_message)."""
    assets = snapshot.get("assets")
    if not isinstance(assets, list):
        return None, None, f"Script asset {script_asset_id!r} not found in live catalog"
    asset = _asset_by_id(assets, script_asset_id)
    if asset is None:
        return None, None, f"Script asset {script_asset_id!r} not found in live catalog"
    if asset.get("assetKind") not in (None, "script"):
        return None, None, f"Asset {script_asset_id!r} is not a script"

    inline = asset.get("sourceText")
    if isinstance(inline, str) and inline.strip():
        return inline, asset, None

    rel = asset.get("relativePath")
    if not isinstance(rel, str) or not rel.strip():
        return None, asset, "Script asset has no relativePath or sourceText"

    from app.storage import project_dir

    base = project_dir(project_id).resolve()
    disk = (base / rel.lstrip("/").replace("\\", "/")).resolve()
    try:
        disk.relative_to(base)
    except ValueError:
        return None, asset, "Invalid script asset path"
    if not disk.is_file():
        return None, asset, f"Script file missing on disk: {rel}"
    if disk.suffix.lower() not in (".js", ".mjs", ".cjs"):
        return None, asset, "Not a JavaScript asset"
    return disk.read_text(encoding="utf-8"), asset, None


def script_export_name(asset: dict[str, Any]) -> str | None:
    exports = asset.get("scriptExports")
    if isinstance(exports, list) and exports and isinstance(exports[0], str):
        return exports[0]
    return None
