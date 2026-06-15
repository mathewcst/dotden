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
import { RemoteClient } from './foundation/remote-client.js'
import { resolveBundledTools } from './foundation/tools.js'

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

/** Resolve bundled tools and construct a {@link RemoteClient} for this environment. */
async function buildRemoteClient(): Promise<RemoteClient> {
  const tools = await resolveBundledTools()
  return new RemoteClient({
    chezmoiBin: tools.chezmoi,
    gitBin: tools.git,
    sourceDir: join(app.getPath('userData'), 'chezmoi-source'),
    destinationDir: app.getPath('home'),
  })
}

function registerIpcBridge(): void {
  // Per-operation cancellation (AbortSignal) is not yet wired across IPC — a
  // signal cannot cross Electron's structured-clone boundary — so v1 relies on
  // the RemoteClient's per-call timeout as the guarantee against a hung call.
  ipcMain.handle(
    'remote:preflight',
    async (_event, payload: { url: string; _trace: { traceId: string } }) =>
      (await getRemoteClient()).preflightRemote(payload.url, { _trace: payload._trace }),
  )
  ipcMain.handle(
    'remote:connect',
    async (_event, payload: { url: string; _trace: { traceId: string } }) =>
      (await getRemoteClient()).connectExistingRemote(payload.url, { _trace: payload._trace }),
  )
  ipcMain.handle(
    'remote:latest-sha',
    async (_event, payload: { url: string; branch?: string; _trace: { traceId: string } }) =>
      (await getRemoteClient()).latestRemoteSha(payload.url, payload.branch, {
        _trace: payload._trace,
      }),
  )
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
  registerIpcBridge()
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
