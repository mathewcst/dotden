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
import type { ConnectResult, PreflightResult } from '../main/foundation/sync/remote-client.js'
import type {
  AffectedEnvironment,
  AppearanceState,
  ApplyResult,
  AutoApplyResult,
  CommitResult,
  CommitTemplateState,
  ConflictReview,
  ConnectedRemote,
  FileTreeView,
  ConvertSecretRequest,
  ConvertSecretResult,
  IncomingReviewItem,
  IncomingSummary,
  RestoreResult,
  SubscriptionState,
  SyncPushResult,
  YoloSyncResult,
} from '../main/foundation/den-service.js'
import type { LaunchState } from '../main/foundation/environments/launch-state.js'
import type { UnsubscribeDisposition } from '../main/foundation/settings/subscription-settings.js'
import type { SecretFinding } from '../main/foundation/secrets/secret-scanner.js'
import type { SecretAllowlist } from '../main/foundation/secrets/secret-allowlist.js'
import type { DetectedPasswordManager } from '../main/foundation/secrets/pm-detect.js'
import type { PmPreference } from '../main/foundation/secrets/pm-preference.js'
import type { FileVersion } from '../main/foundation/file-history/file-history.js'
import type { ResolutionChoice } from '../main/foundation/apply/conflict-model.js'
import type { Group, Workspace } from '../main/foundation/den-store.js'
import type { Scope } from '../main/foundation/platform/os-scope.js'
import type {
  ClaimSuggestion,
  EnvironmentWithAttribution,
} from '../main/foundation/environments/environment-registry.js'
import type {
  DiscoveryScanResult,
  DiscoverySuggestion,
} from '../main/foundation/environments/discovery-scanner.js'
import type { AutomationLevel } from '../main/foundation/apply/automation-policy.js'
import type { SyncSettings } from '../main/foundation/settings/sync-settings.js'
import type { PrivacySettings } from '../main/foundation/settings/privacy-settings.js'
import type { AppearanceOverride, AppearanceSettings } from './appearance-settings.js'
import type { AppInfo, UpdateCheckResult } from './app-info.js'

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
  /** Window chrome operations for the frameless shell titlebar. */
  readonly window: {
    /** Minimize the current BrowserWindow. */
    minimize(): Promise<void>
    /** Toggle maximize/restore for the current BrowserWindow; returns the new maximized state. */
    toggleMaximize(): Promise<boolean>
    /** Close the current BrowserWindow. */
    close(): Promise<void>
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
     * **Read the launch-routing gate** (ADR 0026) — the single boot question "is THIS
     * environment already set up here?". Returns a `fresh | incomplete | ready` status
     * DERIVED from the synced registry + the local clone (never a stored `onboardingComplete`
     * flag — ADR 0003/0024). App.tsx boots into a `'booting'` splash, calls this once, then
     * routes `ready → app` and everything else `→ landing` (v1; smart-resume of `incomplete`
     * is a deferred follow-up — see ADR 0026). Side-effect-free: it neither mints an identity
     * nor registers this environment, so it is safe to call before any Den exists.
     */
    launchState(): Promise<LaunchState>
    /**
     * **Finish first-run setup** even when no Files were Tracked. Seeds the default Workspace and
     * registers this environment so the launch gate opens the app on the next boot.
     */
    registerEnvironment(): Promise<void>
    /**
     * **Track** a File and record its Workspace placement (env A).
     * Maps to `chezmoi add` + a synced `.dotden/` placement.
     */
    track(targetPath: string): Promise<void>
    /**
     * **Scan the about-to-be-Committed set for secrets** (issue 2-03) — the commit-time
     * detection that drives the amber warn step. The renderer calls this BEFORE
     * {@link commit}; on a non-empty result it shows the warn step (one card per finding:
     * File, kind, line, masked preview) and lets the user Convert or Commit anyway (warn,
     * never block — ADR 0001). An empty result means "nothing flagged", so the renderer
     * proceeds straight to {@link commit}. Findings the user previously dismissed via the
     * synced "Don't warn me about this File again" allowlist (issue 2-04) are filtered OUT
     * here — scoped per File+match, so a NEW secret in an allowlisted File still warns. Pure
     * detection (regex + entropy, no shell): the masked preview never exposes the full secret,
     * and the values never leave the main process.
     */
    scanCommit(targetPaths: readonly string[]): Promise<readonly SecretFinding[]>
    /**
     * **Allowlist a flagged secret** — persist the "Don't warn me about this File again"
     * checkbox the user ticks under Commit-anyway (issue 2-04, story 16). Records the dismissed
     * finding into the SYNCED `.dotden/` allowlist so the warn step stops opening for THIS match
     * on subsequent Commits, and — because `.dotden/` syncs (ADR 0024) — on every environment.
     * Scoped per File+match: a different/new secret in the same File still warns (a real leak is
     * never silently re-enabled). Only the masked preview is stored; the raw secret never syncs.
     * The renderer calls this just BEFORE {@link commit} when the box is ticked, so the decision
     * is staged into the SAME Commit (which stages `.dotden/`) and travels with the next Sync.
     */
    allowlistSecret(finding: SecretFinding): Promise<SecretAllowlist>
    /**
     * **Read the Commit tab's state** (issue 2-09) — the synced commit-message template plus the
     * cross-OS-safe facts (`os`/`arch`/`hostname` from chezmoi template data + this environment's
     * label) the tab's live preview needs. The renderer renders the preview itself with the shared
     * `renderCommitTemplate`, supplying the app runtime clock for the date/time fields, so NO shell
     * command is reachable from the renderer (the load-bearing privacy rule, scope-v1).
     */
    commitTemplate(): Promise<CommitTemplateState>
    /**
     * **Save the Commit tab's template** (issue 2-09) — the editor's save + "Reset to default".
     * Persists the synced default (`.dotden/commit-template.json`) and Commits the `.dotden/` change
     * LOCALLY (ADR 0006) so it travels on the next Sync; maps to chezmoi `git.commitMessageTemplate`.
     * Returns the refreshed state so the tab re-renders from the source of truth.
     */
    setCommitTemplate(template: string): Promise<CommitTemplateState>
    /**
     * **Read the EFFECTIVE appearance settings** (issues 2-10 + 2-17, story 54) — the synced app
     * theme + preferred default Apply behaviour + which cross-environment events notify, with this
     * environment's LOCAL override overlaid (local field beats synced — ADR 0024). The renderer
     * applies the theme class itself from the returned `theme`, so swapping themes is a single class
     * toggle (no per-keystroke round-trip). App.tsx uses this to paint the live theme on launch.
     */
    appearanceSettings(): Promise<AppearanceSettings>
    /**
     * **Read the Appearance tab's full synced-vs-local state** (issue 2-17, story 54) — the synced
     * defaults (`.dotden/`), this environment's sparse local override (`userData`), and the resolved
     * effective settings, in one read. The tab binds its controls to `effective` and uses
     * `synced`/`override` to mark which fields are pinned-here vs. inherited and to offer "reset to
     * the synced default". Reading never mutates the synced value (ADR 0024).
     */
    appearanceState(): Promise<AppearanceState>
    /**
     * **Save the SYNCED appearance defaults** (issue 2-10) — the theme picker + default-Apply +
     * notification toggles edited "for every environment". Persists `.dotden/appearance-settings.json`
     * and Commits the change LOCALLY (ADR 0006) so it travels on the next Sync. Gates no invariant
     * (the AutomationPolicy/ApplyPlanner owners still own the real Apply, ADR 0008). Does NOT touch
     * this environment's local override, so a field pinned here still resolves to the pin. Returns the
     * refreshed synced-vs-local state so the tab re-renders from the source of truth.
     */
    setAppearanceSettings(settings: AppearanceSettings): Promise<AppearanceState>
    /**
     * **Pin (or clear) this environment's LOCAL appearance override** (issue 2-17, ADR 0024) — the
     * per-field pins that shadow the synced defaults on THIS environment only. Persists to `userData`
     * (NEVER the synced `.dotden/`), so it never changes the value other environments read — a local
     * override shadows a default without changing it everywhere. The empty override `{}` clears all
     * pins (follow the synced defaults again). No Commit, no Sync — a local override never travels.
     * Returns the refreshed synced-vs-local state.
     */
    setAppearanceOverride(override: AppearanceOverride): Promise<AppearanceState>
    /**
     * **Detect installed password managers** for the convert picker (issue 2-05, step 2). Returns
     * the v1 catalog (1Password/Bitwarden/pass) annotated with whether each CLI (`op`/`bw`/`pass`)
     * is present on THIS environment — an option is selectable only when available, and an absent
     * one keeps its install hint (never fail silently). Detected-CLI presence is environment-local,
     * never synced (ADR 0024). Read-only feature-detection — it never unlocks a vault.
     */
    detectPasswordManagers(): Promise<readonly DetectedPasswordManager[]>
    /**
     * **Read this environment's remembered password-manager preference** (the "Remember my choice"
     * default, issue 2-05). `null` when none is set. The picker pre-selects it so a remembered
     * conversion goes straight to the preferred manager. Environment-local, never synced.
     */
    pmPreference(): Promise<PmPreference | null>
    /**
     * **Convert a flagged value into a Secret reference** (issue 2-05) — write the chezmoi `.tmpl`
     * target + the password-manager template call into source state, then Commit it so ONLY the
     * reference enters the Den. The raw secret is NEVER written — it stays in the user's vault and
     * chezmoi re-fetches it at Apply time. Optionally remembers the chosen manager (env-local). The
     * single narrow, guided slice of chezmoi templating v1 exposes (scope-v1 "Secrets").
     */
    convertSecret(request: ConvertSecretRequest): Promise<ConvertSecretResult>
    /**
     * **Commit** Tracked Files into the Den with a templated message — LOCAL only
     * (a Commit is local until pushed, ADR 0006). The result carries the resolved
     * message and which template produced it, for the Commit UI.
     */
    commit(targetPaths: readonly string[]): Promise<CommitResult>
    /**
     * **Sync now** push half: send already-Committed changes to the Remote (env A), flushing
     * any push queued while offline. Maps to `git push` (all-or-nothing → also flushes the
     * offline queue). The result reports whether the push reached the Remote (`pushed`) or
     * was **queued** because the machine is offline (`queued`, issue 1-16); an offline Sync
     * does NOT throw (the local Commits are safe + retried), so the UI shows the offline
     * banner. A server-reached rejection still rejects so the user sees the real error.
     */
    syncPush(): Promise<SyncPushResult>
    /**
     * **Flush the offline push queue** — retry a push queued while offline (issue 1-16),
     * the reconnect path. No-op when nothing is queued. Returns whether a queued push was
     * flushed (`pushed`) or remained queued because the machine is still offline (`queued`).
     */
    flushPushQueue(): Promise<SyncPushResult>
    /**
     * Whether a push is currently **queued** offline (owed to the Remote), issue 1-16.
     * Read-only; drives the offline banner ("changes queued — will sync when you reconnect")
     * without touching the network.
     */
    pushPending(): Promise<boolean>
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
     * **Auto-apply** Sync (issue 2-12) — fetch the Remote and, when this environment's
     * automation level is **Auto-apply** (or YOLO), apply the *clean* incoming changes
     * automatically while still holding Conflicts, the uncommitted-edit guard, and incoming
     * deletions for manual review. At Manual/Auto-sync nothing is auto-applied
     * (`autoApplyEnabled: false`) and every incoming File is returned in `needsReview`.
     *
     * The LEVEL is gated by `AutomationPolicy` and the per-File safety by the same owners a
     * manual Apply uses (`ConflictModel`/`ApplyPlanner`/`ApplicabilityResolver`, ADR 0008) —
     * an Auto-apply Sync never silently overwrites, auto-resolves a Conflict, or lands an
     * unconfirmed deletion. Returns what landed plus what was held back (with the reason).
     */
    autoApply(): Promise<AutoApplyResult>
    /**
     * **YOLO hands-off Sync** (issue 2-13) — the full ladder's top rung. In strict order:
     * auto-Commit the applicable local edits **before** merging (so in-progress work survives
     * as Commits — never-lose-data), push, merge (surfacing true Conflicts but **never**
     * auto-resolving them), then auto-apply the *clean* incoming changes while still holding
     * deletions / the uncommitted-edit guard / non-applicable Files for the user.
     *
     * Only meaningful at the YOLO level; the renderer invokes it when this environment is on
     * YOLO. It re-uses the SAME owners and write paths every other rung uses (ADR 0008): YOLO
     * removes review *prompts* for clean changes, never the safety *owners*. Returns the
     * three-phase record (what was Committed, the Conflicts left for the user, what landed).
     */
    yoloSync(): Promise<YoloSyncResult>
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
     * `chezmoi managed`/`status`/`ignored` + the synced `.dotden/` placements.
     */
    tree(): Promise<FileTreeView>
    /**
     * Real unified diff for the selected File's center pane (issue 1-07). Maps to
     * `chezmoi diff <file>`; an empty string means the File is unchanged. Fed
     * straight into `@pierre/diffs` `PatchDiff`.
     */
    diff(targetPath: string): Promise<string>
    /**
     * **Read the connected Remote** for the Settings → Account tab (issue 2-11, V1-Lean / ADR 0020).
     * Maps to `git remote get-url origin`, returning the URL plus its parsed Provider host/scheme
     * (e.g. `github.com` / `https`). All-`null` when no Remote is connected (a local-only Den), so the
     * tab shows an honest "no Remote connected" empty state. There is NO account/token field by
     * construction — v1 holds none; the live credential check is the separate {@link DotdenApi.remote.preflight}
     * (`git ls-remote`) call the tab makes to show whether auth is working right now.
     */
    connectedRemote(): Promise<ConnectedRemote>
    /**
     * The selected File's **version history** for the History tab (issue 2-01) — every Commit
     * the user ever made for that File, newest first, each carrying its message, short SHA, and
     * a readable timestamp, with the newest flagged `current` (the version matching the Den
     * state). Derived PURELY from `git log` scoped to the File (no separate history store, the
     * issue's load-bearing rule). Read-only; an empty array means the File has no committed
     * history yet (the tab shows an honest empty state). History is strictly per-File.
     */
    fileHistory(targetPath: string): Promise<readonly FileVersion[]>
    /**
     * Read-only **preview of one version** of a File in the History tab (issue 2-01). Maps to
     * `git show <sha> -- <file>`: the patch that version's Commit applied to the File, fed into
     * the same read-only `@pierre/diffs` `PatchDiff` role as {@link DotdenApi.den.diff} — NO
     * resolve/edit affordances, NO checkout. Selecting a version row calls this to fill the
     * preview panel. An empty string means the version did not change this File (or it is
     * unresolvable), shown honestly rather than as a fake patch.
     */
    fileVersionDiff(targetPath: string, sha: string): Promise<string>
    /**
     * **Restore a past version FORWARD** — the single Restore action in the History tab
     * (issue 2-02). Captures the previewed version's content as a brand-new Commit; it
     * **never rewrites history**, so the prior current version stays reachable in the list
     * and nothing is destroyed. Maps to `git show <sha>:<file>` → write forward →
     * `chezmoi apply` → `git commit` (a NEW commit). The renderer confirms with the
     * **Default-tone** dialog ("Saved as a new commit; your current version stays in
     * history") — NOT the destructive red reserved for Delete — because nothing is lost.
     * The result reports which version was restored and whether a new Commit was recorded
     * (`committed: false` is a clean no-op when restoring the Current version onto itself).
     */
    restoreVersion(targetPath: string, sha: string): Promise<RestoreResult>
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
     * adds to separate access (e.g. "Work"). Maps to a synced `.dotden/` write committed
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
    /**
     * **Scope a File** to specific OSes (issue 1-15) — a File scoped to other OSes is not
     * synced/applied where it doesn't belong. Maps to per-OS `.chezmoiignore` (ADR 0003).
     * The requested Scope is **clamped to the File's inherited Folder/Workspace Scope** in
     * the main process (narrowable, never broadenable — CONTEXT.md "Scope"); pass `null` to
     * clear the File's own restriction and inherit only. Returns the resulting EFFECTIVE
     * Scope so the inspector reflects what was actually applied (which may be narrower than
     * requested if the request tried to broaden past the Folder). Committed LOCALLY (ADR 0006).
     */
    setFileScope(targetPath: string, scope: Scope): Promise<Scope>
    /**
     * **Scope a Group (Folder)** to specific OSes (issue 1-15) — its Files and child Groups
     * inherit the Scope (narrowable, never broadenable). Like {@link DotdenApi.den.setFileScope}
     * but for a Folder; the request is clamped under the Group's inherited Scope. Returns the
     * Group's resulting EFFECTIVE Scope. Committed LOCALLY.
     */
    setGroupScope(workspaceId: string, groupId: string, scope: Scope): Promise<Scope>
    /**
     * Read this environment's **Workspace-subscription state** (issue 1-13) — every Workspace
     * flagged with whether this environment subscribes, whether this env has a registry entry
     * yet, and a never-silent `emptyDenWarning` when this env would materialize an EMPTY Den
     * (unregistered / empty subscription, the templated `.chezmoiignore` fail-safe). Drives the
     * returning-flow subscription pick and the honest empty-Den explanation. Read-only.
     */
    subscriptionState(): Promise<SubscriptionState>
    /**
     * **Set this environment's Workspace subscription** (issue 1-13, ADR 0005) — the returning
     * second-environment pick. Writes the chosen Workspaces into the synced registry BEFORE any
     * Apply (the registry-entry guard's ordering layer), re-compiles the templated
     * `.chezmoiignore` so un-subscribed Files are ignored here, and commits LOCALLY (ADR 0006).
     * Pass `undefined` to subscribe to ALL Workspaces (the default). Applies no File — the first
     * materialization is the deliberate reviewed Apply that follows.
     */
    setSubscriptions(workspaceIds?: readonly string[]): Promise<SubscriptionState>
    /**
     * **Un-subscribe a Workspace** on this environment (issue 1-13), with the explicit choice of
     * what to do with the Files it leaves behind: `keep` them on disk as untracked orphans (the
     * safe default), or `remove` this environment's local copies. `.chezmoiignore` alone never
     * deletes Files, so `remove` is an explicit local removal that touches only this env (the
     * shared source state + other environments keep the File). Committed LOCALLY (ADR 0006).
     */
    unsubscribeWorkspace(
      workspaceId: string,
      disposition: UnsubscribeDisposition,
    ): Promise<SubscriptionState>
    /**
     * Read this environment's **remembered** "what to do with un-subscribed Files" default
     * (issue 1-13) — `keep` (leave on disk, the safe default) or `remove` (delete this env's
     * local copies). Environment-local (`userData`, never synced, ADR 0024). Pre-selects the
     * un-subscribe confirm so the user is not re-asked every time.
     */
    unsubscribeDisposition(): Promise<UnsubscribeDisposition>
    /**
     * **Remember** this environment's un-subscribe disposition default ("don't ask me again",
     * issue 1-13). Persists `keep`/`remove` locally; the next un-subscribe confirm pre-selects it.
     */
    rememberUnsubscribeDisposition(disposition: UnsubscribeDisposition): Promise<void>
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
     * Resolves to the full {@link DiscoveryScanResult} (suggestions under `.suggestions`).
     */
    scan(): Promise<DiscoveryScanResult>
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
    /**
     * Register THIS environment as a **brand-new** second environment (the "new" branch of the
     * FoundDen new-or-returning fork, issue 1-13). Writes this env's registry entry with its
     * chosen Workspace subscription (defaulting to ALL) BEFORE any Apply — the registry-entry
     * guard's ordering layer — and mirrors its id into the local chezmoi config. Applies no
     * File; the first materialization is the reviewed Apply that follows.
     */
    registerNew(workspaceIds?: readonly string[]): Promise<readonly EnvironmentWithAttribution[]>
    /**
     * **Claim an existing registry entry** as THIS install's identity (the "returning" branch,
     * issue 1-13, ADR 0024). Adopts the chosen entry's stable id locally so this environment
     * keeps its history/attribution (continuous), re-arms the id-bound services, then registers
     * its subscription (defaulting to ALL). Claiming only re-associates identity — Files are
     * applied fresh via the normal reviewed Apply, and dotden never auto-merges.
     */
    claim(
      envId: string,
      workspaceIds?: readonly string[],
    ): Promise<readonly EnvironmentWithAttribution[]>
    /**
     * **Reassign / merge** a mistaken duplicate registry entry into the correct one (issue 2-15,
     * ADR 0024 lifecycle). Folds `fromId` (the duplicate) into `intoId` (the keeper): the keeper
     * inherits the UNION of both Workspace subscriptions (a merge only ever widens access) and the
     * duplicate is dropped. The keeper's stable id is preserved, so its git-log attribution stays
     * continuous; dotden NEVER auto-merges — the user explicitly picks which entry folds into which.
     * Commits the `.dotden/` change LOCALLY so it travels. Returns the refreshed list (with
     * attribution) so the Environments tab re-renders in one round-trip.
     */
    reassign(fromId: string, intoId: string): Promise<readonly EnvironmentWithAttribution[]>
    /**
     * **Retire / remove** a decommissioned environment from the synced registry (issue 2-15,
     * ADR 0024 lifecycle). Drops the entry keyed by `envId`; identity is the stable id, so this
     * never removes the wrong machine. Refuses to retire THIS running environment. Attribution is
     * never touched — the retired environment's past `git log` history stays readable. Commits the
     * `.dotden/` change LOCALLY so it travels. Returns the refreshed list so the tab re-renders.
     */
    retire(envId: string): Promise<readonly EnvironmentWithAttribution[]>
  }
  /**
   * Automation-ladder operations (issue 1-12), forwarded to `automation:*` IPC channels.
   *
   * The automation level is **environment-local** (CONTEXT.md "Auto-sync"): each
   * environment decides its own rung, persisted in Electron `userData`, never synced.
   * The MVP exposes only **Manual** + **Auto-sync** — Apply always stays a manual review,
   * and Commit is never automatic at any level (ADR 0006/0008).
   */
  readonly automation: {
    /** Read this environment's selected automation level (Manual or Auto-sync). */
    getLevel(): Promise<AutomationLevel>
    /**
     * Set this environment's automation level — the onboarding Auto-sync opt-in and the
     * Settings toggle. Persists locally and re-arms the background services. Rejects any
     * level the MVP does not expose (never persist an unbuilt rung).
     */
    setLevel(level: AutomationLevel): Promise<void>
  }
  /**
   * Sync & polling settings (issue 2-08), forwarded to `sync:*` IPC channels — the data
   * seam behind the Settings → Sync tab.
   *
   * Like the automation level, these are **environment-local** (ADR 0024): each environment
   * decides whether the background TrayPoller runs, how aggressively it polls, and whether
   * dotden starts at login. They live in Electron `userData` and NEVER enter the synced
   * `.dotden/` directory (paths/runtime/per-machine behavior are local facts, not user-authored
   * organization). Setting them re-arms the poller + applies the OS autostart preference.
   */
  readonly sync: {
    /** Read this environment's Sync settings (poller on/off · cadence · start-on-login). */
    getSettings(): Promise<SyncSettings>
    /**
     * Persist this environment's Sync settings AND apply the side effects: re-arm/dismiss the
     * TrayPoller for the new on-off + cadence, and set the OS login-item for start-on-login.
     * Returns the persisted settings so the tab re-renders from the source of truth.
     */
    setSettings(settings: SyncSettings): Promise<SyncSettings>
  }
  /**
   * Privacy / telemetry consent (issue 2-14, stories 43–44), forwarded to `privacy:*` IPC
   * channels — the data seam behind the Settings → Privacy tab.
   *
   * Two INDEPENDENT opt-in consents (anonymous usage analytics · crash reports), **both OFF by
   * default**, so nothing leaves the environment unless the user opts in. Like the Sync settings,
   * consent is **environment-local** (ADR 0024): a per-machine decision — a shared/locked-down
   * machine refuses telemetry independently — so it lives in Electron `userData` and NEVER enters
   * the synced `.dotden/` directory.
   *
   * **Control surface only (issue 2-14):** `setSettings` persists a stored boolean and NOTHING
   * else — no network call, no SDK, no egress. The consumers that act on consent (the Sentry/Umami
   * clients gated behind these flags, and the first-launch consent screen) are PRD 3 (issues
   * 3-09/3-10), which READ this consent; flipping a toggle here sends nothing anywhere yet.
   */
  readonly privacy: {
    /** Read this environment's telemetry consent (analytics · crash reports; both default off). */
    getSettings(): Promise<PrivacySettings>
    /**
     * Persist this environment's telemetry consent. Records the flag LOCALLY and returns the
     * persisted settings so the tab re-renders from the source of truth. No egress: this writes a
     * boolean and nothing else (the consent gate's consumers are PRD 3).
     */
    setSettings(settings: PrivacySettings): Promise<PrivacySettings>
  }
  /**
   * App info + update check (issue 2-16, stories 52–53), forwarded to `app:*` IPC channels —
   * the data seam behind the Settings → About tab.
   *
   * `getInfo` reports the running build's version (the canonical `app.getVersion()`); the tab
   * shows it so the user always knows what they are on. `checkForUpdates` runs the update-check
   * affordance: until issue 3-20 wires the real electron-updater feed it honestly resolves to
   * `'unavailable'` (with a reason) rather than a fake "you're current" (never fail silently). No
   * packaging/auto-update mechanics live here — only the version read + the check affordance (the
   * chezmoi credit the tab also shows is static copy, {@link CHEZMOI_CREDIT}, needing no IPC).
   */
  readonly app: {
    /** Read the running app's version + platform for the About tab's "you're on …" line. */
    getInfo(): Promise<AppInfo>
    /**
     * Run an update check. Resolves to an honest {@link UpdateCheckResult}: `unavailable` (with a
     * reason) until issue 3-20 publishes a real feed, or `up-to-date`/`update-available` once it
     * does. Never throws for "no feed" — a missing feed is a surfaced state, not an error.
     */
    checkForUpdates(): Promise<UpdateCheckResult>
  }
  /**
   * The TrayPoller's detect-only incoming notifications (issue 1-12), pushed FROM the
   * main process when another environment changed the Remote.
   *
   * This is the one main→renderer push channel (the rest of the surface is
   * renderer→main request/response): the always-on poller fires it so an OPEN window can
   * refresh its Incoming banner the moment the Remote moves, mirroring the OS notification
   * the poller raises when the window is closed. Detect-only — receiving it never applies
   * anything; it just prompts the in-app "check for incoming" refresh.
   */
  readonly trayPoller: {
    /**
     * Subscribe to incoming-detected events. The callback fires each time the poller sees
     * the Remote's latest SHA move past what this environment has seen.
     *
     * @param listener Called on each detected incoming move (no payload — the renderer
     *   re-fetches the incoming summary itself, keeping the contract narrow, ADR 0004).
     * @returns An unsubscribe function the renderer calls on unmount.
     */
    onIncoming(listener: () => void): () => void
  }
  /**
   * Connectivity signals for the offline queue (issue 1-16). The main process owns the
   * machine-wake reconnect trigger (`powerMonitor`), which flushes queued pushes; this lets
   * an open window re-read {@link DotdenApi.den.pushPending} so its offline banner stays in
   * step. The renderer ALSO listens to its own `navigator.onLine`/`online` event and calls
   * {@link DotdenApi.den.flushPushQueue} directly — the two paths are complementary.
   */
  readonly net: {
    /**
     * Subscribe to "the machine reconnected and queued pushes were flushed" events, pushed
     * FROM the main process after a `powerMonitor` wake. Detect-only for the UI: receiving
     * it just prompts a `pushPending()` re-read so the offline banner clears/persists.
     *
     * @param listener Called after each main-process reconnect flush (no payload).
     * @returns An unsubscribe function the renderer calls on unmount.
     */
    onReconnected(listener: () => void): () => void
  }
}
