/** Must match backend `app/igltf_umi3d_proto.py`. */
export const EXT_IGLTF_UMI3D_PROTO = 'EXT_IGLTF_UMI3D_PROTO'

export type Umi3dProtoAttachment = {
  attachmentId: string
  scriptAssetRef: string
  scriptRelativePath: string
  scriptHandlerId: string
  interactionKind: string
  serializedProps: Record<string, unknown>
  dto?: { interactionType?: string; hold?: boolean }
}

export type Umi3dProtoNodePayload = {
  protoVersion: number
  gltfNodeIndex: number
  attachments: Umi3dProtoAttachment[]
}

export type GltfNodeDef = {
  children?: number[]
  extensions?: Record<string, unknown>
}

export type GltfJson = {
  scene?: number
  scenes: { nodes?: number[] }[]
  nodes: GltfNodeDef[]
}
