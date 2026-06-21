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
import type { LaunchState } from '../foundation/launch-state.js'
import type { RemoteClient } from '../foundation/remote-client.js'
import type { AutomationLevel } from '../foundation/automation-policy.js'
import type { SyncSettings } from '../foundation/sync-settings.js'
import type { PrivacySettings } from '../foundation/privacy-settings.js'
import type { Scope } from '../foundation/os-scope.js'
import type { UnsubscribeDisposition } from '../foundation/subscription-settings.js'
import type { SecretFinding } from '../foundation/secret-scanner.js'
import type { ConvertSecretRequest } from '../foundation/den-service.js'
import type { AppearanceOverride, AppearanceSettings } from '../../shared/appearance-settings.js'
import type { AppInfo, UpdateCheckResult } from '../../shared/app-info.js'

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
  /**
   * Compute the launch-routing gate (ADR 0026) for the renderer's boot decision. index.ts
   * implements this with side-effect-free reads (it does NOT go through {@link denService}/
   * `env:list`, which mint identity / register as a side effect and assume a working clone),
   * so the gate is safe to call before any Den exists. The bridge only routes it.
   */
  readonly launchState: () => Promise<LaunchState>
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
  /**
   * **Claim a returning registry entry** (issue 1-13): adopt `envId` as THIS install's local
   * identity (`claimLocalIdentity`) and re-arm the id-bound services (rebuild the DenService +
   * EnvironmentRegistry so they use the claimed id), so the returning environment keeps its
   * history/attribution. index.ts owns the re-arming + the userData write; the bridge only
   * routes the user's claim, then registers the subscription via the freshly-rebuilt registry.
   */
  readonly claimEnvironment: (envId: string) => Promise<void>
  /**
   * Read this environment's remembered un-subscribe disposition default (issue 1-13).
   * Environment-local (`userData`, never synced); the bridge just forwards it.
   */
  readonly getUnsubscribeDisposition: () => Promise<UnsubscribeDisposition>
  /** Persist this environment's remembered un-subscribe disposition default (issue 1-13). */
  readonly setUnsubscribeDisposition: (disposition: UnsubscribeDisposition) => Promise<void>
  /**
   * Read this environment's Sync settings — poller on/off · cadence · start-on-login (issue
   * 2-08). Environment-local (`userData`, never synced — ADR 0024); the bridge just forwards it.
   */
  readonly getSyncSettings: () => Promise<SyncSettings>
  /**
   * Persist this environment's Sync settings AND apply the side effects (issue 2-08): re-arm or
   * dismiss the TrayPoller for the new on-off + cadence, and set the OS login-item for
   * start-on-login. index.ts owns the re-arming + the autostart call; the bridge only routes the
   * user's choice and returns the persisted settings.
   */
  readonly setSyncSettings: (settings: SyncSettings) => Promise<SyncSettings>
  /**
   * Read this environment's privacy/telemetry consent — analytics · crash reports (issue 2-14).
   * Environment-local (`userData`, never synced — ADR 0024); the bridge just forwards it.
   */
  readonly getPrivacySettings: () => Promise<PrivacySettings>
  /**
   * Persist this environment's privacy/telemetry consent (issue 2-14). CONTROL SURFACE ONLY:
   * this records a stored boolean and has NO side effects — no egress, no SDK, no network call.
   * The consumers that act on consent are PRD 3 (issues 3-09/3-10). Returns the persisted
   * settings so the Privacy tab re-renders from the source of truth.
   */
  readonly setPrivacySettings: (settings: PrivacySettings) => Promise<PrivacySettings>
  /**
   * Read the running app's info — version + platform (issue 2-16). index.ts supplies the
   * canonical `app.getVersion()`; the bridge just forwards it for the About tab's version line.
   */
  readonly getAppInfo: () => Promise<AppInfo>
  /**
   * Run the About tab's update check (issue 2-16). index.ts wires the current version + the
   * placeholder feed (the real electron-updater feed is issue 3-20), so the bridge only routes the
   * request and returns the honest {@link UpdateCheckResult} — `unavailable` until a feed exists,
   * never a fake "you're current". NO download/install path is wired here (those are PRD 3).
   */
  readonly checkForUpdates: () => Promise<UpdateCheckResult>
  /**
   * Apply a chrome action to the BrowserWindow that sent the IPC request. Kept as a callback so
   * this bridge remains testable without importing Electron.
   */
  readonly controlWindow?: (
    event: unknown,
    action: 'minimize' | 'toggle-maximize' | 'close',
  ) => Promise<boolean | void>
}

/**
 * Register every dotden IPC channel on `registrar`, routing to `deps` and threading
 * each call's `_trace` id through to the foundation.
 *
 * Channels (all payloads carry `_trace`):
 * - `remote:preflight` / `remote:connect` / `remote:latest-sha` → {@link RemoteClient}
 * - `den:track` / `den:scan-commit` / `den:allowlist-secret` / `den:get-commit-template` /
 *   `den:set-commit-template` / `den:get-appearance` / `den:set-appearance` /
 *   `den:commit` / `den:sync-push` / `den:list-incoming` /
 *   `den:incoming-summary` / `den:incoming-diff` / `den:apply` / `den:tree` / `den:diff` /
 *   `den:untrack` / `den:delete-everywhere` / `den:affected-environments` → {@link DenService}
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
  // ── Frameless window chrome channels: TitleBar buttons over the preload bridge ──
  registrar.handle('window:minimize', async (event, payload: TracedPayload) => {
    traceId(payload)
    if (!deps.controlWindow) throw new Error('Window control IPC is not wired')
    return deps.controlWindow(event, 'minimize')
  })
  registrar.handle('window:toggle-maximize', async (event, payload: TracedPayload) => {
    traceId(payload)
    if (!deps.controlWindow) throw new Error('Window control IPC is not wired')
    return deps.controlWindow(event, 'toggle-maximize')
  })
  registrar.handle('window:close', async (event, payload: TracedPayload) => {
    traceId(payload)
    if (!deps.controlWindow) throw new Error('Window control IPC is not wired')
    return deps.controlWindow(event, 'close')
  })

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
  // The launch-routing gate (ADR 0026): the renderer's boot decision. Read-only and
  // side-effect-free — it deliberately does NOT route through denService()/env:list (those
  // mint identity / register as a side effect and assume a working clone); the gate must not
  // depend on the thing it gates. Asserts the `_trace` envelope like every other read.
  registrar.handle('den:launch-state', async (_event, payload: TracedPayload) => {
    traceId(payload)
    return deps.launchState()
  })
  registrar.handle('den:register-environment', async (_event, payload: TracedPayload) => {
    return (await deps.denService()).registerEnvironment(traceId(payload))
  })
  registrar.handle('den:track', async (_event, payload: TracedPayload) => {
    const { targetPath } = payload as TracedPayload & { targetPath: string }
    return (await deps.denService()).trackFile(targetPath, traceId(payload))
  })
  // Commit-time secret scan (issue 2-03): the renderer calls scan-commit BEFORE commit so it
  // can show the amber warn step on findings. It MUTATES nothing (a read-only advisory scan)
  // but it IS an Operation (it reads the about-to-be-committed bytes), so its `_trace` is
  // forwarded. Crucially, the scan NEVER blocks the Commit — it returns findings as data.
  registrar.handle('den:scan-commit', async (_event, payload: TracedPayload) => {
    const { targetPaths } = payload as TracedPayload & { targetPaths: readonly string[] }
    return (await deps.denService()).scanCommit(targetPaths, traceId(payload))
  })
  // Allowlist a flagged secret (issue 2-04): persist the "Don't warn me about this File again"
  // dismissal into the SYNCED `.dotden/` allowlist, scoped per File+match. Recording it never
  // blocks the Commit (warn-not-block, ADR 0001); the renderer calls it just before den:commit.
  registrar.handle('den:allowlist-secret', async (_event, payload: TracedPayload) => {
    const { finding } = payload as TracedPayload & { finding: SecretFinding }
    return (await deps.denService()).allowlistSecret(finding, traceId(payload))
  })
  // Commit-message template (issue 2-09): the Settings → Commit tab. get-commit-template reads the
  // synced template + the chezmoi-sourced os/arch/hostname the live preview needs (no shell ever
  // reachable from the renderer). set-commit-template persists the synced default + Commits the
  // `.dotden/` change LOCALLY (ADR 0006) so it travels on the next Sync; it returns the refreshed
  // state so the tab re-renders from the source of truth.
  registrar.handle('den:get-commit-template', async (_event, payload: TracedPayload) => {
    return (await deps.denService()).commitTemplate(traceId(payload))
  })
  registrar.handle('den:set-commit-template', async (_event, payload: TracedPayload) => {
    const { template } = payload as TracedPayload & { template: string }
    return (await deps.denService()).setCommitTemplate(template, traceId(payload))
  })
  // Appearance: synced defaults overlaid by a per-environment local override (issues 2-10 + 2-17,
  // ADR 0024): the Settings → Appearance tab.
  // - get-appearance returns the EFFECTIVE settings (synced overlaid by the local override) — what
  //   App.tsx paints the live theme from.
  // - get-appearance-state returns the full synced-vs-local triple (synced · override · effective)
  //   the tab uses to mark pinned-here vs. inherited and offer "reset to the synced default".
  // - set-appearance persists the SYNCED defaults + Commits the `.dotden/` change LOCALLY (ADR 0006)
  //   so they travel on the next Sync (edits "for everyone").
  // - set-appearance-override pins/clears this environment's LOCAL override in `userData` only — NO
  //   `.dotden/` write, NO Commit, NO Sync: a local override shadows a default without changing it
  //   everywhere (the load-bearing ADR 0024 guarantee). None of these gates an invariant.
  registrar.handle('den:get-appearance', async (_event, payload: TracedPayload) => {
    return (await deps.denService()).appearanceSettings(traceId(payload))
  })
  registrar.handle('den:get-appearance-state', async (_event, payload: TracedPayload) => {
    return (await deps.denService()).appearanceState(traceId(payload))
  })
  registrar.handle('den:set-appearance', async (_event, payload: TracedPayload) => {
    const { settings } = payload as TracedPayload & { settings: AppearanceSettings }
    return (await deps.denService()).setAppearanceSettings(settings, traceId(payload))
  })
  registrar.handle('den:set-appearance-override', async (_event, payload: TracedPayload) => {
    const { override } = payload as TracedPayload & { override: AppearanceOverride }
    return (await deps.denService()).setAppearanceOverride(override, traceId(payload))
  })
  // PM picker + convert (issue 2-05). Detect is read-only feature-detection (env-local, never
  // synced) so its `_trace` is forwarded but it MUTATES nothing. pm-preference reads the env-local
  // "Remember my choice" default. convert WRITES the `.tmpl` reference into source state + Commits
  // it (only the reference enters the Den, never the raw secret).
  registrar.handle('den:detect-password-managers', async (_event, payload: TracedPayload) => {
    return (await deps.denService()).detectPasswordManagers(traceId(payload))
  })
  registrar.handle('den:pm-preference', async (_event, payload: TracedPayload) => {
    traceId(payload) // Read-only env-local preference; assert the IPC contract still carries _trace.
    return (await deps.denService()).pmPreference()
  })
  registrar.handle('den:convert-secret', async (_event, payload: TracedPayload) => {
    const { request } = payload as TracedPayload & { request: ConvertSecretRequest }
    return (await deps.denService()).convertSecret(request, traceId(payload))
  })
  registrar.handle('den:commit', async (_event, payload: TracedPayload) => {
    const { targetPaths } = payload as TracedPayload & { targetPaths: readonly string[] }
    return (await deps.denService()).commitTracked(targetPaths, traceId(payload))
  })
  registrar.handle('den:sync-push', async (_event, payload: TracedPayload) => {
    return (await deps.denService()).syncPush(traceId(payload))
  })
  // The offline push queue (issue 1-16): flush retries a push queued while offline (the
  // manual/reconnect retry; index.ts also calls flushPushQueue on net-online), push-pending
  // is the read-only banner state. flush MUTATES (it pushes) so its `_trace` is forwarded;
  // push-pending is read-only (asserts the `_trace` envelope only).
  registrar.handle('den:flush-push-queue', async (_event, payload: TracedPayload) => {
    return (await deps.denService()).flushPushQueue(traceId(payload))
  })
  registrar.handle('den:push-pending', async (_event, payload: TracedPayload) => {
    traceId(payload)
    return (await deps.denService()).pushPending()
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
  // Auto-apply Sync (issue 2-12): fetch + (when the level permits) auto-apply CLEAN incoming
  // changes, holding Conflicts/edit-guard/deletions for review. A sync+apply Operation, so the
  // _trace is forwarded. The LEVEL gate is AutomationPolicy's and the per-File safety is the
  // ApplyPlanner/ConflictModel owners' — the bridge re-checks nothing (ADR 0008).
  registrar.handle('den:auto-apply', async (_event, payload: TracedPayload) => {
    return (await deps.denService()).autoApplyIncoming(traceId(payload))
  })
  // YOLO hands-off Sync (issue 2-13): auto-Commit local edits BEFORE merge, push, merge
  // (surfacing — never resolving — true Conflicts), then auto-apply clean changes. A
  // sync+commit+apply Operation, _trace forwarded. The pre-merge auto-Commit gate is
  // AutomationPolicy's and every safety verdict stays with its owner — the bridge re-checks
  // nothing (ADR 0008). Conflicts surfaced here are NEVER auto-resolved (ConflictModel owns #1).
  registrar.handle('den:yolo-sync', async (_event, payload: TracedPayload) => {
    return (await deps.denService()).yoloSync(traceId(payload))
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
  // The Account tab's connected-Remote read (issue 2-11, V1-Lean / ADR 0020): the git Remote URL
  // + parsed Provider host/scheme dotden is actually using. Read-only (`git remote get-url`), so it
  // emits no wide event, but it still asserts the `_trace` envelope like every other read. There is
  // NO account/token in this read by construction — the live credential status is the SEPARATE
  // `remote:preflight` (`git ls-remote`) call the tab makes itself.
  registrar.handle('den:connected-remote', async (_event, payload: TracedPayload) => {
    traceId(payload)
    return (await deps.denService()).connectedRemote()
  })
  // The History tab (issue 2-01): the per-File version list (derived purely from `git log`,
  // no separate store) + the read-only preview of one version (`git show <sha> -- <path>`).
  // Both are read-only, so DenService emits no wide event; each still asserts the `_trace`
  // envelope so EVERY IPC call crosses the boundary correlated.
  registrar.handle('den:file-history', async (_event, payload: TracedPayload) => {
    traceId(payload)
    const { targetPath } = payload as TracedPayload & { targetPath: string }
    return (await deps.denService()).fileHistory(targetPath)
  })
  registrar.handle('den:file-version-diff', async (_event, payload: TracedPayload) => {
    traceId(payload)
    const { targetPath, sha } = payload as TracedPayload & { targetPath: string; sha: string }
    return (await deps.denService()).fileVersionDiff(targetPath, sha)
  })
  // Restore-forward (issue 2-02): capture a past version as a NEW Commit (never rewrite
  // history). It MUTATES the Den (records a commit), so its `_trace` id IS forwarded so the
  // restore emits a correlated wide event — unlike the two read-only History calls above.
  registrar.handle('den:restore-version', async (_event, payload: TracedPayload) => {
    const { targetPath, sha } = payload as TracedPayload & { targetPath: string; sha: string }
    return (await deps.denService()).restoreFileVersion(targetPath, sha, traceId(payload))
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
  // Workspaces. Each MUTATES the synced `.dotden/` metadata, so its `_trace` id IS
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

  // The OS Scope verbs (issue 1-15): scope a File / Folder (Group) to specific OSes. Each
  // MUTATES the synced `.dotden/` intent AND re-compiles the native `.chezmoiignore`, so its
  // `_trace` id IS forwarded so the organize Operation emits a correlated wide event. The
  // bridge never re-checks the narrowing invariant — DenStore clamps the request.
  registrar.handle('den:set-file-scope', async (_event, payload: TracedPayload) => {
    const { targetPath, scope } = payload as TracedPayload & {
      targetPath: string
      scope: Scope
    }
    return (await deps.denService()).setFileScope(targetPath, scope, traceId(payload))
  })
  registrar.handle('den:set-group-scope', async (_event, payload: TracedPayload) => {
    const { workspaceId, groupId, scope } = payload as TracedPayload & {
      workspaceId: string
      groupId: string
      scope: Scope
    }
    return (await deps.denService()).setGroupScope(workspaceId, groupId, scope, traceId(payload))
  })

  // The per-environment Workspace subscription (issue 1-13): the returning second-environment
  // pick. subscription-state is read-only (asserts `_trace` only); set-subscriptions + unsubscribe
  // MUTATE the synced registry + regenerate the templated `.chezmoiignore`, so each forwards its
  // `_trace` so the organize Operation emits a correlated wide event. The bridge never re-checks
  // the access invariant — the templated ignore + ApplicabilityResolver own it.
  registrar.handle('den:subscription-state', async (_event, payload: TracedPayload) => {
    traceId(payload)
    return (await deps.denService()).subscriptionState()
  })
  registrar.handle('den:set-subscriptions', async (_event, payload: TracedPayload) => {
    const { workspaceIds } = payload as TracedPayload & { workspaceIds?: readonly string[] }
    return (await deps.denService()).setSubscriptions(workspaceIds, traceId(payload))
  })
  registrar.handle('den:unsubscribe-workspace', async (_event, payload: TracedPayload) => {
    const { workspaceId, disposition } = payload as TracedPayload & {
      workspaceId: string
      disposition: UnsubscribeDisposition
    }
    return (await deps.denService()).unsubscribeWorkspace(
      workspaceId,
      disposition,
      traceId(payload),
    )
  })
  // The remembered "keep vs remove un-subscribed Files" default (issue 1-13). Both are
  // environment-local (`userData`, never synced); index.ts owns the read/write. get is
  // read-only; remember MUTATES local settings — both assert `_trace` for uniform correlation.
  registrar.handle('den:unsubscribe-disposition', async (_event, payload: TracedPayload) => {
    traceId(payload)
    return deps.getUnsubscribeDisposition()
  })
  registrar.handle(
    'den:remember-unsubscribe-disposition',
    async (_event, payload: TracedPayload) => {
      traceId(payload)
      const { disposition } = payload as TracedPayload & { disposition: UnsubscribeDisposition }
      await deps.setUnsubscribeDisposition(disposition)
    },
  )

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
  // The new-or-returning fork (issue 1-13): register a brand-new second environment, or claim
  // an existing registry entry's id. Both write THIS env's subscription (default: all) BEFORE
  // any apply (the registry-entry guard's ordering layer). register-new keeps the freshly-minted
  // id; claim first adopts the chosen entry's id (re-arming the id-bound services via index.ts)
  // so the returning environment keeps its history. Each asserts `_trace` for uniform correlation.
  registrar.handle('env:register-new', async (_event, payload: TracedPayload) => {
    traceId(payload)
    const { workspaceIds } = payload as TracedPayload & { workspaceIds?: readonly string[] }
    const registry = await deps.environmentRegistry()
    await registry.registerWithSubscription(workspaceIds)
    return registry.list()
  })
  registrar.handle('env:claim', async (_event, payload: TracedPayload) => {
    traceId(payload)
    const { envId, workspaceIds } = payload as TracedPayload & {
      envId: string
      workspaceIds?: readonly string[]
    }
    // Adopt the claimed id locally + re-arm the id-bound services (index.ts owns this) so the
    // registry below is rebuilt against the claimed id — then register its subscription.
    await deps.claimEnvironment(envId)
    const registry = await deps.environmentRegistry()
    await registry.registerWithSubscription(workspaceIds)
    return registry.list()
  })
  // The Environments-tab lifecycle (issue 2-15): reassign/merge a mistaken duplicate, and
  // retire a decommissioned machine. Unlike claim, neither changes THIS environment's local
  // id, so there is NO re-arming — they are pure synced-registry mutations that Commit `.dotden/`
  // (so the change travels) and return the refreshed list. The registry owns the self-protection
  // guards (cannot retire/fold-away self) + the never-auto-merge rule; the bridge never re-checks.
  registrar.handle('env:reassign', async (_event, payload: TracedPayload) => {
    traceId(payload)
    const { fromId, intoId } = payload as TracedPayload & { fromId: string; intoId: string }
    return (await deps.environmentRegistry()).reassign(fromId, intoId)
  })
  registrar.handle('env:retire', async (_event, payload: TracedPayload) => {
    traceId(payload)
    const { envId } = payload as TracedPayload & { envId: string }
    return (await deps.environmentRegistry()).retire(envId)
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

  // ── Sync settings channels (issue 2-08): the environment-local Sync tab ──
  // get-settings is read-only; set-settings MUTATES local settings AND re-arms the side effects
  // (TrayPoller on-off/cadence + OS autostart), so index.ts owns the re-arming behind
  // `setSyncSettings`. Both still assert the `_trace` envelope so EVERY IPC call is uniformly
  // correlated, even though the settings read/write does not take a trace id today.
  registrar.handle('sync:get-settings', async (_event, payload: TracedPayload) => {
    traceId(payload)
    return deps.getSyncSettings()
  })
  registrar.handle('sync:set-settings', async (_event, payload: TracedPayload) => {
    traceId(payload)
    const { settings } = payload as TracedPayload & { settings: SyncSettings }
    // index.ts's setSyncSettings persists locally then re-arms the poller + applies autostart,
    // and returns the persisted settings so the tab re-renders from the source of truth.
    return deps.setSyncSettings(settings)
  })

  // ── Privacy / telemetry consent channels (issue 2-14): the environment-local Privacy tab ──
  // get-settings is read-only; set-settings persists the consent flag LOCALLY and has NO side
  // effects — CONTROL SURFACE ONLY (no egress, no SDK, no network call). The consumers that act
  // on consent are PRD 3 (issues 3-09/3-10). Both assert the `_trace` envelope so EVERY IPC call
  // is uniformly correlated, even though the consent read/write does not take a trace id today.
  registrar.handle('privacy:get-settings', async (_event, payload: TracedPayload) => {
    traceId(payload)
    return deps.getPrivacySettings()
  })
  registrar.handle('privacy:set-settings', async (_event, payload: TracedPayload) => {
    traceId(payload)
    const { settings } = payload as TracedPayload & { settings: PrivacySettings }
    // index.ts's setPrivacySettings persists locally and returns the persisted consent so the
    // tab re-renders from the source of truth. No egress happens here — flipping a toggle stores
    // a boolean and nothing more (issue 2-14 is control-surface-only).
    return deps.setPrivacySettings(settings)
  })

  // ── App info + update-check channels (issue 2-16): the Settings → About tab ──
  // get-info reads the running build's version + platform; check-updates runs the update-check
  // affordance, returning an honest result (`unavailable` until the real feed lands in issue
  // 3-20 — never a fake "you're current"). Both are read-only (no Operation/mutation) but still
  // assert the `_trace` envelope so EVERY IPC call crosses the boundary uniformly correlated.
  // NO packaging/auto-update mechanics are wired here — only the version read + the check.
  registrar.handle('app:get-info', async (_event, payload: TracedPayload) => {
    traceId(payload)
    return deps.getAppInfo()
  })
  registrar.handle('app:check-updates', async (_event, payload: TracedPayload) => {
    traceId(payload)
    return deps.checkForUpdates()
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
