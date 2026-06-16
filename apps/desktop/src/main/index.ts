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
  Tray,
} from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'node:path'
import { DenService } from './foundation/den-service.js'
import { DiscoveryScanner } from './foundation/discovery-scanner.js'
import { loadEnvironmentIdentity } from './foundation/environment-identity.js'
import { EnvironmentRegistry } from './foundation/environment-registry.js'
import { OperationTracer } from './foundation/operation-tracer.js'
import { RemoteClient } from './foundation/remote-client.js'
import { resolveBundledTools } from './foundation/tools.js'
import { registerIpcBridge } from './ipc/ipc-bridge.js'
import { readAutomationLevel, writeAutomationLevel } from './foundation/automation-settings.js'
import type { AutomationLevel } from './foundation/automation-policy.js'
import { TrayPoller } from './foundation/tray-poller.js'

/**
 * Process-wide observability core (ADR 0007): one wide event per Operation lands in
 * its bounded local ring buffer. It is the only always-on sink and never egresses;
 * the IpcBridge threads each call's `_trace` id into it via the DenService.
 */
const tracer = new OperationTracer()

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
  return new RemoteClient({
    chezmoiBin: tools.chezmoi,
    gitBin: tools.git,
    sourceDir: sourceDir(),
    destinationDir: app.getPath('home'),
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

// ── Automation level + the always-on TrayPoller (issue 1-12) ──

/** The app's single window, retained so the TrayPoller can push to it + read its focus. */
let mainWindow: BrowserWindow | null = null

/** The always-on Remote watcher (detect + notify only); null until armed at startup. */
let trayPoller: TrayPoller | null = null

/** The system-tray icon that keeps the poller alive when the window is closed. */
let tray: Tray | null = null

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
 * The store rejects a non-MVP level, so an unbuilt rung never reaches disk.
 */
async function setAutomationLevel(level: AutomationLevel): Promise<void> {
  await writeAutomationLevel(app.getPath('userData'), level)
  // Force the DenService to rebuild with the new level on its next lazy resolve.
  denService = undefined
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

    // powerMonitor reconnect: on wake/unlock, re-check the Remote right away (issue 1-12).
    powerMonitor.on('resume', () => trayPoller?.onReconnect())
    powerMonitor.on('unlock-screen', () => trayPoller?.onReconnect())
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
 * Creates the app's single BrowserWindow and loads the renderer into it.
 *
 * The window is hardened against the renderer: `contextIsolation` + no
 * `nodeIntegration` + `sandbox` keep untrusted renderer code off Node, so the
 * only main<->renderer bridge is the preload script's exposed API surface.
 *
 * Renderer source is chosen by build context: in dev (`!app.isPackaged`) it
 * loads the Vite dev-server URL for HMR; in a packaged build it loads the
 * bundled `index.html` from disk.
 */
function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 840,
    minHeight: 560,
    title: 'dotden',
    backgroundColor: '#050505',
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

  // Dev vs. packaged: prefer the live Vite dev server (HMR) when running
  // unpackaged with ELECTRON_RENDERER_URL set; otherwise load the built file.
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// App bootstrap: spin up the window once Electron is ready, then arm the
// updater and the macOS re-activation handler.
app.whenReady().then(() => {
  // The IpcBridge owns the renderer↔main surface: it forwards each call's `_trace`
  // id into the foundation. AbortSignal-based cancellation is not yet wired across
  // IPC (a signal cannot cross Electron's structured-clone boundary), so v1 relies
  // on the foundation's per-call timeouts as the guarantee against a hung call.
  registerIpcBridge(ipcMain, {
    remoteClient: getRemoteClient,
    denService: getDenService,
    discoveryScanner: getDiscoveryScanner,
    environmentRegistry: getEnvironmentRegistry,
    getAutomationLevel,
    setAutomationLevel,
  })
  createWindow()

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
