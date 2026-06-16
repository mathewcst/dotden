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
import type {
  ApplyResult,
  CommitResult,
  IncomingReviewItem,
} from '../main/foundation/den-service.js'

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
  /**
   * Den operations — the MVP sync loop (issue 1-04), each forwarded to a `den:*`
   * IPC channel through the {@link DotdenApi}-typed preload bridge. Every method
   * mints a fresh `_trace` correlation id so the Operation lines up across the
   * boundary (ADR 0007). All paths are destination-relative File paths (e.g. `.zshrc`).
   */
  readonly den: {
    /**
     * **Track** a File and record its Workspace placement (env A).
     * Maps to `chezmoi add` + a synced `.myenv/` placement.
     */
    track(targetPath: string): Promise<void>
    /**
     * **Commit** Tracked Files into the Den with a templated message — LOCAL only
     * (a Commit is local until pushed, ADR 0006). The result carries the resolved
     * message and which template produced it, for the Commit UI.
     */
    commit(targetPaths: readonly string[]): Promise<CommitResult>
    /** **Sync now** push half: send already-Committed changes to the Remote (env A). */
    syncPush(): Promise<void>
    /**
     * **env B** — fetch the Remote and list incoming Files for a reviewed Apply,
     * restricted to the incoming-clean path (no local copy, no Conflict).
     */
    listIncoming(): Promise<readonly IncomingReviewItem[]>
    /** **Apply** reviewed incoming Files to disk (env B). Maps to `chezmoi apply`. */
    apply(targetPaths: readonly string[]): Promise<ApplyResult>
  }
}
