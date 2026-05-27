"""Tests for Play proto attachment serialization (hold export)."""

from app.igltf_umi3d_proto import event_hold_from_serialized_props, umi3d_proto_attachment_entry


def test_event_hold_from_serialized_props() -> None:
    assert event_hold_from_serialized_props({"hold": True}) is True
    assert event_hold_from_serialized_props({"hold": False}) is False
    assert event_hold_from_serialized_props({}) is False
    assert event_hold_from_serialized_props(None) is False



def test_proto_attachment_entry_sets_dto_hold_from_event_hold() -> None:
    entry = umi3d_proto_attachment_entry(
        attachment_id="att-1",
        script_asset_ref="script-ref",
        script_relative_path="assets/PushSimpleTableInteraction.js",
        script_handler_id="PushSimpleTableInteraction",
        interaction_kind="event",
        serialized_props={
            "hold": True,
            "durationSeconds": 0.25,
            "targetId": "146",
        },
        event_hold=True,
    )
    assert entry["dto"]["hold"] is True
    assert entry["serializedProps"]["hold"] is True


def test_proto_attachment_entry_hold_defaults_false() -> None:
    entry = umi3d_proto_attachment_entry(
        attachment_id="att-2",
        script_asset_ref="script-ref",
        script_relative_path="assets/Click.js",
        script_handler_id="Click",
        interaction_kind="event",
        serialized_props={"hold": True},
        event_hold=False,
    )
    assert entry["dto"]["hold"] is False
    assert entry["serializedProps"]["hold"] is True
