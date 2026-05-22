import type { IgltfTransaction, IgltfTransactionBuilder } from './igltfHost'

/** True when a script hook returned a v1 transaction object. */
export function isIgltfTransaction(value: unknown): value is IgltfTransaction {
  if (!value || typeof value !== 'object') return false
  const tx = value as IgltfTransaction
  return tx.version === 1 && Array.isArray(tx.operations)
}

function isTransactionBuilder(value: unknown): value is IgltfTransactionBuilder {
  if (!value || typeof value !== 'object') return false
  return typeof (value as IgltfTransactionBuilder).build === 'function'
}

/** Accept plain JSON or a builder from `GLTF.createTransaction()`. */
export function normalizeIgltfTransaction(
  value: IgltfTransaction | IgltfTransactionBuilder | unknown,
): IgltfTransaction | null {
  if (isIgltfTransaction(value)) return value
  if (isTransactionBuilder(value)) return value.build()
  return null
}
