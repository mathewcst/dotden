/**
 * Single source of truth for the `window.dotden` API contract.
 *
 * This is the ONE place the renderer↔main IPC surface is described. Both ends
 * are checked against it at compile time:
 * - the preload (`src/preload/index.ts`) annotates its exposed object as
 *   `const api: DotdenApi`, so the bridge is verified to *implement* the contract;
 * - the renderer (`src/renderer/vite-env.d.ts`) declares `Window.dotden` as
 *   `DotdenApi`, so app code is verified to *consume* the same contract.
 *
 * The result types are imported type-only from the foundation layer, so any
 * change to {@link PreflightResult}/{@link ConnectResult} becomes a renderer
 * COMPILE error instead of a silent runtime drift.
 *
 * The import is intentionally `import type` from a `.js`-suffixed specifier:
 * - it is erased at build time, so this file pulls **no** Electron/Node runtime
 *   into the renderer bundle (ADR 0023 — the foundation stays Electron-free, and
 *   the renderer never imports main-process runtime);
 * - the `.js` extension satisfies the main project's `NodeNext` resolution while
 *   the renderer's `Bundler` resolution accepts it too, so the single file
 *   typechecks under both `tsconfig.node.json` and `tsconfig.web.json`.
 */
import type { ConnectResult, PreflightResult } from '../main/foundation/remote-client.js'

/**
 * Node's `process.platform` value set, declared locally so this shared contract
 * needs no `@types/node` — the renderer project does not pull in node types, and
 * `NodeJS.Platform` (what the preload actually assigns) is assignable to this.
 */
export type Platform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd'

/**
 * The exact shape exposed on `window.dotden` by the preload bridge.
 *
 * Keep this surface narrow (ADR 0004): every method here widens the trusted
 * main↔renderer boundary, so only add what the renderer genuinely needs.
 */
export interface DotdenApi {
  /** Host platform, surfaced for diagnostics/UI copy (e.g. `'win32'`, `'darwin'`). */
  readonly platform: Platform
  /** Runtime versions of the embedding shell, surfaced read-only for diagnostics. */
  readonly versions: {
    readonly node: string
    readonly electron: string
    readonly chrome: string
  }
  /** Remote-connection operations, each forwarded to a `remote:*` IPC channel. */
  readonly remote: {
    /** Preflight a Remote URL against the user's existing git credentials. */
    preflight(url: string): Promise<PreflightResult>
    /** Connect a reachable Remote and initialize the local Den. */
    connect(url: string): Promise<ConnectResult>
    /** Read the latest advertised SHA for a branch, or null when absent. */
    latestSha(url: string, branch?: string): Promise<string | null>
  }
}
