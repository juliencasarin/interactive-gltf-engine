from app.script_input_schema import parse_igltf_input_annotations, remap_node_refs_in_serialized_props


SAMPLE = """
export class DoorOpener {
  /** @igltfInput { "kind": "node" } */
  doorTarget = null

  /** @igltfInput { "kind": "object", "fields": { "speed": { "kind": "number" } } } */
  tuning = { speed: 1 }

  /** @igltfInput { "kind": "scriptAttachment", "exportName": "RotateWheel" } */
  wheelBehaviour = null
}
"""


def test_parse_igltf_input_annotations():
    ann = parse_igltf_input_annotations(SAMPLE, "DoorOpener")
    assert ann["doorTarget"]["kind"] == "node"
    assert ann["tuning"]["fields"]["speed"]["kind"] == "number"
    assert ann["wheelBehaviour"]["kind"] == "scriptAttachment"


def test_remap_node_refs():
    props = {
        "doorTarget": {"kind": "node", "id": "author-n"},
        "targetId": "author-n",
        "speed": 2,
    }
    out = remap_node_refs_in_serialized_props(
        props,
        lambda nid: "3" if nid == "author-n" else None,
    )
    assert out["doorTarget"] == {"kind": "node", "id": "3"}
    assert out["targetId"] == "3"
    assert out["speed"] == 2


def test_remap_script_attachment_node_id():
    props = {
        "wheel": {"kind": "scriptAttachment", "nodeId": "author-n", "attachmentId": "att-1"},
    }
    out = remap_node_refs_in_serialized_props(
        props,
        lambda nid: "7" if nid == "author-n" else None,
    )
    assert out["wheel"]["nodeId"] == "7"
    assert out["wheel"]["attachmentId"] == "att-1"
