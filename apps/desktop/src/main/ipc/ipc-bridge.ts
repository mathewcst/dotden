/**
 * IpcBridge — the typed renderer↔main IPC boundary, with a `_trace` envelope on
 * every call (ADR 0007, issue 1-04).
 *
 * Every channel handler here takes a payload that carries a `_trace` correlation id
 * minted by the preload per user action, so one Operation is correlatable end to end
 * (renderer → IpcBridge → DenService/RemoteClient → OperationTracer wide event). The
 * bridge **forwards** that id into the foundation; it never re-derives an invariant
 * an owner guarantees (ADR 0008) — it routes, the owners decide.
 *
 * The bridge is defined against a tiny {@link IpcRegistrar} seam (Electron's
 * `ipcMain.handle` in production) so the wiring — including the "_trace is present
 * on every call" contract — is unit-testable in plain Node without Electron
 * (ADR 0023 keeps the testable core Electron-free; only `index.ts` passes the real
 * `ipcMain`).
 */
import type { DenService } from '../foundation/den-service.js'
import type { RemoteClient } from '../foundation/remote-client.js'

/**
 * The minimal trace envelope every IPC payload carries.
 *
 * Mirrors the preload's `_trace` (a correlation id). The full trace-context codec
 * (ADR 0007 `TraceContextCodec`) is a later slice; the MVP only needs the id to
 * line a renderer call up with its wide event.
 */
export interface TraceEnvelope {
  /** Correlation id minted per user action in the preload. */
  readonly traceId: string
}

/** Any IPC payload shape, constrained so the bridge can read its `_trace`. */
type TracedPayload = { readonly _trace: TraceEnvelope }

/**
 * The subset of Electron's `ipcMain` the bridge depends on: register one async
 * handler per channel. Declared locally so the bridge module pulls in no Electron
 * types and can be driven by a fake in tests.
 */
export interface IpcRegistrar {
  /**
   * Register `handler` for `channel`. The handler receives an opaque event and the
   * renderer-sent payload, and returns a value serialized back over IPC.
   */
  handle(
    channel: string,
    handler: (event: unknown, payload: TracedPayload) => Promise<unknown>,
  ): void
}

/** Collaborators the bridge routes to. */
export interface IpcBridgeDeps {
  /** Lazily resolves the shared {@link RemoteClient} (built on first use in production). */
  readonly remoteClient: () => Promise<RemoteClient>
  /** Lazily resolves the shared {@link DenService} bound to this environment. */
  readonly denService: () => Promise<DenService>
}

/**
 * Register every dotden IPC channel on `registrar`, routing to `deps` and threading
 * each call's `_trace` id through to the foundation.
 *
 * Channels (all payloads carry `_trace`):
 * - `remote:preflight` / `remote:connect` / `remote:latest-sha` → {@link RemoteClient}
 * - `den:track` / `den:commit` / `den:sync-push` / `den:list-incoming` / `den:apply` →
 *   {@link DenService}
 *
 * The bridge asserts the `_trace` envelope is present on every call ({@link traceId}
 * throws on a missing id), making "an Operation crossed the boundary uncorrelated" a
 * hard failure rather than a silent gap (never fail silently).
 *
 * @param registrar Electron's `ipcMain` in production; a fake in tests.
 * @param deps Lazy accessors for the RemoteClient and DenService.
 */
export function registerIpcBridge(registrar: IpcRegistrar, deps: IpcBridgeDeps): void {
  // ── Remote channels (issue 1-03), kept here so ALL IPC carries _trace uniformly ──
  registrar.handle('remote:preflight', async (_event, payload: TracedPayload) => {
    const { url } = payload as TracedPayload & { url: string }
    return (await deps.remoteClient()).preflightRemote(url, {
      _trace: { traceId: traceId(payload) },
    })
  })
  registrar.handle('remote:connect', async (_event, payload: TracedPayload) => {
    const { url } = payload as TracedPayload & { url: string }
    return (await deps.remoteClient()).connectExistingRemote(url, {
      _trace: { traceId: traceId(payload) },
    })
  })
  registrar.handle('remote:latest-sha', async (_event, payload: TracedPayload) => {
    const { url, branch } = payload as TracedPayload & { url: string; branch?: string }
    return (await deps.remoteClient()).latestRemoteSha(url, branch, {
      _trace: { traceId: traceId(payload) },
    })
  })

  // ── Den channels (issue 1-04): the MVP sync loop, _trace forwarded to the tracer ──
  registrar.handle('den:track', async (_event, payload: TracedPayload) => {
    const { targetPath } = payload as TracedPayload & { targetPath: string }
    return (await deps.denService()).trackFile(targetPath, traceId(payload))
  })
  registrar.handle('den:commit', async (_event, payload: TracedPayload) => {
    const { targetPaths } = payload as TracedPayload & { targetPaths: readonly string[] }
    return (await deps.denService()).commitTracked(targetPaths, traceId(payload))
  })
  registrar.handle('den:sync-push', async (_event, payload: TracedPayload) => {
    return (await deps.denService()).syncPush(traceId(payload))
  })
  registrar.handle('den:list-incoming', async (_event, payload: TracedPayload) => {
    return (await deps.denService()).listIncomingClean(traceId(payload))
  })
  registrar.handle('den:apply', async (_event, payload: TracedPayload) => {
    const { targetPaths } = payload as TracedPayload & { targetPaths: readonly string[] }
    return (await deps.denService()).applyIncoming(targetPaths, traceId(payload))
  })
}

/**
 * Extract the `_trace.traceId` from an IPC payload, failing loudly when absent.
 *
 * The `_trace` envelope is the contract that makes an Operation correlatable across
 * the boundary (ADR 0007). A payload that reached a handler without one is a wiring
 * bug, so we throw rather than silently emit an uncorrelated Operation.
 *
 * @param payload The renderer-sent IPC payload.
 * @returns The correlation id.
 * @throws Error when `_trace.traceId` is missing or not a string.
 */
export function traceId(payload: TracedPayload): string {
  const id = payload._trace?.traceId
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('IPC call reached the bridge without a _trace envelope')
  }
  return id
}
