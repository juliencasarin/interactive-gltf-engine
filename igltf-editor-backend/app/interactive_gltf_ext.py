"""Root-level interactive glTF extension id and payload (scripts manifest)."""

from __future__ import annotations

EXT_INTERACTIVE_GLTF = "EXT_interactive_gltf"


def interactive_gltf_root_extension_value() -> dict:
    """Single sidecar bundle next to ``scene.glb`` (see build pipeline)."""
    return {
        "scripts": [
            {
                "id": 0,
                "uri": "scene.js",
                "mimeType": "text/javascript",
                "kind": "classic",
            }
        ]
    }
