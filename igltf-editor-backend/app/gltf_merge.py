"""Merge one embedded-buffer ``.glb`` asset into another (pygltflib).

Both inputs must use a single buffer with ``uri is None`` (standard ``.glb`` layout).
Appends bufferViews/accessors/images/samplers/textures/materials/meshes from ``src``
into ``dst``, concatenates binary payloads with alignment padding, and remaps indices.

Does **not** copy nodes, scenes, skins, animations, or cameras from ``src``.
"""

from __future__ import annotations

import copy
from pygltflib import (
    Accessor,
    Attributes,
    Buffer,
    BufferView,
    GLTF2,
    Image,
    Material,
    Mesh,
    Primitive,
    Sampler,
    Texture,
    TextureInfo,
)


def _embedded_trim(g: GLTF2) -> bytes:
    blob = g.binary_blob()
    if blob is None:
        return b""
    if not g.buffers or g.buffers[0].byteLength is None:
        return bytes(blob)
    return bytes(blob[: int(g.buffers[0].byteLength)])


def _ensure_single_embedded_buffer(label: str, g: GLTF2) -> None:
    if not g.buffers or len(g.buffers) != 1:
        raise ValueError(f"{label}: expected exactly one buffer")
    if g.buffers[0].uri is not None:
        raise ValueError(f"{label}: buffer.uri must be empty (embedded .glb)")


def _union_extensions(dst: GLTF2, src: GLTF2) -> None:
    if dst.extensionsUsed is None:
        dst.extensionsUsed = []
    if dst.extensionsRequired is None:
        dst.extensionsRequired = []
    for ext in src.extensionsUsed or []:
        if ext not in (dst.extensionsUsed or []):
            dst.extensionsUsed.append(ext)
    for ext in src.extensionsRequired or []:
        if ext not in (dst.extensionsRequired or []):
            dst.extensionsRequired.append(ext)


def _remap_accessor_bv(acc: Accessor, bv_base: int) -> None:
    if acc.bufferView is not None:
        acc.bufferView += bv_base
    sp = acc.sparse
    if sp and sp.indices and sp.indices.bufferView is not None:
        sp.indices.bufferView += bv_base
    if sp and sp.values and sp.values.bufferView is not None:
        sp.values.bufferView += bv_base


def _shift_tex_info(ti: TextureInfo | None, tex_base: int) -> None:
    if ti is not None and ti.index is not None:
        ti.index += tex_base


def _remap_material_copy(m: Material, tex_base: int) -> None:
    pbr = m.pbrMetallicRoughness
    if pbr:
        _shift_tex_info(pbr.baseColorTexture, tex_base)
        _shift_tex_info(pbr.metallicRoughnessTexture, tex_base)
    nt = m.normalTexture
    if nt is not None and nt.index is not None:
        nt.index += tex_base
    ot = m.occlusionTexture
    if ot is not None and ot.index is not None:
        ot.index += tex_base
    _shift_tex_info(m.emissiveTexture, tex_base)


def _remap_attributes(attr: Attributes | None, acc_base: int) -> None:
    if not attr:
        return
    for k, v in list(attr.__dict__.items()):
        if v is not None and isinstance(v, int):
            setattr(attr, k, v + acc_base)


def _remap_primitive(prim: Primitive, acc_base: int, mat_base: int) -> None:
    if prim.indices is not None:
        prim.indices += acc_base
    _remap_attributes(prim.attributes, acc_base)
    if prim.material is not None:
        prim.material += mat_base
    for tgt in prim.targets or []:
        _remap_attributes(tgt, acc_base)


def merge_embedded_glb_into(dst: GLTF2, src: GLTF2) -> None:
    """Append ``src`` geometry/resources into ``dst`` (mutates ``dst``)."""

    _ensure_single_embedded_buffer("merge dst", dst)
    _ensure_single_embedded_buffer("merge src", src)

    dst_trim = _embedded_trim(dst)
    src_trim = _embedded_trim(src)

    align = dst.required_alignment()
    pad = (-len(dst_trim)) % align
    append_base = len(dst_trim) + pad
    new_blob = dst_trim + (b"\x00" * pad) + src_trim

    bv_base = len(dst.bufferViews or [])
    acc_base = len(dst.accessors or [])
    img_base = len(dst.images or [])
    samp_base = len(dst.samplers or [])
    tex_base = len(dst.textures or [])
    mat_base = len(dst.materials or [])
    # mesh_base unused here — callers track cumulative mesh offsets

    new_bvs: list[BufferView] = []
    for bv in src.bufferViews or []:
        nb = copy.deepcopy(bv)
        nb.buffer = 0
        off = nb.byteOffset if nb.byteOffset is not None else 0
        nb.byteOffset = off + append_base
        new_bvs.append(nb)
    dst.bufferViews = list(dst.bufferViews or []) + new_bvs

    new_accs: list[Accessor] = []
    for acc in src.accessors or []:
        na = copy.deepcopy(acc)
        _remap_accessor_bv(na, bv_base)
        new_accs.append(na)
    dst.accessors = list(dst.accessors or []) + new_accs

    new_imgs: list[Image] = []
    for img in src.images or []:
        ni = copy.deepcopy(img)
        if ni.bufferView is not None:
            ni.bufferView += bv_base
        new_imgs.append(ni)
    dst.images = list(dst.images or []) + new_imgs

    new_samps = [copy.deepcopy(s) for s in (src.samplers or [])]
    dst.samplers = list(dst.samplers or []) + new_samps

    new_texs: list[Texture] = []
    for tex in src.textures or []:
        nt = copy.deepcopy(tex)
        if nt.source is not None:
            nt.source += img_base
        if nt.sampler is not None:
            nt.sampler += samp_base
        new_texs.append(nt)
    dst.textures = list(dst.textures or []) + new_texs

    new_mats: list[Material] = []
    for mat in src.materials or []:
        nm = copy.deepcopy(mat)
        _remap_material_copy(nm, tex_base)
        new_mats.append(nm)
    dst.materials = list(dst.materials or []) + new_mats

    new_meshes: list[Mesh] = []
    for mesh in src.meshes or []:
        nm = copy.deepcopy(mesh)
        for prim in nm.primitives or []:
            _remap_primitive(prim, acc_base, mat_base)
        new_meshes.append(nm)
    dst.meshes = list(dst.meshes or []) + new_meshes

    dst.buffers = [Buffer(uri=None, byteLength=len(new_blob))]
    dst.set_binary_blob(bytearray(new_blob))
    _union_extensions(dst, src)
