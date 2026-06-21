/** A failed Operation surfaced to the shell with enough context for Details + Retry. */
export interface OperationError {
  readonly message: string
  readonly traceId?: string
  readonly retry?: () => Promise<void>
}

function messageFromError(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback
}

function traceIdFromError(caught: unknown): string | undefined {
  if (typeof caught !== 'object' || caught === null || !('traceId' in caught)) return undefined
  const traceId = (caught as { traceId?: unknown }).traceId
  return typeof traceId === 'string' ? traceId : undefined
}

/** Normalize thrown values into the shared shell error surface. */
export function operationError(
  caught: unknown,
  fallback: string,
  retry?: () => Promise<void>,
): OperationError {
  const traceId = traceIdFromError(caught)
  return {
    message: messageFromError(caught, fallback),
    ...(traceId ? { traceId } : {}),
    ...(retry ? { retry } : {}),
  }
}
