/**
 * AutomationPolicy — the risk-graded automation ladder, gating levels by **depending
 * on** the invariant-owner types, never by re-checking them (ADR 0008, issue 1-12).
 *
 * dotden's automation is a ladder of rungs from fully-manual to fully-hands-off. ADR
 * 0008's central discipline is that the four safety invariants each have ONE type-level
 * owner, and `AutomationPolicy` "gates the levels by **depending on** these types; it
 * never duplicates the gate." This module is the faithful realization of that sentence:
 *
 * - it decides, per automation level, whether the engine may **auto-push a Commit** and
 *   whether it may **auto-apply incoming changes** — the only two things automation
 *   changes in the MVP;
 * - it can ONLY express "apply this automatically" by being handed the SAME owner
 *   outputs a manual Apply consumes — an {@link AppliesHere} witness (invariant #3) and
 *   an {@link ApplyPlanItem} whose `blockedReason`/`requiresConfirmation` verdicts it
 *   reads but never overrides (invariants #2 & #4). So an unsafe auto-apply is
 *   *unrepresentable*, exactly as for a manual Apply — the policy gates the LEVEL, the
 *   owners gate the SAFETY.
 *
 * **Selectable scope (through issue 2-13):** **Manual** (default), **Auto-sync**,
 * **Auto-apply**, and **YOLO** are all selectable rungs. At Manual/Auto-sync
 * `mayAutoApply()` is always `false`, so **Apply stays a manual review** (the Auto-sync
 * contract, CONTEXT.md); at **Auto-apply** a *clean, ready, witness-backed* item
 * auto-applies while Conflicts, the uncommitted-edit guard, and incoming deletions still
 * require the user (issue 2-12); at **YOLO** the policy *additionally* permits
 * auto-Committing local edits **before** a merge — {@link mayAutoCommitBeforeMerge} —
 * which is the ONE place "Commit becomes automatic" is allowed (issue 2-13).
 *
 * **Why a YOLO-only auto-Commit decision is still faithful to transport-not-commit (ADR
 * 0006).** Every lower rung exposes NO auto-Commit decision, because nothing syncs that
 * you didn't Commit, and auto-push only ever moves an *already-Committed* change. YOLO is
 * the deliberate, strongly-warned exception: the auto-Commit happens **before** any merge
 * so a hands-off environment's local edits **survive as Commits** rather than being lost
 * to (or silently overwritten by) the incoming merge — it is the never-lose-data
 * invariant (#2) realized as an *action*, not a relaxation of it. Even at YOLO this only
 * ever Commits + then transports + then auto-applies *clean* changes; a true overlapping
 * **Conflict is still never auto-resolved** ({@link ConflictModel} owns invariant #1), and
 * the deletion/subscription/uncommitted-edit guards still hold exactly as at every rung —
 * YOLO removes the *review prompts*, never the *safety owners*.
 */
import type { AppliesHere } from '../environments/applicability-resolver.js'
import type { ApplyPlanItem } from './apply-planner.js'
import type { AutomationLevel } from '../../../shared/apply.js'

/**
 * The levels the app actually exposes for selection (through issue 2-13): **Manual,
 * Auto-sync, Auto-apply, YOLO** — the full risk-graded ladder.
 *
 * A settings UI iterates THIS list, so it can never offer a level whose behavior is not
 * built (never fail silently). `yolo` is now included because its full hands-off
 * auto-Commit-before-merge path ships in issue 2-13 — but it is presented **strongly
 * warned** and is, like every rung, OFF until the user explicitly turns it on.
 */
export const SELECTABLE_AUTOMATION_LEVELS: readonly AutomationLevel[] = [
  'manual',
  'auto-sync',
  'auto-apply',
  'yolo',
]

/**
 * The default automation level for a fresh environment: **Manual**.
 *
 * Automation is opt-in (the onboarding Auto-sync step, issue 1-06/1-12). Until the user
 * chooses otherwise, nothing is automatic — the safest possible default.
 */
export const DEFAULT_AUTOMATION_LEVEL: AutomationLevel = 'manual'

/**
 * True when `value` is one of the **selectable** rungs (Manual / Auto-sync / Auto-apply /
 * YOLO) — the full ladder as of issue 2-13.
 *
 * The persistence layer ({@link import('./automation-settings.js')}) gates reads + writes
 * through this so a corrupt/forward-incompatible file (or an unknown future rung) can never
 * silently enable an unbuilt level — it falls back to the safe Manual default instead.
 */
export function isSelectableAutomationLevel(value: unknown): value is AutomationLevel {
  return value === 'manual' || value === 'auto-sync' || value === 'auto-apply' || value === 'yolo'
}

/**
 * A candidate auto-apply, expressed ONLY through the invariant owners' outputs.
 *
 * The policy cannot decide "is this safe to apply?" — that is the owners' job. So to even
 * *ask* the policy whether a level permits auto-applying an item, the caller must already
 * hold:
 * - the {@link AppliesHere} witness (invariant #3 — only {@link ApplicabilityResolver}
 *   mints it; the policy consumes it, proving the File is in subscription); and
 * - the {@link ApplyPlanItem} the {@link ApplyPlanner} produced, carrying its
 *   `blockedReason` (invariant #2) and `requiresConfirmation` (invariant #4) verdicts.
 *
 * Because the only way to construct this is from real owner outputs, "auto-apply a
 * non-applicable / blocked / unconfirmed File" is not a check the policy might forget —
 * it is a state the type system + the owners' verdicts make unrepresentable (ADR 0008).
 */
export interface AutoApplyCandidate {
  /** Un-forgeable proof the File applies here (invariant #3). The policy never re-derives this. */
  readonly witness: AppliesHere
  /** The planner's reviewed item, carrying the invariant #2/#4 verdicts the policy reads, never sets. */
  readonly item: ApplyPlanItem
}

/**
 * Gates the automation ladder's rungs by depending on the invariant-owner types.
 *
 * Construct one with the environment's current {@link AutomationLevel}. It exposes the
 * two decisions automation changes — `mayAutoPush()` and `mayAutoApply()` — and a couple
 * of small predicates the UI/engine read. It holds NO I/O and NO invariant logic of its
 * own; it only *reads* the level and the owners' verdicts. That is the whole point: the
 * gate it implements is "which rung is the user on", layered on top of (never instead of)
 * the safety the owners already guarantee.
 */
export class AutomationPolicy {
  /**
   * @param level The environment's selected automation rung (defaults to Manual — the
   *   safest, fully-manual rung — so an unset level is never accidentally automatic).
   */
  constructor(private readonly level: AutomationLevel = DEFAULT_AUTOMATION_LEVEL) {}

  /** The automation level this policy gates (for display + the wide event's `automationLevel`). */
  get automationLevel(): AutomationLevel {
    return this.level
  }

  /**
   * Whether a just-recorded Commit may be **pushed automatically** at this level.
   *
   * `true` only at `auto-sync` and above (`auto-apply`/`yolo` are strictly more
   * automated, so they also push). `manual` ⇒ `false`: the user pushes with **Sync now**.
   *
   * It is faithful to transport-not-commit (ADR 0006): it moves a change that already
   * exists as a Commit — it never decides *what* to Commit. At every rung BELOW `yolo`,
   * the Commit it transports was authored by the user; only `yolo` additionally permits
   * the engine to *create* that Commit on the user's behalf, via the separate, explicit
   * {@link mayAutoCommitBeforeMerge} decision (the one strongly-warned exception).
   *
   * @returns Whether the engine should `git push` after a Commit without the user asking.
   */
  mayAutoPush(): boolean {
    return this.level !== 'manual'
  }

  /**
   * Whether this level may **auto-Commit local edits BEFORE a merge** — the YOLO-only
   * hands-off Commit decision (issue 2-13, ADR 0006 "YOLO mode").
   *
   * `true` ONLY at `yolo`; `false` at every other rung (Manual / Auto-sync / Auto-apply),
   * which all leave **Commit** a deliberate user action (transport-not-commit, ADR 0006).
   * YOLO is the sole, strongly-warned exception: a fully hands-off environment cannot stop
   * to ask the user to Commit before pulling, so the engine records the local edits as a
   * Commit itself.
   *
   * The ordering is the safety: the Commit is taken **before** the merge so the local edits
   * become part of history *first* — the incoming merge then merges against them (or
   * surfaces a true Conflict for the resolver) instead of silently overwriting in-progress
   * work. This realizes the never-lose-data invariant (#2) as an action; it does NOT relax
   * any owner. In particular it is NOT a license to auto-resolve: if the post-Commit merge
   * overlaps, `ConflictModel` still owns invariant #1 and the Conflict is never picked for
   * the user. (Like `mayAutoPush`, this is a pure LEVEL predicate — the engine performs the
   * Commit; the policy only says whether this rung is allowed to.)
   *
   * @returns Whether the engine should auto-Commit local edits before merging at this level.
   */
  mayAutoCommitBeforeMerge(): boolean {
    return this.level === 'yolo'
  }

  /**
   * Whether this LEVEL auto-applies clean incoming changes at all (issue 2-12) — the
   * level-only predicate, taking no candidate.
   *
   * `true` at `auto-apply` and above (`yolo`); `false` at `manual`/`auto-sync`, where Apply
   * stays a manual review. Callers use it to decide whether to run the Auto-apply path or
   * fall straight back to the reviewed-Apply surface, WITHOUT needing a candidate in hand.
   * It is purely the level gate — the per-item safety still flows through {@link mayAutoApply}.
   *
   * @returns Whether the current rung auto-applies clean incoming changes.
   */
  autoAppliesIncoming(): boolean {
    return this.level === 'auto-apply' || this.level === 'yolo'
  }

  /**
   * Whether incoming change(s) may be **applied automatically** at this level.
   *
   * **Manual / Auto-sync: always `false`.** Both leave Apply a manual review (CONTEXT.md
   * "Auto-sync": Apply stays a manual review), so at those rungs this is `false`. The
   * richer auto-apply path (clean changes apply without review; Conflicts/risky changes
   * still ask) is `auto-apply` (issue 2-12) and `yolo` (issue 2-13).
   *
   * Crucially, the gate is BY-CONSTRUCTION: it can only return `true` for a candidate
   * whose owner verdicts already clear it — never blocked (invariant #2), never an
   * unconfirmed deletion (invariant #4), always witness-backed (invariant #3). The policy
   * reads those verdicts; it does not re-decide them. (A `conflict` never even produces a
   * candidate — `SyncEngine` defers it before the planner, invariant #1 — so there is
   * nothing here to re-check for Conflicts either.)
   *
   * @param candidate The reviewed item to auto-apply, expressed via owner outputs.
   * @returns Whether this level permits auto-applying THIS candidate without review.
   */
  mayAutoApply(candidate: AutoApplyCandidate): boolean {
    // Manual/Auto-sync never auto-apply — short-circuit so the safety reasoning below is
    // only exercised by the auto-applying rungs (Auto-apply 2-12 / YOLO 2-13).
    if (this.level === 'manual' || this.level === 'auto-sync') return false
    // Auto-apply/YOLO: even then, defer entirely to the planner's verdicts. A blocked item
    // (invariant #2) or an item that still needs confirmation — every deletion does
    // (invariant #4) — is NEVER auto-applied. We consume the owner's verdict; we do not
    // re-derive it (ADR 0008). The witness presence is the structural proof of invariant #3
    // — holding the candidate at all means the resolver minted it.
    return candidate.item.blockedReason === null && !candidate.item.requiresConfirmation
  }

  /**
   * Whether this level should **notify** the user about incoming cross-environment
   * changes (rather than silently apply or ignore them).
   *
   * `true` for `manual` and `auto-sync`: at both, incoming changes wait for the user, so
   * they must be surfaced (the TrayPoller's OS notification + the in-app Incoming banner).
   * Higher rungs that auto-apply (2-12) lean on the notification less, but the MVP's two
   * rungs both notify — incoming is never landed without the user seeing it first.
   *
   * @returns Whether incoming changes should raise a user-facing notification.
   */
  shouldNotifyIncoming(): boolean {
    return this.level === 'manual' || this.level === 'auto-sync'
  }
}
