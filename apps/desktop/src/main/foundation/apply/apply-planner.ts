/**
 * ApplyPlanner — builds the plan of what Apply will write, and the SOLE owner of two
 * of ADR 0008's safety invariants (ADR 0008).
 *
 * **Apply** is the "make this real here" verb: write source/target state onto an
 * environment's real Files (CONTEXT.md "Apply"). Before writing, dotden computes a
 * reviewable *plan*. `ApplyPlanner` owns the two invariants that make that plan safe,
 * and every other module (`SyncEngine`, the Apply-review surface, `ChezmoiAdapter`'s
 * caller) **consumes the planner's output without re-checking** (review discipline,
 * ADR 0008 §Consequences):
 *
 * - **Invariant #2 — never lose data silently (uncommitted-edit guard).** An Apply to
 *   a File that has **uncommitted local edits** would silently overwrite in-progress
 *   work on *this* environment. The planner marks such a File's plan item
 *   `blocked-uncommitted-edit` so it is surfaced, not written. This is the **local-drift
 *   axis** — a managed File hand-edited on disk, *outside* dotden — distinct from the
 *   cross-environment Conflict ([issue 1-11]) which is a pure `git merge`. The block is
 *   the precondition; its **authoritative atomic re-check lives in `ChezmoiAdapter`'s
 *   write path** ({@link import('./chezmoi-adapter.js').ChezmoiAdapter.applyGuarded}),
 *   so there is no plan-time-snapshot → apply-time-write TOCTOU (ADR 0008 #2 mechanism).
 *
 * - **Invariant #4 — confirm incoming deletions.** An incoming change that *removes* a
 *   File is a first-class plan item (`kind: 'delete'`) that is **never applied without
 *   explicit confirmation**. The planner emits it `requiresConfirmation: true` and the
 *   Apply surface must collect that confirmation before the deletion is written; the
 *   planner never silently drops or silently applies a deletion.
 *
 * It still consumes invariant #3 (act only within subscription): every plan item is
 * keyed by an {@link AppliesHere} witness it is *handed* — the planner cannot mint one
 * (the brand is private to {@link ApplicabilityResolver}), so "plan an Apply for a
 * non-applicable File" is a compile-time impossibility, not a runtime check the planner
 * might forget. Invariant #1 (never auto-resolve a Conflict) is owned by `ConflictModel`;
 * conflicting Files simply never reach the planner.
 */
import type { AppliesHere } from '../environments/applicability-resolver.js'

/**
 * The kind of change an Apply plan item represents.
 *
 * - `create` — a File present on the Remote but absent locally (incoming-clean).
 * - `update` — a File present on both that the Remote changed (the planner shape is
 *   ready for it; the incoming-update diff path is the Review & Apply slice, 1-09).
 * - `delete` — a File the Remote removed; per invariant #4 it is always
 *   `requiresConfirmation: true` and never written without explicit user confirmation.
 */
export type ApplyChangeKind = 'create' | 'update' | 'delete'

/**
 * Why a plan item is **blocked** from being applied, or `null` when it is ready.
 *
 * - `uncommitted-edit` — the File has uncommitted local edits on THIS environment, so
 *   applying it would silently overwrite in-progress work (invariant #2). The block is
 *   surfaced in the Review surface as a warning with the fix ("Commit or discard your
 *   local edits first, then Apply"), never auto-resolved.
 */
export type ApplyBlockReason = 'uncommitted-edit'

/**
 * One reviewable item in an Apply plan.
 *
 * It carries the {@link AppliesHere} witness for its File so that the act of applying it
 * is, by construction, scoped to a File this environment subscribes to (invariant #3).
 * Downstream code that writes the File reads `witness.targetPath`, never a raw path the
 * planner invented. `blockedReason` and `requiresConfirmation` carry invariants #2 and
 * #4 to the caller so the caller acts on the planner's verdict, never re-deriving it.
 */
export interface ApplyPlanItem {
  /** Un-forgeable proof this File applies to this environment (invariant #3, ADR 0008). */
  readonly witness: AppliesHere
  /** The change Apply will perform for this File. */
  readonly kind: ApplyChangeKind
  /**
   * Non-null when this item is **blocked** and must NOT be applied (invariant #2). The
   * caller surfaces the reason instead of writing the File; the value tells it which
   * warning + fix to show. `null` means the item is ready to apply (subject to
   * {@link requiresConfirmation}).
   */
  readonly blockedReason: ApplyBlockReason | null
  /**
   * `true` when applying this item needs **explicit user confirmation** before it is
   * written — always `true` for a `delete` (invariant #4: confirm incoming deletions),
   * `false` otherwise. The Apply surface must collect the confirmation; the planner
   * never assumes it.
   */
  readonly requiresConfirmation: boolean
}

/**
 * A complete Apply plan: the set of items the user reviews before applying.
 *
 * The split helpers ({@link ready}, {@link blocked}, {@link deletions}) are derived for
 * callers that only need a slice, so no caller re-computes "which items are blocked?" or
 * "which need confirmation?" — that classification lives only here (ADR 0008).
 */
export interface ApplyPlan {
  /** Every reviewable change, each gated by an {@link AppliesHere} witness. */
  readonly items: readonly ApplyPlanItem[]
}

/**
 * The local-status facts the planner needs to enforce invariant #2.
 *
 * It is the set of destination-relative paths that have **uncommitted local edits** on
 * THIS environment — the **local-drift axis**, derived from `chezmoi status` column X
 * (the last-written-vs-actual column; see {@link import('./chezmoi-status.js').parseChezmoiStatus}).
 * The planner takes the *facts*, not the I/O, so it stays a pure, exhaustively
 * property-testable function (the live re-check at write time is `ChezmoiAdapter`'s job).
 */
export interface LocalEditState {
  /**
   * Destination-relative paths with uncommitted local edits here (modified/added/
   * deleted in column X). Any incoming Apply for one of these is blocked (invariant #2).
   */
  readonly uncommittedEdits: ReadonlySet<string>
}

/**
 * One incoming change to plan, paired with its applicability witness.
 *
 * The caller (SyncEngine) proves applicability by handing over the {@link AppliesHere}
 * witness, and states the {@link ApplyChangeKind}. The planner never invents a path or a
 * kind — it only classifies what it is handed.
 */
export interface IncomingChange {
  /** Un-forgeable proof this File applies here (only {@link ApplicabilityResolver} mints it). */
  readonly witness: AppliesHere
  /** Whether the incoming change creates, updates, or deletes the File. */
  readonly kind: ApplyChangeKind
}

/**
 * Build the Apply plan for a set of applicable incoming changes, enforcing the two
 * `ApplyPlanner`-owned invariants in one place.
 *
 * For each incoming change (witness + kind):
 * - **Invariant #2**: if the File has an uncommitted local edit ({@link LocalEditState.uncommittedEdits}),
 *   the item is emitted `blockedReason: 'uncommitted-edit'` so it is surfaced and NOT
 *   written — applying it would silently overwrite in-progress work. (A `create` for a
 *   File with no local copy can never have a local edit, but the check is uniform and
 *   data-driven, so there is no special case to forget.)
 * - **Invariant #4**: a `delete` is emitted `requiresConfirmation: true` — it is a
 *   first-class plan item that must be explicitly confirmed before it is applied.
 *
 * There is intentionally NO overload that accepts a bare path: the only way into the plan
 * is to hand over a witness, so the plan is scoped-by-construction (invariant #3).
 *
 * @param changes One {@link IncomingChange} per applicable incoming File to plan.
 * @param localEdits The local-drift facts for invariant #2 (which paths are dirty here).
 *   Omitted ⇒ treated as "no local edits", e.g. a freshly-cloned env B with nothing on disk.
 * @returns The plan, with each item tagged by block-reason + confirmation requirement.
 */
export function planIncoming(
  changes: readonly IncomingChange[],
  localEdits: LocalEditState = { uncommittedEdits: new Set() },
): ApplyPlan {
  return {
    items: changes.map((change) => ({
      witness: change.witness,
      kind: change.kind,
      // Invariant #2: block any incoming write to a File with uncommitted local edits.
      blockedReason: localEdits.uncommittedEdits.has(change.witness.targetPath)
        ? 'uncommitted-edit'
        : null,
      // Invariant #4: a deletion is never applied without explicit confirmation.
      requiresConfirmation: change.kind === 'delete',
    })),
  }
}

/**
 * Backward-compatible helper for the incoming-clean MVP path: every File is a `create`
 * with no local edit. Built on {@link planIncoming} so it shares the one invariant
 * implementation (it can never produce a blocked or confirm-required item, by shape).
 *
 * @param witnesses One {@link AppliesHere} per incoming-clean File to apply.
 * @returns The plan of `create` items, one per witness.
 */
export function planIncomingClean(witnesses: readonly AppliesHere[]): ApplyPlan {
  return planIncoming(witnesses.map((witness) => ({ witness, kind: 'create' as const })))
}

/** The plan items that are READY to apply: not blocked (invariant #2 cleared). */
export function ready(plan: ApplyPlan): readonly ApplyPlanItem[] {
  return plan.items.filter((item) => item.blockedReason === null)
}

/** The plan items BLOCKED by an uncommitted local edit (surfaced, never written). */
export function blocked(plan: ApplyPlan): readonly ApplyPlanItem[] {
  return plan.items.filter((item) => item.blockedReason !== null)
}

/** The `delete` plan items — each requires explicit confirmation (invariant #4). */
export function deletions(plan: ApplyPlan): readonly ApplyPlanItem[] {
  return plan.items.filter((item) => item.kind === 'delete')
}
