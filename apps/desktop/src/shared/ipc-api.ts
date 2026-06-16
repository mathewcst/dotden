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
  AffectedEnvironment,
  ApplyResult,
  CommitResult,
  ConflictReview,
  FileTreeView,
  IncomingReviewItem,
  IncomingSummary,
} from '../main/foundation/den-service.js'
import type { ResolutionChoice } from '../main/foundation/conflict-model.js'
import type { Group, Workspace } from '../main/foundation/myenv-store.js'
import type {
  ClaimSuggestion,
  EnvironmentWithAttribution,
} from '../main/foundation/environment-registry.js'
import type { DiscoverySuggestion } from '../main/foundation/discovery-scanner.js'

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
     * restricted to the incoming-clean path (no local copy, no Conflict). Each item
     * carries its Remote-axis marker (↓ incoming) for the tree decoration lane (1-09).
     */
    listIncoming(): Promise<readonly IncomingReviewItem[]>
    /**
     * **env B** — the Review & Apply summary (issue 1-09): the incoming Files PLUS the
     * source environment's label, for the top-level "N incoming from `<environment>` —
     * Review & Apply" entry. Fetches the Remote like {@link listIncoming}.
     */
    incomingSummary(): Promise<IncomingSummary>
    /**
     * **env B** — the diff of one incoming File the user reviews BEFORE applying
     * (issue 1-09). Maps to `chezmoi diff <file>`; an empty string means nothing to
     * apply. Fed into `@pierre/diffs` `PatchDiff`, like {@link DotdenApi.den.diff}.
     */
    incomingDiff(targetPath: string): Promise<string>
    /**
     * **Apply** reviewed incoming Files to disk (env B). Maps to a per-File guarded
     * `chezmoi apply <file>` so each File applies independently (per-file atomicity,
     * issue 1-09): one File's failure never blocks the rest. The result reports every
     * File's outcome with a reason for failures, so the UI can retry just the failures.
     * "Apply one" passes a single path; "Apply all" passes every reviewed path; "Retry"
     * passes only the previously-failed paths.
     *
     * `ApplyPlanner` (issue 1-10) gates the write: a File with uncommitted local edits is
     * refused `blocked-uncommitted-edit` (invariant #2, re-checked atomically at write
     * time — never silently overwritten), and an incoming **deletion** is applied ONLY if
     * its path is in `confirmedDeletions` (invariant #4) — otherwise it is refused
     * `needs-confirmation`. Pass the paths the user explicitly confirmed for deletion.
     */
    apply(
      targetPaths: readonly string[],
      confirmedDeletions?: readonly string[],
    ): Promise<ApplyResult>
    /**
     * **Conflict** — fetch + merge the Remote in the source repo and surface the true
     * Conflicts for resolution (issue 1-11). git auto-merges non-overlapping hunks, so
     * the result lists ONLY overlapping Conflicts (the user is never asked about
     * non-conflicts), each with its three sides (current/incoming/both) for the merge
     * view. `autoMerged` is `true` when there was nothing to resolve. Maps to `git fetch`
     * + `git merge` in the source-state repo — NOT `chezmoi merge` (that is local-drift).
     */
    detectConflicts(): Promise<ConflictReview>
    /**
     * **Resolve one Conflict** with the user's explicit Keep mine (`current`) / Take theirs
     * (`incoming`) / Open both (`both`) choice (issue 1-11). The choice is the ONLY input
     * that produces resolved bytes: it goes through `ConflictModel.resolve(choice)` in the
     * main process (the sole owner of "never auto-resolve a Conflict", invariant #1), which
     * mints the un-forgeable resolution the merge view consumes — the renderer never calls
     * `@pierre/diffs`' own `resolveConflict()`. The resolved bytes are written + staged; the
     * merge is completed separately by {@link DotdenApi.den.completeConflictResolution}.
     */
    resolveConflict(targetPath: string, choice: ResolutionChoice): Promise<void>
    /**
     * **Apply resolution** — complete the in-progress merge once every Conflict is resolved
     * (issue 1-11). Maps to `git commit` for the pending merge; git refuses while any
     * `UU` entry remains, so a half-resolved Conflict can never be committed.
     */
    completeConflictResolution(): Promise<void>
    /**
     * **Abort** the in-progress merge, discarding the half-merged tree (issue 1-11). Maps
     * to `git merge --abort`: the user returns to the pre-merge state and NOTHING is
     * resolved (the safe escape hatch from the resolver).
     */
    abortConflicts(): Promise<void>
    /**
     * The three-pane tree view (issue 1-07): every managed File joined with its
     * Workspace placement, local-axis git status (M/A/D/R/U), and out-of-OS-Scope
     * muted flag. Read-only (no Operation/wide event), refreshed after each verb so
     * the tree, status decorations, and change dots stay live. Maps to
     * `chezmoi managed`/`status`/`ignored` + the synced `.myenv/` placements.
     */
    tree(): Promise<FileTreeView>
    /**
     * Real unified diff for the selected File's center pane (issue 1-07). Maps to
     * `chezmoi diff <file>`; an empty string means the File is unchanged. Fed
     * straight into `@pierre/diffs` `PatchDiff`.
     */
    diff(targetPath: string): Promise<string>
    /**
     * **Untrack** a File (issue 1-08) — stop managing it while the real path **stays
     * on disk on every environment**. Maps to chezmoi `forget` + drop the synced
     * placement, committed LOCALLY (ADR 0006). Non-destructive: the renderer confirms
     * with the Default-tone dialog whose copy states the File stays on disk.
     */
    untrack(targetPath: string): Promise<void>
    /**
     * **Delete everywhere** a File (issue 1-08) — remove it from the Den **and delete
     * the real path on every environment where it applies**. Maps to chezmoi
     * `destroy` + drop the synced placement, committed LOCALLY (ADR 0006). Destructive
     * and DISTINCT from {@link DotdenApi.den.untrack}: the renderer confirms with the
     * Destructive-tone dialog after naming the affected environments.
     */
    deleteEverywhere(targetPath: string): Promise<void>
    /**
     * The environments a {@link DotdenApi.den.deleteEverywhere} would touch — every
     * environment subscribed to the File's Workspace (issue 1-08). Read-only; drives
     * the destructive confirm's blast-radius list so the user sees which environments
     * lose the real path before confirming.
     */
    affectedEnvironments(targetPath: string): Promise<readonly AffectedEnvironment[]>
    /**
     * **Create a Workspace** (issue 1-14) — a new top-level access boundary the user
     * adds to separate access (e.g. "Work"). Maps to a synced `.myenv/` write committed
     * LOCALLY (ADR 0006); has no chezmoi equivalent. Creating the *second* Workspace is
     * what reveals the Workspace concept in the UI (it stays invisible while only the
     * default one exists).
     */
    createWorkspace(label: string): Promise<Workspace>
    /**
     * **Create a Group** inside a Workspace (issue 1-14) — a nested, user-named node
     * that organizes Files. Groups are PURE organization (ADR 0005): they change
     * neither access (subscription) nor any File's on-disk path. `parentId` nests the
     * Group under another Group in the same Workspace, or is `null` for a top-level one.
     */
    createGroup(workspaceId: string, label: string, parentId: string | null): Promise<Group>
    /**
     * **File a managed File under a Group** (or back to the Workspace root, `null`)
     * — the organize-only move (issue 1-14). Changes ONLY the placement's Group; the
     * File's access (Workspace) and on-disk path are untouched (the ADR 0005 invariant).
     */
    moveFileToGroup(targetPath: string, groupId: string | null): Promise<void>
    /**
     * **Move a managed File into a different Workspace** (issue 1-14). Unlike
     * {@link DotdenApi.den.moveFileToGroup}, this DOES change which environments apply
     * the File (ADR 0005), so the File's Group resets to the new Workspace's root. The
     * File's on-disk path is still untouched.
     */
    setFileWorkspace(targetPath: string, workspaceId: string): Promise<void>
  }
  /**
   * First-run **discovery** operations (issue 1-06), forwarded to `discover:*` IPC
   * channels. The scan is grounded in a catalog of known tools so suggestions are
   * relevant (feature-detection, not a blind sweep — ADR 0022). Discovery only
   * *finds* candidate Files; Tracking the picks reuses {@link DotdenApi.den.track}.
   */
  readonly discover: {
    /**
     * Scan this environment's home dir for config Files of known tools, returning
     * the ones that exist for the Discover onboarding step to offer for Tracking.
     */
    scan(): Promise<readonly DiscoverySuggestion[]>
    /**
     * Inspect an arbitrary home-relative path the user dragged in or browsed for, so
     * Files the catalog missed can be Tracked too ("manage anything"). Resolves to
     * `null` when the path does not exist or escapes the home dir.
     */
    inspectPath(targetPath: string): Promise<DiscoverySuggestion | null>
  }
  /**
   * Environment registry & identity operations (issue 1-05), each forwarded to an
   * `env:*` IPC channel. Identity is the stable id, never the hostname; the editable
   * label defaults from the hostname; attribution is derived from git log on read and
   * never persisted (ADR 0024).
   */
  readonly environment: {
    /**
     * List every environment in the synced registry, joined with git-log-derived
     * attribution (last author/activity/subject + commit count). `isSelf` flags this
     * running environment. Drives the Environments surface and "N incoming from <env>".
     */
    list(): Promise<readonly EnvironmentWithAttribution[]>
    /**
     * Rename THIS environment's friendly label (a one-line registry diff). The stable
     * id is untouched, so identity and attribution survive — no churn (ADR 0024).
     */
    rename(label: string): Promise<EnvironmentWithAttribution>
    /**
     * Suggest the likely registry entries a fresh install is "returning" to, ranked by
     * OS + setup-time hostname (issue 1-13). The user still explicitly claims one;
     * dotden never auto-merges.
     */
    suggestClaims(): Promise<readonly ClaimSuggestion[]>
  }
}
