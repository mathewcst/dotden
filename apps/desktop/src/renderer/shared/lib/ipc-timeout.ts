/**
 * Bound renderer awaits on IPC calls that own a busy UI state. A hung or dropped invoke reply is
 * rare, but when it happens the user must get a recoverable surface instead of a permanent spinner.
 */
export const IPC_LIVENESS_TIMEOUT_MS = 15_000

/** Error raised when a busy-state IPC call does not settle inside the liveness window. */
export class IpcTimeoutError extends Error {
  constructor(message = 'The operation did not respond. Retry or go back.') {
    super(message)
    this.name = 'IpcTimeoutError'
  }
}

/** Race a promise against the standard renderer liveness timeout. */
export function withIpcTimeout<T>(
  promise: Promise<T>,
  message?: string,
  timeoutMs = IPC_LIVENESS_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new IpcTimeoutError(message)), timeoutMs)
    promise.then(
      (value) => {
        window.clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timeout)
        reject(error)
      },
    )
  })
}
