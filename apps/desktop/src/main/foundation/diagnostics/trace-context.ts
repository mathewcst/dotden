/**
 * Diagnostics trace context — ambient Operation correlation for Command records.
 *
 * This is intentionally Node-only and Electron-free. `OperationTracer` enters the
 * context when an Operation span opens; `runCommand` reads it at the process seam
 * so transports do not need to thread `traceId` through every pure method.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

interface TraceContext {
  readonly traceId: string
}

const storage = new AsyncLocalStorage<TraceContext | undefined>()

/** Return the trace id attached to the current async chain, when one exists. */
export function currentTraceId(): string | undefined {
  return storage.getStore()?.traceId
}

/**
 * Run `body` inside a diagnostics trace context.
 *
 * This is mostly a test/helper seam; production normally uses OperationTracer
 * spans, which call {@link enterTraceId} and restore the previous context on end.
 */
export function runWithTraceId<T>(traceId: string, body: () => T): T {
  return storage.run({ traceId }, body)
}

/**
 * Enter a trace context for the current async chain and return a restore function.
 *
 * `AsyncLocalStorage.run()` is callback-shaped, but OperationTracer's public API is
 * span-shaped (`startOperation` → work → `end`). Capturing the previous store lets
 * the span restore nested/outside contexts when it ends without changing callers.
 */
export function enterTraceId(traceId: string): () => void {
  const previous = storage.getStore()
  storage.enterWith({ traceId })
  return () => {
    storage.enterWith(previous)
  }
}
