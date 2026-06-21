/**
 * den — IPC contract types shared by main + renderer (ADR 0031).
 * Moved out of foundation so the renderer speaks them without importing main.
 */
import type { Scope } from './scope.js'
import type { AppearanceSettings, AppearanceOverride } from './appearance-settings.js'
import type { CommitTemplateData } from './commit-template.js'
import type { ApplyChangeKind } from './apply.js'
import type { SecretReferenceRequest } from './secrets.js'
import type { WorkspacesDoc } from './workspace.js'

/**
 * The connected Remote, surfaced to the Settings → Account tab (issue 2-11, V1-Lean / ADR 0020).
 *
 * This is the honest "what is dotden actually using" read: the git Remote URL the user connected
 * plus the Provider host/scheme derived from it (`github.com`, `gitlab.com`, a self-hosted host, …).
 * There is deliberately **no account, token, or keychain field** — v1 holds none (ADR 0020); push
 * and fetch ride the user's own git credentials. The live credential check is a SEPARATE call
 * (`remote.preflight(url)` → `git ls-remote`), so the tab can show "is auth working right now?"
 * without this read having to spawn anything.
 *
 * `url` is `null` when no Remote is configured yet (a Den initialized locally but never connected),
 * in which case `host`/`scheme` are also `null` and the tab shows its honest "no Remote connected"
 * empty state rather than a blank card (never fail silently).
 */
export interface ConnectedRemote {
  /** The configured Remote URL (`git remote get-url origin`), shown read-only in mono; null when none. */
  readonly url: string | null
  /** Provider host parsed from the URL (e.g. `github.com`); null when no Remote is connected. */
  readonly host: string | null
  /** URL scheme/protocol class (e.g. `https`, `ssh`); null when no Remote is connected. */
  readonly scheme: string | null
}

/**
 * Result of a Commit, surfaced to the UI so it can show the resolved message, which
 * template produced it, and that the Commit is **local until pushed** (ADR 0006).
 */
export interface CommitResult {
  /** The fully resolved git commit message that was recorded. */
  readonly message: string
  /** Id of the template that produced the message — the "which template" surface. */
  readonly templateId: string
  /** Human label of that template, for display. */
  readonly templateLabel: string
  /** The Files recorded in this Commit. */
  readonly committedFiles: readonly string[]
  /**
   * Always `false` immediately after a Commit: a Commit records LOCALLY and does
   * not push (transport-not-commit, ADR 0006). The UI uses this to say "Committed
   * locally — Sync now to push". {@link DenService.syncPush} is what flips it.
   */
  readonly pushed: boolean
  /**
   * `true` when an Auto-sync push was attempted but **queued** because the machine is
   * offline (issue 1-16): the Commit is recorded locally and its push will retry on
   * reconnect / next Sync (ADR 0006). The UI shows the offline banner ("changes queued").
   * Always `false` under Manual (no auto-push attempted) and when the auto-push succeeded.
   */
  readonly queued: boolean
  /**
   * `true` when the Commit was a **legitimate no-op**: staging the chosen Files plus the
   * `.dotden/` metadata left the index byte-for-byte equal to HEAD, so there was nothing to
   * record (e.g. the Files were already Committed and the tree status was stale). A plain
   * `git commit` exits non-zero ("nothing to commit") here; we treat it as a clean no-op
   * instead of a failure (mirrors {@link GitTransport.commitIfChanged} — never fail loudly
   * on a legitimate no-op, never invent an empty commit). `committedFiles` is `[]` in this
   * case and no push is attempted; the UI says so honestly rather than surfacing an error.
   */
  readonly noop: boolean
}

/**
 * Result of a **restore-forward** ({@link DenService.restoreFileVersion}, issue 2-02).
 *
 * Restore-forward never rewrites history: it captures a past version's content forward
 * as a brand-new Commit, so the result reads like a {@link CommitResult} — the prior
 * current version stays reachable in the History list, nothing is destroyed. The UI's
 * confirm copy ("Saved as a new commit; your current version stays in history") describes
 * exactly this shape.
 */
export interface RestoreResult {
  /** The 7-char short SHA of the version that was restored forward (the previewed version). */
  readonly restoredShortSha: string
  /** Destination-relative File path that was restored (e.g. `.zshrc`). */
  readonly targetPath: string
  /**
   * `true` when the restore actually recorded a NEW Commit. `false` is a clean no-op:
   * the previewed version's content already equals the current source state (restoring the
   * Current version onto itself), so there is nothing to record — never invent an empty
   * commit, and never fail the action. The UI can say "already at this version".
   */
  readonly committed: boolean
}

/**
 * Result of a {@link DenService.syncPush} or {@link DenService.flushPushQueue} — whether the
 * push reached the Remote or was **queued offline** for retry (issue 1-16).
 *
 * `pushed` is `true` when the Remote now has the local Commits; `queued` is `true` when the
 * machine was offline and the push was recorded in the durable outbox to retry on the next
 * reconnect/Sync. Exactly one is `true` for a Sync that had something to send; a Sync with
 * nothing pending and nothing new to push reports both `false` (a clean no-op).
 */
export interface SyncPushResult {
  /** `true` when the push reached the Remote (the local Commits are now shared). */
  readonly pushed: boolean
  /** `true` when the push could not go out (offline) and was queued for retry. */
  readonly queued: boolean
}

/**
 * A request to convert a flagged value into a Secret reference (issue 2-05) — the user's picker
 * choice plus the target File. Notably it carries NO raw secret value (the value stays in the
 * vault); the {@link SecretReferenceRequest} fields name the manager + vault coordinates only.
 */
export interface ConvertSecretRequest extends SecretReferenceRequest {
  /** Destination-relative File path being converted (e.g. `.aws/credentials`). */
  readonly targetPath: string
  /**
   * Whether to remember this manager (+ account) as this environment's default for future
   * conversions (the "Remember my choice" toggle, acceptance criterion 5). Environment-local.
   */
  readonly remember?: boolean
}

/**
 * Result of {@link DenService.convertSecret} — the written `.tmpl` source path + the template that
 * now lives in the Den, so the UI can confirm the conversion (and a test can scan the bytes). The
 * `template` is the reference/template call, NEVER the raw secret.
 */
export interface ConvertSecretResult {
  /** The chezmoi source File the reference was written to (e.g. `…/dot_aws/credentials.tmpl`). */
  readonly sourceTemplatePath: string
  /** The expected source-relative template name ({@link sourceTemplateName}) for the UI/log. */
  readonly sourceTemplateName: string
  /** The rendered chezmoi template call now in source state (a reference, never the value). */
  readonly template: string
  /** The Commit result that recorded the reference into the Den (LOCAL until pushed, ADR 0006). */
  readonly commit: CommitResult
}

/**
 * The Commit tab's state (issue 2-09): the synced template the user edits plus everything its
 * **live preview** needs to render WITHOUT a shell. The renderer fetches this once, renders the
 * preview itself via the shared {@link renderCommitTemplate} (the same function the real message
 * uses), and re-renders as the user types — never round-tripping per keystroke.
 */
export interface CommitTemplateState {
  /** The synced commit-message template (e.g. `[$os-sync-$year-$month-$day]`). */
  readonly template: string
  /** chezmoi-sourced os/arch/hostname for the preview (cross-OS-safe; never a host shell). */
  readonly data: CommitTemplateData
  /** This environment's dotden label, for the preview's `$environment`. */
  readonly environment: string
}

/**
 * The Appearance tab's settings state (issue 2-17, ADR 0024) — the synced-vs-local split made
 * legible to the renderer in one read.
 *
 * Three pieces, so the tab can render the EFFECTIVE value AND show clearly what is shared vs. pinned:
 *
 * - **`effective`** — what this environment actually renders/uses: the synced defaults overlaid by
 *   this environment's local override ({@link resolveAppearanceSettings} — local field beats synced).
 *   This is what the tab binds its controls to.
 * - **`synced`** — the shared defaults from `.dotden/` (what a fresh environment inherits, what
 *   editing "for everyone" changes). Carried so the tab can show "synced default: X" next to a
 *   pinned field and offer "reset to the synced default".
 * - **`override`** — this environment's sparse LOCAL override (only the fields it pinned). Carried so
 *   the tab can mark which fields are currently overridden-here vs. inherited.
 *
 * The synced default is never mutated by reading or by pinning a local override (ADR 0024).
 */
export interface AppearanceState {
  /** The resolved settings this environment renders (synced overlaid by the local override). */
  readonly effective: AppearanceSettings
  /** The shared synced defaults from `.dotden/` (what a fresh environment inherits). */
  readonly synced: AppearanceSettings
  /** This environment's sparse local override (only the fields pinned here; `{}` = follow synced). */
  readonly override: AppearanceOverride
}

/**
 * The Remote-axis marker for an incoming File — the SECOND status axis (issue 1-09).
 *
 * This is the ↓/⚠ glyph the tree paints beside the local git-status letter:
 * `incoming` (↓) is a clean
 * incoming change this slice can Apply; `conflict` (⚠) is a File changed both here and
 * on the Remote, which the incoming-clean path never applies — it is handed to the
 * ConflictModel owner (issue 1-11). The marker type carries `conflict` now so the
 * decoration lane + Review surface are shaped for it, even though this slice only
 * produces `incoming`.
 */
export type RemoteAxisMarker = 'incoming' | 'conflict'

/** One incoming File shown to the user for a reviewed Apply (env B). */
export interface IncomingReviewItem {
  /** Destination-relative File path arriving from the Remote (e.g. `.zshrc`). */
  readonly targetPath: string
  /** Workspace the File belongs to, from the synced `.dotden/` placements. */
  readonly workspaceId: string
  /**
   * The Remote-axis marker for this File (issue 1-09). The incoming-clean path always
   * mints `incoming`; the `conflict` value exists so the Review surface + decoration
   * lane are ready for the ConflictModel slice (issue 1-11) without reshaping.
   */
  readonly marker: RemoteAxisMarker
  /**
   * What Apply will do to this File: `create`/`update` write it, `delete` removes it
   * (issue 1-10). Carried so the Review surface can render an incoming **deletion** as
   * its own first-class row (a removed-File treatment, not an addition).
   */
  readonly kind: ApplyChangeKind
  /**
   * `true` when applying this File needs **explicit confirmation** first (always true for
   * a `delete` — invariant #4, confirm incoming deletions). The Review surface must
   * collect the confirmation and pass the path in `apply`'s `confirmedDeletions`; the
   * value is the `ApplyPlanner`'s verdict, not re-derived here (ADR 0008).
   */
  readonly requiresConfirmation: boolean
}

/**
 * A summary of what is incoming from the Remote, for the top-level
 * "N incoming from `<environment>` — Review & Apply" entry (issue 1-09).
 *
 * It pairs the reviewable Files with the SOURCE environment's label so the entry can
 * name where the changes came from (e.g. "3 incoming from work-laptop"). The source is
 * derived from the synced registry: the environment(s) that are NOT this one. When the
 * registry has not recorded another environment yet, {@link fromEnvironmentLabel} is a
 * neutral fallback rather than a silent blank (never fail silently).
 */
export interface IncomingSummary {
  /** The reviewable incoming Files (each with its Remote-axis marker). */
  readonly items: readonly IncomingReviewItem[]
  /** Label of the environment the incoming changes came from, for the entry copy. */
  readonly fromEnvironmentLabel: string
}

/**
 * The per-File outcome of an Apply, recording that each File **applied independently**
 * (per-file atomicity, issue 1-09): one File's failure never blocks the others.
 *
 * `ok` means `chezmoi apply <file>` wrote the File; `error` means it was not written and
 * carries a human `reason` + a `retryable` flag so the Review surface can offer a retry
 * that re-runs ONLY the failures. A File refused by an `ApplyPlanner` invariant (a local
 * edit block, an unconfirmed deletion, or a witness-gate refusal) carries a `refusal`
 * tag so the surface can show the specific warning + fix, never silently skipping it.
 */
export interface ApplyFileResult {
  /** The destination-relative File path this outcome is for. */
  readonly targetPath: string
  /** Whether the File was written (`ok`) or its Apply did not happen (`error`). */
  readonly outcome: 'ok' | 'error'
  /** Human-readable failure reason when `outcome` is `error`; absent on success. */
  readonly reason?: string
  /**
   * Whether a failed File can be retried (re-run just this File). A per-file chezmoi
   * failure is retryable (the user can fix and re-run); a File the witness gate refused
   * is NOT retryable (it does not apply to this environment at all). A blocked local-edit
   * or unconfirmed deletion is retryable once the user resolves the cause (commits the
   * edit / confirms the deletion) and re-runs.
   */
  readonly retryable?: boolean
  /**
   * The `ApplyPlanner`-owned refusal that stopped this File, when one did — so the UI
   * shows the right warning/fix (invariant #2/#4/#3). Absent for a success or a plain
   * chezmoi error.
   */
  readonly refusal?: ApplyRefusal
}

/**
 * Result of applying reviewed incoming Files to disk (env B), with per-File atomicity.
 *
 * Each File is applied in its OWN `chezmoi apply <file>` invocation so one failure does
 * not block the rest (issue 1-09). {@link results} carries every File's outcome; the
 * convenience {@link applied}/{@link failed} splits are derived from it for the callers
 * that only need the path lists (e.g. the tree refresh after a successful Apply).
 */
export interface ApplyResult {
  /** Per-File outcome for every File the Apply attempted (the per-file-atomicity record). */
  readonly results: readonly ApplyFileResult[]
  /** The destination-relative File paths that applied successfully. */
  readonly applied: readonly string[]
  /** The Files that failed, each with its reason + retryable flag (for the retry UI). */
  readonly failed: readonly ApplyFileResult[]
}

/**
 * The outcome of one **Auto-apply** Sync (issue 2-12) — what landed without the user, and
 * what was held back for manual review.
 *
 * Auto-apply NEVER suppresses what still needs a human (never fail silently): a clean
 * incoming change applies on its own, but Conflicts, an uncommitted-edit-guard hit, and
 * incoming deletions are reported in `needsReview` so the in-app Incoming banner still
 * surfaces them for the normal reviewed Apply (issue 1-09). At Manual/Auto-sync the policy
 * auto-applies nothing, so `autoApplied` is empty and EVERY incoming File is in
 * `needsReview` — the manual contract, unchanged.
 */
export interface AutoApplyResult {
  /**
   * Whether this environment's automation level even permits auto-applying. `false` at
   * Manual/Auto-sync — the caller then knows nothing was auto-applied by design (not by
   * an error), so it can fall straight back to the reviewed-Apply surface.
   */
  readonly autoApplyEnabled: boolean
  /** The per-File outcomes of the Files Auto-apply actually wrote (the apply record). */
  readonly applied: ApplyResult
  /**
   * The incoming Files held back for the user, with the owner verdict that held each (a
   * Conflict, a non-applicable File, an uncommitted-edit block, an incoming deletion, or a
   * clean item the level kept manual). These STILL surface for review — never dropped.
   */
  readonly needsReview: readonly { targetPath: string; reason: AutoApplyHoldReason }[]
}

/**
 * The outcome of one **YOLO hands-off Sync** (issue 2-13) — the full ladder's top rung.
 *
 * It records the THREE phases in their safety-critical order so the caller (and a test) can
 * see exactly what the hands-off pass did:
 * 1. {@link autoCommit} — the local edits YOLO Committed **before** any merge, so in-progress
 *    work survives as Commits (never-lose-data invariant #2, realized as an action). Empty
 *    when there was no local drift; `enabled:false` at any rung below YOLO.
 * 2. {@link conflicts} — the true overlapping Conflicts the post-Commit merge surfaced. These
 *    are NEVER auto-resolved (invariant #1, `ConflictModel`): YOLO leaves them for the user's
 *    explicit Keep mine / Take theirs / Open both, exactly as every rung does.
 * 3. {@link autoApplied} — the clean incoming changes YOLO then applied without review, with
 *    everything still requiring a human in its `needsReview` (deletions, uncommitted-edit
 *    guard, non-applicable Files) — never suppressed (never fail silently).
 *
 * So even the most hands-off rung composes the SAME four owners: it removes the review
 * *prompts* for clean changes, never the safety *owners*.
 */
export interface YoloSyncResult {
  /** Whether YOLO's pre-merge auto-Commit ran (true only at the YOLO rung). */
  readonly autoCommitEnabled: boolean
  /**
   * What the pre-merge auto-Commit recorded: the local-edit paths Committed (applicable here)
   * and any out-of-subscription edits deliberately left alone (invariant #3). The Commit's own
   * `pushed` is always `false` here — the push is DEFERRED until after a clean merge and is
   * reported separately in {@link push} (a pre-merge push would be a non-fast-forward rejection).
   */
  readonly autoCommit: {
    readonly committedPaths: readonly string[]
    readonly skipped: readonly { targetPath: string; reason: 'not-applicable' }[]
    readonly commit: CommitResult | null
  }
  /**
   * The result of the post-merge push (the merged history → Remote). `null` when there was
   * nothing to push or the merge left unresolved Conflicts (the half-merged tree is not pushed
   * until the user resolves). Mirrors {@link SyncPushResult}: `pushed` reached the Remote,
   * `queued` was held offline for retry — never lost.
   */
  readonly push: SyncPushResult | null
  /**
   * The true Conflicts the merge surfaced — handed to the user's resolver, NEVER auto-resolved
   * (invariant #1). Empty when git auto-merged everything (or nothing was incoming).
   */
  readonly conflicts: readonly ConflictReviewItem[]
  /** `true` when the merge auto-merged with no overlapping Conflict left to resolve. */
  readonly autoMerged: boolean
  /** The clean incoming changes auto-applied + what was held for review (mirrors {@link AutoApplyResult}). */
  readonly autoApplied: AutoApplyResult
}

/** Renderer action requested after the background poller ran automation for an incoming move. */
export type TrayPollerAutomationAction = 'refresh' | 'review' | 'resolve'

/**
 * One environment a destructive verb would touch — the blast-radius surface the
 * **Delete everywhere** confirm must enumerate before the user proceeds (issue 1-08).
 *
 * A File "affects" an environment when that environment subscribes to the File's
 * Workspace (its access boundary, ADR 0005). The label is what the confirm names so
 * the user sees plainly *which* environments lose the real path (`this-mac`,
 * `work-laptop`, …); `isSelf` marks the one the user is sitting at.
 */
export interface AffectedEnvironment {
  /** Stable environment id (identity, never the hostname — ADR 0024). */
  readonly id: string
  /** User-facing label shown in the confirm (e.g. `this-mac`). */
  readonly label: string
  /** Whether this is the environment the user is acting from. */
  readonly isSelf: boolean
}

/** One Workspace this environment can subscribe to, for the returning-flow pick (issue 1-13). */
export interface SubscribableWorkspace {
  /** Stable Workspace id (the subscription key, ADR 0005). */
  readonly id: string
  /** User-facing Workspace label (e.g. "Personal", "Work"). */
  readonly label: string
  /** Whether THIS environment currently subscribes to it (drives the checklist's checked state). */
  readonly subscribed: boolean
}

/**
 * This environment's **subscription state** — what the returning-flow pick + the
 * never-silent unregistered-env guard read (issue 1-13, ADR 0005 / ADR 0024).
 *
 * It answers three questions in one read: which Workspaces exist (and which this env is
 * subscribed to), whether this environment has a registry entry yet, and — when it does NOT
 * (or subscribes to nothing) — the human reason + fix to surface, so an unregistered env that
 * would materialize an EMPTY Den never renders a confusing blank quietly (the template's
 * ignore-everything fail-safe is paired with this honest explanation).
 */
export interface SubscriptionState {
  /** Every Workspace in the Den, each flagged with whether this environment subscribes. */
  readonly workspaces: readonly SubscribableWorkspace[]
  /**
   * `true` when this environment has a registry entry recorded (so the templated
   * `.chezmoiignore` resolves a subscription rather than hitting the fail-safe). A fresh clone
   * before claim/registration is `false`.
   */
  readonly registered: boolean
  /**
   * A human warning to surface when this environment would materialize an EMPTY Den — it has no
   * registry entry yet, or its subscription is empty (the `.chezmoiignore` fail-safe ignored
   * everything). `null` when the Den will materialize normally. NEVER let this be silent: the
   * returning flow shows it with the fix ("this environment isn't registered yet — finish setup
   * to choose your Workspaces").
   */
  readonly emptyDenWarning: string | null
}

/**
 * One File in **Conflict** the user must resolve, with the three sides for the merge view
 * (issue 1-11). The cross-environment axis: two environments Committed the same File so
 * their source-state histories diverged in a way `git merge` could not auto-merge.
 *
 * The sides come straight from git (ours/theirs index stages + the marker-bearing working
 * copy) and feed the renderer's `@pierre/diffs` current/incoming/both merge view. The
 * renderer NEVER constructs resolved bytes from these — it sends the user's choice back
 * through {@link DenService.resolveConflictFile}, which is the only path that mints the
 * un-forgeable resolution (ADR 0008 invariant #1, owned by `ConflictModel`).
 */
export interface ConflictReviewItem {
  /** Destination-relative File path in Conflict (e.g. `.zshrc`). */
  readonly targetPath: string
  /** Workspace the File belongs to, from the synced `.dotden/` placements. */
  readonly workspaceId: string
  /** **Keep mine** bytes — what this environment Committed (git ours/HEAD). */
  readonly current: string
  /** **Take theirs** bytes — what the Remote Committed (git theirs). */
  readonly incoming: string
  /** **Open both** bytes — the `<<<<<<<`-marked union, for conscious hand-editing. */
  readonly both: string
}

/**
 * The result of fetching + merging the Remote to surface Conflicts for resolution (issue
 * 1-11). git **auto-merges non-overlapping hunks** during the merge, so {@link conflicts}
 * is ONLY the set of true Conflicts — the user is never asked about non-conflicts.
 * {@link autoMerged} reports whether the merge completed with nothing left to resolve.
 */
export interface ConflictReview {
  /** The Files git could not auto-merge — each needing an explicit user resolution. */
  readonly conflicts: readonly ConflictReviewItem[]
  /**
   * `true` when `git merge` completed with no overlapping conflicts (everything
   * auto-merged, or nothing was incoming). When `true`, {@link conflicts} is empty and
   * there is nothing for the user to resolve.
   */
  readonly autoMerged: boolean
}

/**
 * One managed File in the three-pane tree view (issue 1-07), carrying everything the
 * renderer needs to place, decorate, and inspect the row WITHOUT a second round-trip:
 * its path, Workspace placement, local-axis git status, and whether it is muted.
 */
export interface FileTreeEntry {
  /** Destination-relative File path (e.g. `.zshrc`) — the stable File row id. */
  readonly targetPath: string
  /** The Workspace this File belongs to, from the synced `.dotden/` placements. */
  readonly workspaceId: string
  /**
   * The Group within {@link FileTreeEntry.workspaceId} this File is filed under, or
   * `null` when it sits directly under the Workspace root (issue 1-14). Pure
   * organization — it never affects access or the File's `targetPath`.
   */
  readonly groupId: string | null
  /**
   * The File's local-axis git status (M/A/D/R/U → modified/added/deleted/…), or `null`
   * when chezmoi reports no change for it. The renderer maps these onto the coloured
   * status letter shown beside each File row.
   */
  readonly status: FileGitStatus['status'] | null
  /**
   * `true` when this File is scoped out of THIS environment's OS and therefore
   * ignored by chezmoi here (it appears in `chezmoi ignored`). The renderer renders
   * the row **muted/ignored** (issue 1-07 owns the muted rendering; the OS-Scope rule
   * that produces it is issue 1-15). This is the FAITHFUL signal — it comes from
   * `chezmoi ignored` over the generated `.chezmoiignore`, not from re-deriving Scope.
   */
  readonly muted: boolean
  /**
   * The File's **effective OS Scope** after inheritance + narrowing (issue 1-15): the OSes
   * it applies on, or `null` for the universal Scope ("applies everywhere"). Carried so the
   * inspector can render the Scope chips and the Scope editor can show the current value
   * without a second round-trip. Distinct from {@link muted}: `muted` is "ignored on THIS
   * OS right now"; `scope` is the full applicability set across OSes.
   */
  readonly scope: Scope
}

/**
 * The whole local Workspace view for the three-pane tree (issue 1-07): the managed
 * Files (placed, decorated, muted-or-not) plus the Workspaces they live in. Computed
 * in one IPC call so the tree, the git-status axis, and the change dots all derive
 * from a single consistent snapshot.
 */
export interface FileTreeView {
  /** Every managed File, with its placement + local status + muted flag. */
  readonly files: readonly FileTreeEntry[]
  /** The Workspaces in the Den (so the tree can group/section by Workspace). */
  readonly workspaces: WorkspacesDoc['workspaces']
}

/**
 * Why an Apply did not write a File, beyond a raw chezmoi error — the
 * `ApplyPlanner`-owned refusals surfaced so the Review surface shows the right warning
 * and fix (never fail silently, ADR 0008 invariants #2 & #4).
 *
 * - `blocked-uncommitted-edit` — the File has uncommitted local edits here; applying
 *   would silently overwrite in-progress work (invariant #2). The fix is to Commit or
 *   discard the local edit first. This is also the apply-time atomic re-check verdict
 *   from {@link import('./chezmoi-adapter.js').UncommittedLocalEditError}.
 * - `needs-confirmation` — the File is an incoming **deletion** the user has not yet
 *   confirmed (invariant #4); deletions are never applied without explicit confirmation.
 * - `not-applicable` — the File turned non-applicable between review and apply (the
 *   witness gate refused it; invariant #3).
 * - `secret-reference-unresolved` — the File contains a {@link import('./secret-reference.js')}
 *   Secret reference whose password-manager CLI is locked/signed-out, or whose referenced
 *   item/field is missing (issue 2-05, acceptance criterion 9). NOT an invariant refusal — it is a
 *   provider-agnostic vault failure surfaced cleanly so the user unlocks/signs in or fixes the
 *   reference, then re-applies (retryable). Distinct so the apply-error surface can point at the
 *   vault rather than blame chezmoi.
 */
export type ApplyRefusal =
  | 'blocked-uncommitted-edit'
  | 'needs-confirmation'
  | 'not-applicable'
  | 'secret-reference-unresolved'

/**
 * Why a routed incoming item still needs the **user** rather than auto-applying — the
 * verdict that kept it off the auto-apply path (issue 2-12). Every value here is *read*
 * from an invariant owner; `SyncEngine` never re-derives it (ADR 0008):
 *
 * - `conflict` — a true Conflict, deferred before the planner. NEVER auto-resolved
 *   (invariant #1, `ConflictModel`'s job).
 * - `not-applicable` — outside this environment's subscription/Scope; no witness was
 *   minted (invariant #3, `ApplicabilityResolver`).
 * - `uncommitted-edit` — the File has uncommitted local edits here; auto-applying would
 *   silently overwrite in-progress work (invariant #2, `ApplyPlanner`'s edit guard).
 * - `needs-confirmation` — an incoming deletion; never applied without an explicit
 *   confirmation (invariant #4, `ApplyPlanner`).
 * - `clean` — a ready, applicable, non-deletion item the policy still did NOT auto-apply
 *   because the current LEVEL leaves Apply manual (Manual / Auto-sync). It is held purely
 *   by the level gate, not by a safety owner — so it surfaces for ordinary review.
 */
export type AutoApplyHoldReason =
  | 'conflict'
  | 'not-applicable'
  | 'uncommitted-edit'
  | 'needs-confirmation'
  | 'clean'

/** One File's local status, parsed from chezmoi and rendered as M/A/D/R/U in the tree. */
export interface FileGitStatus {
  /** Destination-relative File path (e.g. `.zshrc`), matching the tree's path id. */
  readonly path: string
  /** The local-axis status letter chezmoi reports for this File. */
  readonly status: FileGitStatusCode
}

/**
 * The local-axis git-status vocabulary used by the renderer and main process without pulling
 * UI dependencies into foundation code (ADR 0023 keeps the foundation Electron- and UI-free).
 */
export type FileGitStatusCode =
  | 'added'
  | 'deleted'
  | 'ignored'
  | 'modified'
  | 'renamed'
  | 'untracked'
