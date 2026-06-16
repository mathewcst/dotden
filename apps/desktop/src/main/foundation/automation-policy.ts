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
 * **Selectable scope (through issue 2-12):** **Manual** (default), **Auto-sync**, and
 * **Auto-apply** are selectable rungs. `YOLO` is named in the level type so the ladder's
 * shape is fixed, but its full hands-off behavior (auto-Commit-before-merge) is **deferred**
 * (issue 2-13). At Manual/Auto-sync `mayAutoApply()` is always `false`, so **Apply stays a
 * manual review** (the Auto-sync contract, CONTEXT.md); at **Auto-apply** a *clean, ready,
 * witness-backed* item auto-applies while Conflicts, the uncommitted-edit guard, and
 * incoming deletions still require the user (issue 2-12). **Commit is never automatic at
 * any selectable level** — the policy exposes no "auto-commit" decision at all, because
 * nothing syncs that you didn't Commit (transport-not-commit, ADR 0006); even the auto-push
 * decision only ever moves an *already-Committed* change.
 */
import type { AppliesHere } from './applicability-resolver.js'
import type { ApplyPlanItem } from './apply-planner.js'

/**
 * The rungs of dotden's automation ladder (CONTEXT.md).
 *
 * - `manual` — the default. Nothing happens without the user: Commits are pushed by an
 *   explicit **Sync now**, incoming changes wait for review.
 * - `auto-sync` — low-risk, environment-local: Committed changes **push automatically**
 *   and incoming changes **notify**, but **Apply stays manual** (CONTEXT.md "Auto-sync").
 * - `auto-apply` — clean incoming changes apply without review (Conflicts/risky changes
 *   still ask). **Selectable as of issue 2-12** (Warned in the ladder UI).
 * - `yolo` — full hands-off (auto-Commit, Sync, Apply except Conflicts). Its auto-apply
 *   verdict already routes through {@link mayAutoApply} like Auto-apply, but its
 *   auto-Commit-before-merge path is **deferred to issue 2-13**; not selectable yet. Even
 *   YOLO can never auto-resolve a Conflict — that is `ConflictModel`'s job, not the
 *   policy's (invariant #1).
 */
export type AutomationLevel = 'manual' | 'auto-sync' | 'auto-apply' | 'yolo'

/**
 * The levels the app actually exposes for selection (through issue 2-12): **Manual,
 * Auto-sync, Auto-apply**.
 *
 * `yolo` exists in {@link AutomationLevel} to fix the ladder's shape but is not selectable
 * yet (its auto-Commit-before-merge path is issue 2-13). A settings UI iterates THIS list,
 * so it can never offer a level whose behavior is not built (never fail silently).
 */
export const SELECTABLE_AUTOMATION_LEVELS: readonly AutomationLevel[] = [
  'manual',
  'auto-sync',
  'auto-apply',
]

/**
 * The default automation level for a fresh environment: **Manual**.
 *
 * Automation is opt-in (the onboarding Auto-sync step, issue 1-06/1-12). Until the user
 * chooses otherwise, nothing is automatic — the safest possible default.
 */
export const DEFAULT_AUTOMATION_LEVEL: AutomationLevel = 'manual'

/**
 * True when `value` is one of the **selectable** rungs (Manual / Auto-sync / Auto-apply).
 *
 * The persistence layer ({@link import('./automation-settings.js')}) gates reads + writes
 * through this so a corrupt/forward-incompatible file (or a future `yolo`) can never
 * silently enable an unbuilt rung — it falls back to the safe Manual default instead.
 */
export function isSelectableAutomationLevel(value: unknown): value is AutomationLevel {
  return value === 'manual' || value === 'auto-sync' || value === 'auto-apply'
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
   * This is the ONLY automatic transport the MVP performs, and it is faithful to
   * transport-not-commit (ADR 0006): it moves a change the user ALREADY Committed — it
   * never decides *what* to Commit. **Commit is never automatic at any level**, which is
   * why this class exposes no "auto-commit" decision: there is nothing for it to gate.
   *
   * @returns Whether the engine should `git push` after a Commit without the user asking.
   */
  mayAutoPush(): boolean {
    return this.level !== 'manual'
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
