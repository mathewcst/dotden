/**
 * Electron main-process entry point for the dotden desktop app.
 *
 * Owns the single hardened BrowserWindow, the (intentionally inert) auto-updater
 * wiring, and cross-platform app lifecycle (re-create the window on macOS
 * "activate", quit when all windows close everywhere except macOS).
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'node:path'
import { DenService } from './foundation/den-service.js'
import { loadEnvironmentIdentity } from './foundation/environment-identity.js'
import { EnvironmentRegistry } from './foundation/environment-registry.js'
import { OperationTracer } from './foundation/operation-tracer.js'
import { RemoteClient } from './foundation/remote-client.js'
import { resolveBundledTools } from './foundation/tools.js'
import { registerIpcBridge } from './ipc/ipc-bridge.js'

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
  return new DenService({
    chezmoiBin: tools.chezmoi,
    gitBin: tools.git,
    sourceDir: sourceDir(),
    destinationDir: app.getPath('home'),
    configPath: chezmoiConfigPath(),
    environment: { id: identity.id, label: identity.label, os: identity.os },
    tracer,
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
  const mainWindow = new BrowserWindow({
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

  // Dev vs. packaged: prefer the live Vite dev server (HMR) when running
  // unpackaged with ELECTRON_RENDERER_URL set; otherwise load the built file.
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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
    environmentRegistry: getEnvironmentRegistry,
  })
  createWindow()

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

// Standard cross-platform lifecycle: on Windows/Linux, closing the last window
// quits the app; on macOS the app stays resident (dock) until explicitly quit.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
