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
import type { ResolutionChoice } from '../foundation/conflict-model.js'
import type { DiscoveryScanner } from '../foundation/discovery-scanner.js'
import type { EnvironmentRegistry } from '../foundation/environment-registry.js'
import type { RemoteClient } from '../foundation/remote-client.js'
import type { AutomationLevel } from '../foundation/automation-policy.js'

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
  /** Lazily resolves the shared {@link DiscoveryScanner} bound to this environment's home dir. */
  readonly discoveryScanner: () => Promise<DiscoveryScanner>
  /** Lazily resolves the shared {@link EnvironmentRegistry} for identity/labels/attribution. */
  readonly environmentRegistry: () => Promise<EnvironmentRegistry>
  /**
   * Read this environment's selected automation level (issue 1-12). Environment-local,
   * defaulting to Manual — the bridge just forwards it to `automation:get-level`.
   */
  readonly getAutomationLevel: () => Promise<AutomationLevel>
  /**
   * Persist this environment's automation level AND re-arm the automation-dependent
   * services (rebuild the DenService so its policy uses the new level; re-pace/dormant the
   * TrayPoller). index.ts owns that re-arming; the bridge only routes the user's choice.
   * Rejects a level the MVP does not expose (never persist an unbuilt rung).
   */
  readonly setAutomationLevel: (level: AutomationLevel) => Promise<void>
}

/**
 * Register every dotden IPC channel on `registrar`, routing to `deps` and threading
 * each call's `_trace` id through to the foundation.
 *
 * Channels (all payloads carry `_trace`):
 * - `remote:preflight` / `remote:connect` / `remote:latest-sha` → {@link RemoteClient}
 * - `den:track` / `den:commit` / `den:sync-push` / `den:list-incoming` /
 *   `den:incoming-summary` / `den:incoming-diff` / `den:apply` / `den:tree` /
 *   `den:diff` / `den:untrack` / `den:delete-everywhere` /
 *   `den:affected-environments` → {@link DenService}
 * - `discover:scan` / `discover:inspect-path` → {@link DiscoveryScanner} (issue 1-06)
 * - `automation:get-level` / `automation:set-level` → environment-local automation
 *   settings (issue 1-12); set-level re-arms the automation services via index.ts
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
  // The Review & Apply surface (issue 1-09): the incoming summary names the source
  // environment for the top-level "N incoming from <env>" entry; incoming-diff previews
  // an incoming File before Apply. incoming-summary fetches (a sync Operation, _trace
  // forwarded); incoming-diff is read-only (asserts the `_trace` envelope only).
  registrar.handle('den:incoming-summary', async (_event, payload: TracedPayload) => {
    return (await deps.denService()).incomingSummary(traceId(payload))
  })
  registrar.handle('den:incoming-diff', async (_event, payload: TracedPayload) => {
    traceId(payload)
    const { targetPath } = payload as TracedPayload & { targetPath: string }
    return (await deps.denService()).incomingDiff(targetPath)
  })
  registrar.handle('den:apply', async (_event, payload: TracedPayload) => {
    const { targetPaths, confirmedDeletions } = payload as TracedPayload & {
      targetPaths: readonly string[]
      confirmedDeletions?: readonly string[]
    }
    // Forward the user-confirmed deletions so ApplyPlanner only applies a deletion the
    // user explicitly OK'd (invariant #4); default to none if the renderer omitted it.
    return (await deps.denService()).applyIncoming(
      targetPaths,
      traceId(payload),
      confirmedDeletions ?? [],
    )
  })
  // The Conflict path (issue 1-11): detect fetches+merges in the source repo (a sync
  // Operation, _trace forwarded) and surfaces true Conflicts; resolve/complete/abort MUTATE
  // the merge, so each forwards its _trace so the Operation emits a correlated wide event.
  registrar.handle('den:detect-conflicts', async (_event, payload: TracedPayload) => {
    return (await deps.denService()).detectConflicts(traceId(payload))
  })
  registrar.handle('den:resolve-conflict', async (_event, payload: TracedPayload) => {
    const { targetPath, choice } = payload as TracedPayload & {
      targetPath: string
      choice: ResolutionChoice
    }
    // The user's explicit choice is the ONLY input that mints resolved bytes (invariant #1):
    // DenService routes it through ConflictModel.resolve — the bridge never resolves itself.
    return (await deps.denService()).resolveConflictFile(targetPath, choice, traceId(payload))
  })
  registrar.handle('den:complete-conflicts', async (_event, payload: TracedPayload) => {
    return (await deps.denService()).completeConflictResolution(traceId(payload))
  })
  registrar.handle('den:abort-conflicts', async (_event, payload: TracedPayload) => {
    return (await deps.denService()).abortConflictResolution(traceId(payload))
  })
  // The three-pane view queries (issue 1-07): managed File tree + per-File diff.
  // Read-only, so DenService emits no wide event for them, but each still asserts the
  // `_trace` envelope (via traceId) so EVERY IPC call crosses the boundary correlated.
  registrar.handle('den:tree', async (_event, payload: TracedPayload) => {
    traceId(payload)
    return (await deps.denService()).fileTree()
  })
  registrar.handle('den:diff', async (_event, payload: TracedPayload) => {
    traceId(payload)
    const { targetPath } = payload as TracedPayload & { targetPath: string }
    return (await deps.denService()).fileDiff(targetPath)
  })
  // The destructive/lifecycle verbs (issue 1-08): Untrack (`forget`) and Delete
  // everywhere (`destroy`) MUTATE the Den, so their `_trace` id IS forwarded so each
  // emits a correlated wide event. affected-environments is the read-only blast-radius
  // query the destructive confirm names before proceeding (it asserts `_trace` only).
  registrar.handle('den:untrack', async (_event, payload: TracedPayload) => {
    const { targetPath } = payload as TracedPayload & { targetPath: string }
    return (await deps.denService()).untrackFile(targetPath, traceId(payload))
  })
  registrar.handle('den:delete-everywhere', async (_event, payload: TracedPayload) => {
    const { targetPath } = payload as TracedPayload & { targetPath: string }
    return (await deps.denService()).deleteEverywhereFile(targetPath, traceId(payload))
  })
  registrar.handle('den:affected-environments', async (_event, payload: TracedPayload) => {
    traceId(payload)
    const { targetPath } = payload as TracedPayload & { targetPath: string }
    return (await deps.denService()).affectedEnvironments(targetPath)
  })

  // The Workspaces + nested Groups organization layer (issue 1-14): create a Workspace
  // (access boundary) / Group (organization), and re-file a File between Groups or
  // Workspaces. Each MUTATES the synced `.myenv/` metadata, so its `_trace` id IS
  // forwarded so the organize Operation emits a correlated wide event.
  registrar.handle('den:create-workspace', async (_event, payload: TracedPayload) => {
    const { label } = payload as TracedPayload & { label: string }
    return (await deps.denService()).createWorkspace(label, traceId(payload))
  })
  registrar.handle('den:create-group', async (_event, payload: TracedPayload) => {
    const { workspaceId, label, parentId } = payload as TracedPayload & {
      workspaceId: string
      label: string
      parentId: string | null
    }
    return (await deps.denService()).createGroup(workspaceId, label, parentId, traceId(payload))
  })
  registrar.handle('den:move-to-group', async (_event, payload: TracedPayload) => {
    const { targetPath, groupId } = payload as TracedPayload & {
      targetPath: string
      groupId: string | null
    }
    return (await deps.denService()).moveFileToGroup(targetPath, groupId, traceId(payload))
  })
  registrar.handle('den:set-file-workspace', async (_event, payload: TracedPayload) => {
    const { targetPath, workspaceId } = payload as TracedPayload & {
      targetPath: string
      workspaceId: string
    }
    return (await deps.denService()).setFileWorkspace(targetPath, workspaceId, traceId(payload))
  })

  // ── Discovery channels (issue 1-06): first-run tool-catalog scan + drag-in inspect ──
  // Read-only: discovery only FINDS candidate Files; Tracking a pick is the den:track path.
  // Each still asserts the `_trace` envelope so EVERY IPC call is uniformly correlated.
  registrar.handle('discover:scan', async (_event, payload: TracedPayload) => {
    traceId(payload)
    return (await deps.discoveryScanner()).scan()
  })
  registrar.handle('discover:inspect-path', async (_event, payload: TracedPayload) => {
    traceId(payload)
    const { targetPath } = payload as TracedPayload & { targetPath: string }
    return (await deps.discoveryScanner()).inspectCustomPath(targetPath)
  })

  // ── Environment channels (issue 1-05): identity, editable label, git-log attribution ──
  // These still assert the `_trace` envelope (via traceId(payload)) so EVERY IPC call is
  // uniformly correlated, even though the registry methods do not take a trace id today.
  registrar.handle('env:list', async (_event, payload: TracedPayload) => {
    traceId(payload)
    const registry = await deps.environmentRegistry()
    // Idempotently ensure THIS environment is registered + its id is mirrored into the
    // local chezmoi config before listing, so the identity surface always has a self
    // entry to show (and the subscription seam is in place) even before the first Track.
    await registry.setupIdentity()
    return registry.list()
  })
  registrar.handle('env:rename', async (_event, payload: TracedPayload) => {
    traceId(payload)
    const { label } = payload as TracedPayload & { label: string }
    const registry = await deps.environmentRegistry()
    await registry.renameLabel(label)
    // Return the renamed entry joined with attribution so the UI re-renders in one round-trip.
    const list = await registry.list()
    const self = list.find((e) => e.isSelf)
    if (!self) throw new Error('Renamed environment is not present in the registry')
    return self
  })
  registrar.handle('env:suggest-claims', async (_event, payload: TracedPayload) => {
    traceId(payload)
    return (await deps.environmentRegistry()).suggestClaims()
  })

  // ── Automation channels (issue 1-12): the environment-local automation ladder ──
  // get-level is read-only; set-level MUTATES local settings and re-arms the automation
  // services (DenService policy + TrayPoller), so index.ts owns the re-arming behind
  // `setAutomationLevel`. Both still assert the `_trace` envelope so EVERY IPC call is
  // uniformly correlated, even though the level read/write does not take a trace id today.
  registrar.handle('automation:get-level', async (_event, payload: TracedPayload) => {
    traceId(payload)
    return deps.getAutomationLevel()
  })
  registrar.handle('automation:set-level', async (_event, payload: TracedPayload) => {
    traceId(payload)
    const { level } = payload as TracedPayload & { level: AutomationLevel }
    // The store rejects a non-MVP level; let that surface to the renderer (never persist
    // an unbuilt rung). index.ts's setAutomationLevel also re-arms the services on success.
    await deps.setAutomationLevel(level)
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
