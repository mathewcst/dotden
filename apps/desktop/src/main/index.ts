/**
 * Electron main-process entry point for the dotden desktop app.
 *
 * Owns the single hardened BrowserWindow, the (intentionally inert) auto-updater
 * wiring, and cross-platform app lifecycle (re-create the window on macOS
 * "activate", quit when all windows close everywhere except macOS).
 */
import {
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
  Notification,
  powerMonitor,
  shell,
  Tray,
} from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'node:path'
import type { AppInfo, UpdateCheckResult } from '../shared/app-info.js'
import type { AutomationLevel } from '../shared/apply.js'
import type { RedactedCommandRecord } from '../shared/diagnostics.js'
import {
  readAutomationLevel,
  writeAutomationLevel,
} from './foundation/apply/automation-settings.js'
import { PersistentCommandLog } from './diagnostics/command-log-store.js'
import { DenService } from './foundation/den-service/den-service.js'
import { DiscoveryScanner } from './foundation/environments/discovery-scanner.js'
import {
  claimLocalIdentity,
  loadEnvironmentIdentity,
} from './foundation/environments/environment-identity.js'
import { EnvironmentRegistry } from './foundation/environments/environment-registry.js'
import { computeLaunchState } from './foundation/environments/launch-state.js'
import type { LaunchState } from '../shared/environments.js'
import { OperationTracer } from './foundation/platform/operation-tracer.js'
import type { PrivacySettings } from '../shared/settings.js'
import {
  readPrivacySettings,
  writePrivacySettings,
} from './foundation/settings/privacy-settings.js'
import { RemoteClient } from './foundation/sync/remote-client.js'
import type { UnsubscribeDisposition } from '../shared/settings.js'
import {
  readUnsubscribeDisposition,
  writeUnsubscribeDisposition,
} from './foundation/settings/subscription-settings.js'
import type { PollCadenceProfile, SyncSettings } from '../shared/settings.js'
import { readSyncSettings, writeSyncSettings } from './foundation/settings/sync-settings.js'
import { resolveBundledTools } from './foundation/platform/tools.js'
import {
  DEFAULT_POLL_CADENCE,
  TrayPoller,
  type PollCadence,
} from './foundation/system/tray-poller.js'
import { noFeed, checkForUpdates as runUpdateCheck } from './foundation/system/update-check.js'
import { registerIpcBridge } from './ipc/ipc-bridge.js'

/**
 * Process-wide observability core (ADR 0007): one wide event per Operation lands in
 * its bounded local ring buffer. It is the only always-on sink and never egresses;
 * the IpcBridge threads each call's `_trace` id into it via the DenService.
 */
const tracer = new OperationTracer()

/** Process-wide redacted Command log, persisted under Electron `userData` (ADR 0030). */
let diagnosticsLog: Promise<PersistentCommandLog> | undefined

/** Load the shared restart-safe Command log for this app run. */
async function getDiagnosticsLog(): Promise<PersistentCommandLog> {
  diagnosticsLog ??= PersistentCommandLog.load(app.getPath('userData'), {
    redaction: {
      homeDir: app.getPath('home'),
    },
  }).catch((error: unknown) => {
    diagnosticsLog = undefined
    throw error
  })
  return diagnosticsLog
}

/**
 * Lazily-built, process-wide {@link RemoteClient}.
 *
 * Building it requires resolving the bundled chezmoi/git binaries, so it is
 * created on first IPC use and reused thereafter (one client per app run).
 *
 * Retry-on-failure: only a *resolved* promise is memoized. If construction
 * rejects (e.g. missing bundled binaries), the catch in {@link getRemoteClient}
 * clears the memo so the next IPC call retries from scratch — without this, a
 * single early failure would brick all Remote IPC until the app restarts.
 */
let remoteClient: Promise<RemoteClient> | undefined

/**
 * Get the shared {@link RemoteClient}, building it lazily on first use.
 *
 * Lazy-singleton on success (the promise is cached and reused); retry on
 * failure (a rejection clears the cache before rethrowing, so the next call
 * gets a fresh attempt rather than a permanently-rejected memo).
 */
async function getRemoteClient(): Promise<RemoteClient> {
  remoteClient ??= buildRemoteClient().catch((error: unknown) => {
    // Drop the rejected promise so the next IPC call retries instead of
    // resolving this same failure forever.
    remoteClient = undefined
    throw error
  })
  return remoteClient
}

/**
 * The chezmoi source-state dir for this environment's Den.
 *
 * Both the {@link RemoteClient} (which `chezmoi init`s into it) and the
 * {@link DenService} (which Tracks/Commits/Applies against it) share this single
 * dir, so the Den a user connects is the very Den every Den operation acts on.
 */
function sourceDir(): string {
  return join(app.getPath('userData'), 'chezmoi-source')
}

/**
 * The **environment-local** chezmoi config file for this Den (issue 1-05, ADR 0024).
 *
 * Lives under Electron `userData` (never synced) and carries `[data].dotden_env_id`
 * so a per-environment `.chezmoiignore` template can self-identify and look up its
 * subscribed Workspaces. Shared by the {@link DenService} (Apply honors it) and the
 * {@link EnvironmentRegistry} (which writes the own id into it at setup).
 */
function chezmoiConfigPath(): string {
  return join(app.getPath('userData'), 'chezmoi', 'chezmoi.toml')
}

/** Resolve bundled tools and construct a {@link RemoteClient} for this environment. */
async function buildRemoteClient(): Promise<RemoteClient> {
  const tools = await resolveBundledTools()
  const diagnosticsSink = await getDiagnosticsLog()
  return new RemoteClient({
    chezmoiBin: tools.chezmoi,
    gitBin: tools.git,
    sourceDir: sourceDir(),
    destinationDir: app.getPath('home'),
    diagnosticsSink,
  })
}

/**
 * Lazily-built, process-wide {@link DenService} for the MVP sync loop (issue 1-04).
 *
 * Mirrors {@link getRemoteClient}'s lazy-singleton-with-retry: only a *resolved*
 * promise is memoized, so a construction failure (missing binaries, identity I/O)
 * does not brick all Den IPC for the app's lifetime.
 */
let denService: Promise<DenService> | undefined

/** Get the shared {@link DenService}, building it lazily on first use. */
async function getDenService(): Promise<DenService> {
  denService ??= buildDenService().catch((error: unknown) => {
    denService = undefined
    throw error
  })
  return denService
}

/** Resolve tools + this environment's stable identity, then build the DenService. */
async function buildDenService(): Promise<DenService> {
  const tools = await resolveBundledTools()
  const identity = await loadEnvironmentIdentity(app.getPath('userData'))
  const diagnosticsSink = await getDiagnosticsLog()
  // The DenService's AutomationPolicy is fixed at construction, so it is built with THIS
  // environment's current rung (issue 1-12). Changing the level rebuilds the service (see
  // setAutomationLevel) so a later Commit uses the new auto-push decision.
  const automationLevel = await readAutomationLevel(app.getPath('userData'))
  return new DenService({
    chezmoiBin: tools.chezmoi,
    gitBin: tools.git,
    sourceDir: sourceDir(),
    destinationDir: app.getPath('home'),
    configPath: chezmoiConfigPath(),
    environment: { id: identity.id, label: identity.label, os: identity.os },
    tracer,
    automationLevel,
    diagnosticsSink,
    // Environment-local "Remember my choice" PM preference (issue 2-05) lives under userData,
    // never synced (ADR 0024) — same store dir as the automation level + identity.
    userDataDir: app.getPath('userData'),
  })
}

/**
 * Lazily-built, process-wide {@link EnvironmentRegistry} (issue 1-05).
 *
 * Owns environment identity/labels and derives attribution from git log. Mirrors the
 * other singletons' lazy-with-retry pattern so a transient build failure does not
 * brick all `env:*` IPC for the app's lifetime.
 */
let environmentRegistry: Promise<EnvironmentRegistry> | undefined

/** Get the shared {@link EnvironmentRegistry}, building it lazily on first use. */
async function getEnvironmentRegistry(): Promise<EnvironmentRegistry> {
  environmentRegistry ??= buildEnvironmentRegistry().catch((error: unknown) => {
    environmentRegistry = undefined
    throw error
  })
  return environmentRegistry
}

/**
 * Process-wide {@link DiscoveryScanner} for the first-run scan (issue 1-06).
 *
 * Bound to this environment's real home dir — the same `destinationDir` the
 * RemoteClient/DenService apply into — so the scan offers config Files that live
 * where Apply writes them. It resolves no bundled binaries (read-only filesystem
 * scan, ADR 0023), so it is constructed directly rather than lazily-with-retry.
 */
function getDiscoveryScanner(): Promise<DiscoveryScanner> {
  return Promise.resolve(new DiscoveryScanner({ homeDir: app.getPath('home') }))
}

/** Resolve tools + this environment's identity, then build the EnvironmentRegistry. */
async function buildEnvironmentRegistry(): Promise<EnvironmentRegistry> {
  const tools = await resolveBundledTools()
  const identity = await loadEnvironmentIdentity(app.getPath('userData'))
  return new EnvironmentRegistry({
    sourceDir: sourceDir(),
    gitBin: tools.git,
    chezmoiBin: tools.chezmoi,
    destinationDir: app.getPath('home'),
    configPath: chezmoiConfigPath(),
    identity,
  })
}

/**
 * Compute the launch-routing gate (ADR 0026) the renderer reads on boot to choose its first
 * screen. Side-effect-free by construction: {@link computeLaunchState} reads this environment's
 * local id WITHOUT minting one, probes the clone, and reads the synced registry directly — it
 * never builds the lazy {@link DenService} or calls `env:list` (both register/mint and assume a
 * working clone), so the gate works in the pre-clone `fresh` state without bricking. The gate
 * must not depend on, or mutate, the very thing it is gating.
 */
function denLaunchState(): Promise<LaunchState> {
  return computeLaunchState({ sourceDir: sourceDir(), userDataDir: app.getPath('userData') })
}

// ── Automation level + the always-on TrayPoller (issue 1-12) ──

/** The app's single window, retained so the TrayPoller can push to it + read its focus. */
let mainWindow: BrowserWindow | null = null

/** The always-on Remote watcher (detect + notify only); null until armed at startup. */
let trayPoller: TrayPoller | null = null

/** The system-tray icon that keeps the poller alive when the window is closed. */
let tray: Tray | null = null

/** Whether wake/unlock reconnect hooks have been registered on Electron's global powerMonitor. */
let powerMonitorReconnectHandlersRegistered = false

/**
 * Read this environment's automation level (Manual default), forwarded to the
 * `automation:get-level` IPC channel. Environment-local (ADR 0024).
 */
function getAutomationLevel(): Promise<AutomationLevel> {
  return readAutomationLevel(app.getPath('userData'))
}

/**
 * Persist a new automation level AND re-arm the automation-dependent services:
 * - the {@link DenService}'s {@link AutomationPolicy} is fixed at construction, so we drop
 *   the memo and let it rebuild with the new level on next use (so the next Commit uses
 *   the new auto-push decision);
 * - the {@link TrayPoller} is independent of Auto-sync, so it keeps running unchanged.
 *
 * The store rejects a non-selectable level (any unknown future rung), so an unbuilt level
 * never reaches disk.
 */
async function setAutomationLevel(level: AutomationLevel): Promise<void> {
  await writeAutomationLevel(app.getPath('userData'), level)
  // Force the DenService to rebuild with the new level on its next lazy resolve.
  denService = undefined
}

/**
 * **Claim a returning registry entry's id** as THIS install's local identity (issue 1-13,
 * ADR 0024) and re-arm the id-bound services.
 *
 * Adopting the claimed id is what lets a reinstalled environment keep its history/attribution
 * (continuous). The id is environment-LOCAL (`userData`), so this writes it via
 * {@link claimLocalIdentity}, then drops the DenService + EnvironmentRegistry memos so both
 * rebuild against the claimed id on next use (mirroring {@link setAutomationLevel}'s re-arm).
 * The IPC bridge then registers the claimed env's subscription through the rebuilt registry.
 */
async function claimEnvironment(envId: string): Promise<void> {
  await claimLocalIdentity(app.getPath('userData'), envId)
  // The id changed, so every id-bound singleton must rebuild against it on next resolve.
  denService = undefined
  environmentRegistry = undefined
}

/**
 * Read this environment's remembered un-subscribe disposition default (issue 1-13).
 * Environment-local (`userData`, never synced — ADR 0024); defaults to the safe `keep`.
 */
function getUnsubscribeDisposition(): Promise<UnsubscribeDisposition> {
  return readUnsubscribeDisposition(app.getPath('userData'))
}

/** Persist this environment's remembered un-subscribe disposition default (issue 1-13). */
function setUnsubscribeDisposition(disposition: UnsubscribeDisposition): Promise<void> {
  return writeUnsubscribeDisposition(app.getPath('userData'), disposition)
}

// ── Sync settings: poller on/off · cadence · start-on-login (issue 2-08, ADR 0024) ──

/**
 * The relaxed poll cadence the Sync tab's `relaxed` profile maps onto — a slower, battery-
 * friendlier ceiling than {@link DEFAULT_POLL_CADENCE} (the `fast` profile). The minutes here
 * are the local-only realization of the named profile the user picks; the profile string is
 * what we persist, so these numbers can evolve without rewriting users' settings files.
 */
const RELAXED_POLL_CADENCE: PollCadence = {
  minIntervalMs: 120_000, // 2 min focused floor (vs 30s fast)
  maxIntervalMs: 900_000, // 15 min idle ceiling (vs 5 min fast)
  backoffFactor: 2,
}

/** Map a Sync-tab cadence profile onto the concrete {@link PollCadence} the TrayPoller consumes. */
function cadenceForProfile(profile: PollCadenceProfile): PollCadence {
  return profile === 'relaxed' ? RELAXED_POLL_CADENCE : DEFAULT_POLL_CADENCE
}

/** Read this environment's Sync settings (poller on/off · cadence · autostart), ADR 0024. */
function getSyncSettings(): Promise<SyncSettings> {
  return readSyncSettings(app.getPath('userData'))
}

/**
 * Persist this environment's Sync settings AND apply the side effects (issue 2-08):
 * - **start-on-login** is realized via Electron's `app.setLoginItemSettings` so the tray (and
 *   therefore the watcher) is present at login without the user opening the app;
 * - the **TrayPoller** is re-armed: dismissed when the user turns polling off, (re)started at
 *   the chosen cadence when on. The poller is independent of Auto-sync (even Manual polls), so
 *   this is the ONLY user control over whether the background watcher runs at all.
 *
 * Returns the persisted settings so the renderer re-renders from the source of truth.
 */
async function setSyncSettings(settings: SyncSettings): Promise<SyncSettings> {
  await writeSyncSettings(app.getPath('userData'), settings)
  applyLoginItemSetting(settings.startOnLogin)
  await restartTrayPoller()
  return settings
}

// ── Privacy / telemetry consent: analytics · crash reports (issue 2-14, ADR 0024) ──

/** Read this environment's telemetry consent (analytics · crash reports; both default off). */
function getPrivacySettings(): Promise<PrivacySettings> {
  return readPrivacySettings(app.getPath('userData'))
}

/**
 * Persist this environment's telemetry consent (issue 2-14). CONTROL SURFACE ONLY: unlike
 * {@link setSyncSettings} this has NO side effects — it only writes the consent flag to
 * `userData` (never the synced `.dotden/`, ADR 0024). No telemetry SDK is loaded and no network
 * connection is opened here; the consumers gated behind this consent are PRD 3 (issues
 * 3-09/3-10), which read it. Returns the persisted consent so the Privacy tab re-renders from
 * the source of truth.
 */
async function setPrivacySettings(settings: PrivacySettings): Promise<PrivacySettings> {
  await writePrivacySettings(app.getPath('userData'), settings)
  return settings
}

// ── App info + update check: the Settings → About tab (issue 2-16, stories 52–53) ──

/**
 * Read the running app's info for the About tab. `app.getVersion()` is the canonical version —
 * the packaged build version in production, the `package.json` version in dev — so the tab always
 * shows what the user is actually on. `process.platform` is surfaced purely as a diagnostic hint.
 */
function getAppInfo(): Promise<AppInfo> {
  return Promise.resolve({ version: app.getVersion(), platform: process.platform })
}

/**
 * Run a frameless-titlebar action against the BrowserWindow that originated the IPC call.
 *
 * The renderer never receives an Electron object; it only asks for a narrow verb through preload,
 * and the main process resolves the sender window at the boundary.
 */
async function controlWindow(
  event: unknown,
  action: 'minimize' | 'toggle-maximize' | 'close',
): Promise<boolean | void> {
  const sender = (event as { sender?: Electron.WebContents }).sender
  const window = sender ? BrowserWindow.fromWebContents(sender) : null

  if (!window) throw new Error('Window control IPC had no sender window')

  if (action === 'minimize') {
    window.minimize()
    return
  }

  if (action === 'close') {
    window.close()
    return
  }

  if (window.isMaximized()) window.unmaximize()
  else window.maximize()

  return window.isMaximized()
}

/**
 * Run the About tab's update check (issue 2-16). Today it uses the {@link noFeed} placeholder, so
 * it honestly resolves to `'unavailable'` with a reason — mirroring the inert
 * `autoUpdater.checkForUpdatesAndNotify()` below (no published feed exists in the scaffold). Issue
 * 3-20 swaps `noFeed` for a real electron-updater-backed feed; the IPC + UI contract is unchanged,
 * so that is a one-line wiring change here, not a rewrite. NO download/install path is wired in
 * this slice — only the honest "are there updates?" answer (never a fake "you're current").
 */
function checkForUpdates(): Promise<UpdateCheckResult> {
  return runUpdateCheck(app.getVersion(), noFeed)
}

/** Reveal the persisted, redacted Command log in the OS file manager (PRD4 issue 4-03). */
async function openDiagnosticsLogLocation(): Promise<void> {
  const log = await getDiagnosticsLog()
  shell.showItemInFolder(log.filePath)
}

/** Read already-redacted records for the renderer Diagnostics panel. */
async function diagnosticsRecordsFor(traceId?: string): Promise<readonly RedactedCommandRecord[]> {
  const log = await getDiagnosticsLog()
  const records = traceId ? log.recordsFor(traceId) : log.records()
  return records.map((record) => ({
    command: record.command,
    args: record.args,
    exitCode: record.exitCode,
    redactedStdout: record.stdout,
    redactedStderr: record.stderr,
    ...(record.traceId ? { traceId: record.traceId } : {}),
    timestamp: record.timestamp,
  }))
}

/**
 * Apply the OS "open dotden at login" preference (issue 2-08). Electron's
 * `setLoginItemSettings` registers/unregisters the login item on macOS + Windows; it is a
 * best-effort, no-throw call (an unsupported/locked-down platform simply ignores it), so a
 * failure to register autostart never blocks saving the rest of the Sync settings.
 */
function applyLoginItemSetting(openAtLogin: boolean): void {
  try {
    app.setLoginItemSettings({ openAtLogin })
  } catch (error) {
    // Never fail silently, but never block the settings save over an OS autostart hiccup.
    console.error('[dotden] Failed to apply start-on-login setting:', error)
  }
}

/**
 * Tear down the current {@link TrayPoller} and re-arm it from the current Sync settings (issue
 * 2-08) — the re-arm path the Sync tab triggers when the user flips poller on/off or changes
 * cadence. {@link armTrayPoller} reads the settings itself, so this just stops any running
 * poller first; if polling is now off, `armTrayPoller` returns without starting a new one.
 */
async function restartTrayPoller(): Promise<void> {
  trayPoller?.stop()
  trayPoller = null
  // When polling is turned OFF, also drop the tray presence: the tray exists only to keep the
  // background watcher alive with the window closed, so a disabled poller should not pin the
  // process tray-side. `armTrayPoller` recreates the tray when polling is (re)enabled.
  const settings = await getSyncSettings()
  if (!settings.pollerEnabled && tray) {
    tray.destroy()
    tray = null
  }
  await armTrayPoller()
}

/**
 * Fire the detect-only side effects when the TrayPoller sees the Remote move (issue 1-12):
 * an OS {@link Notification} (so the user learns even with the window closed) AND a
 * `tray-poller:incoming` push to an open window (so it can refresh its Incoming banner).
 *
 * Detect-only: this NEVER applies anything (ADR 0006/0008). It surfaces awareness; the
 * user's reviewed Apply still lands the change. Notifications are best-effort — a platform
 * without notification support simply skips the toast and still pushes to the window.
 */
function notifyIncoming(): void {
  // OS notification (functional chrome only; native macOS polish is issue 3-06/3-07).
  if (Notification.isSupported()) {
    new Notification({
      title: 'dotden — incoming changes',
      body: 'Another environment changed your Den. Open dotden to review and Apply.',
    }).show()
  }
  // Nudge an open window to re-check the Remote so its in-app banner stays in step.
  mainWindow?.webContents.send('tray-poller:incoming')
}

/**
 * Arm the always-on {@link TrayPoller} (issue 1-12): a system-tray presence keeps the app
 * (and therefore the watcher) alive when the window is closed, and the poller checks the
 * Remote on the cheap `git ls-remote` SHA-compare cadence.
 *
 * It is **independent of Auto-sync** — even a Manual environment polls, because notify-on-
 * incoming is awareness, not automation. `powerMonitor`'s wake/unlock events force an
 * immediate fresh tick (a timer set before sleep may be stale). Best-effort: a failure to
 * resolve the Remote URL just leaves the poller dormant rather than crashing startup.
 */
async function armTrayPoller(): Promise<void> {
  try {
    // The Sync tab can turn the background watcher OFF on this environment (issue 2-08). When
    // it is disabled we stay dormant entirely — no tray, no poll loop — until the user re-enables
    // it. The cadence profile the user picked selects the poll interval bounds below.
    const syncSettings = await getSyncSettings()
    if (!syncSettings.pollerEnabled) return

    const den = await getDenService()
    const snapshot = await den.pollSnapshot()
    // No Remote configured yet (a Den never connected) ⇒ nothing to watch; stay dormant.
    if (!snapshot.remoteUrl) return
    const remoteUrl = snapshot.remoteUrl

    // A minimal tray presence so closing the window does not quit the app on Win/Linux —
    // that is what lets the watcher keep running with the window closed. The native menu +
    // live-state icon is issue 3-06; here the tray is functional chrome only.
    if (!tray) {
      // An empty NativeImage is a valid (blank) tray icon — functional chrome only; the
      // real branded/state-driven tray art + native menu is issue 3-06.
      tray = new Tray(nativeImage.createEmpty())
      tray.setToolTip('dotden — watching for incoming changes')
    }

    const client = await getRemoteClient()
    trayPoller = new TrayPoller({
      // Cheap detection: the advertised latest SHA via `git ls-remote` (issue 1-03) — a
      // provider-agnostic git primitive, no Provider API, no clone, no rate-limit cost.
      readLatestSha: (signal) =>
        client.latestRemoteSha(remoteUrl, 'main', { _trace: pollTrace(), signal }),
      notifier: { notifyIncoming },
      // The cadence the user picked in the Sync tab (issue 2-08): `fast` (default) or `relaxed`.
      cadence: cadenceForProfile(syncSettings.cadence),
      // Real one-shot timers; the poller owns clearing/re-arming.
      scheduler: {
        schedule: (fn, delayMs) => setTimeout(fn, delayMs),
        clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
      },
      // Seed with this environment's HEAD so the first Remote SHA == HEAD is "nothing new".
      knownSha: snapshot.headSha,
      // Surface a poll error without crashing the watcher (never fail silently).
      onError: (error) => console.error('[dotden] TrayPoller read failed:', error),
    })
    trayPoller.start()

    // powerMonitor reconnect: on wake/unlock, re-check the Remote right away (issue 1-12)
    // AND flush any push queued while offline (issue 1-16) — a machine that slept while
    // offline likely reconnects on wake, so this is a natural "back online" retry trigger.
    // These are global Electron listeners, so register them once: the Sync tab can re-arm the
    // poller many times, and duplicate listeners would multiply reconnect flushes/ticks.
    if (!powerMonitorReconnectHandlersRegistered) {
      powerMonitor.on('resume', onReconnect)
      powerMonitor.on('unlock-screen', onReconnect)
      powerMonitorReconnectHandlersRegistered = true
    }
  } catch (error) {
    // A failure to arm the watcher must never block app startup; the user can still work
    // and Sync manually. Surface it rather than swallow it (never fail silently).
    console.error('[dotden] Failed to arm the TrayPoller:', error)
  }
}

/** Mint a correlation id for a poll Operation (mirrors the preload's per-action `_trace`). */
function pollTrace(): { traceId: string } {
  return { traceId: `poll-${Date.now()}-${Math.random().toString(36).slice(2)}` }
}

/**
 * The **reconnect** handler (issue 1-12 + 1-16): re-check the Remote for incoming changes
 * (the TrayPoller) AND flush any push that was queued while offline (the PushQueue), so a
 * machine coming back online both learns about incoming changes and propagates the work it
 * recorded offline — without the user pressing Sync now.
 *
 * Fired on `powerMonitor` wake/unlock here, and on the renderer's `online` event via the
 * `net:flush-queue` IPC channel (the renderer owns `navigator.onLine`, the canonical
 * browser-side connectivity signal). Best-effort + never throws: a flush that is still
 * offline simply re-queues, and any error is surfaced to the log, never crashing the app.
 */
function onReconnect(): void {
  trayPoller?.onReconnect()
  void flushQueuedPushes()
}

/**
 * Retry any push queued while offline (issue 1-16), then nudge an open window to refresh its
 * offline banner so the in-app state matches reality. Best-effort: an isOffline flush leaves
 * the push queued for the next reconnect (DenService handles that), and any error is logged
 * (never fail silently) rather than thrown into the event loop.
 */
async function flushQueuedPushes(): Promise<void> {
  try {
    const den = await getDenService()
    await den.flushPushQueue(pollTrace().traceId)
  } catch (error) {
    console.error('[dotden] Failed to flush queued pushes on reconnect:', error)
  } finally {
    // Let an open window re-read pushPending() so its offline banner clears/persists in step.
    mainWindow?.webContents.send('net:reconnected')
  }
}

/**
 * Creates the app's single BrowserWindow and loads the renderer into it.
 *
 * The window is hardened against the renderer: `contextIsolation` + no
 * `nodeIntegration` + `sandbox` keep untrusted renderer code off Node, so the
 * only main<->renderer bridge is the preload script's exposed API surface.
 *
 * Renderer source is chosen by build context: in dev (`!app.isPackaged`) it
 * loads the Vite dev-server URL for HMR; in a packaged build it loads the
 * bundled `index.html` from disk.
 *
 * The window stays hidden (`show: false`) until the renderer paints its first
 * frame (`ready-to-show`) to avoid flashing unpainted chrome, and its web
 * contents are pinned to the local app — outbound navigation and new windows are
 * denied as defense-in-depth atop the sandbox + CSP.
 */
function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 840,
    minHeight: 560,
    title: 'dotden',
    backgroundColor: '#050505',
    roundedCorners: true,
    darkTheme: true,
    // Stay hidden until `ready-to-show` fires so the user never sees an unpainted
    // frame on a cold/slow start; `backgroundColor` covers the gap until then.
    show: false,
    frame: false,
    webPreferences: {
      // Preload is the ONLY trusted bridge: it runs with the privileges below
      // and selectively exposes IPC to the otherwise-sandboxed renderer.
      preload: join(__dirname, '../preload/index.js'),
      // Renderer hardening — keep the web content unable to touch Node directly.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  // Retain the window so the TrayPoller can push `tray-poller:incoming` to it and so the
  // poller's cadence can track its focus (issue 1-12).
  mainWindow = window

  // Focus speeds the poll cadence up to the floor; blur lets the idle backoff resume — the
  // "speeds up when the window is focused" half of the adaptive cadence (issue 1-12).
  window.on('focus', () => trayPoller?.setWindowFocused(true))
  window.on('blur', () => trayPoller?.setWindowFocused(false))
  // Clear the reference when this window goes away (the poller keeps running tray-side).
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  // Reveal only once the renderer has painted, so a cold start never shows an empty
  // frame (P3 anti-flash). Registered before load so we never miss the event.
  window.once('ready-to-show', () => window.show())

  // Navigation hardening (Electron security checklist, defense-in-depth atop
  // `sandbox` + `contextIsolation` + CSP): the renderer is a fixed local app that
  // should never navigate away or spawn its own Electron windows. Deny both, and
  // hand any real outbound link (e.g. a docs/account URL) to the OS browser instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })

  // Dev vs. packaged: prefer the live Vite dev server (HMR) when running
  // unpackaged with ELECTRON_RENDERER_URL set; otherwise load the built file.
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Single-instance guard (P1): dotden is a sync app — a second launch must focus the
// window we already have, never spawn a rival process. Two instances would run two
// TrayPollers and race git/chezmoi writes against the same Den + userData. If we lose
// the race for the lock, another instance owns the app; hand off and exit immediately.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // A second launch fired instead of starting fresh: surface the existing window
  // (restoring it if minimized), or re-create one if it was closed to the tray.
  app.on('second-instance', () => {
    if (!mainWindow) {
      createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  // App bootstrap: spin up the window once Electron is ready, then arm the
  // updater and the macOS re-activation handler.
  app.whenReady().then(() => {
    // Windows toast/taskbar identity (P2): notifications and the tray only attribute
    // to dotden's name + icon when the AppUserModelId matches the installed appId
    // (see electron-builder.yml). No-op on macOS/Linux. Set before any Notification.
    app.setAppUserModelId('app.dotden.desktop')

    // The IpcBridge owns the renderer↔main surface: it forwards each call's `_trace`
    // id into the foundation. AbortSignal-based cancellation is not yet wired across
    // IPC (a signal cannot cross Electron's structured-clone boundary), so v1 relies
    // on the foundation's per-call timeouts as the guarantee against a hung call.
    registerIpcBridge(ipcMain, {
      remoteClient: getRemoteClient,
      denService: getDenService,
      launchState: denLaunchState,
      discoveryScanner: getDiscoveryScanner,
      environmentRegistry: getEnvironmentRegistry,
      getAutomationLevel,
      setAutomationLevel,
      claimEnvironment,
      getUnsubscribeDisposition,
      setUnsubscribeDisposition,
      getSyncSettings,
      setSyncSettings,
      getPrivacySettings,
      setPrivacySettings,
      getAppInfo,
      checkForUpdates,
      controlWindow,
      openDiagnosticsLogLocation,
      diagnosticsRecordsFor,
    })
    createWindow()

    // Reconcile the OS login-item with this environment's saved start-on-login preference (issue
    // 2-08) on each launch, so a setting changed while the app was closed (or out of sync with the
    // OS) is re-applied. Best-effort; the helper never throws.
    void getSyncSettings().then((settings) => applyLoginItemSetting(settings.startOnLogin))

    // Arm the always-on TrayPoller (issue 1-12): it watches the Remote on the cheap
    // ls-remote SHA cadence and notifies on incoming, independent of Auto-sync and even
    // with the window closed. Best-effort — it never blocks startup.
    void armTrayPoller()

    // Scaffold has no published update feed, so this resolves/rejects with nothing
    // actionable. The call is kept so real auto-update wiring is a config change,
    // not a code change; the rejection is swallowed to avoid an unhandled promise.
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // No published feed exists in the scaffold. Update wiring is intentionally inert.
    })

    // macOS convention: clicking the dock icon with no open windows should
    // re-open one rather than do nothing.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

// Lifecycle with the always-on watcher (issue 1-12): closing the last window must NOT quit
// while the TrayPoller is armed — that is the whole point of "keeps watching the Remote
// from the tray even when the window is closed". macOS stays resident anyway (dock); on
// Win/Linux a live tray keeps the process (and the poller) running, exactly like other
// tray apps. Without a tray (e.g. no Remote yet → poller dormant) the classic quit applies.
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  if (tray) return // a tray presence keeps the background watcher alive
  app.quit()
})
