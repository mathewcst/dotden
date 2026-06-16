/**
 * ApplyPlanner — builds the plan of what Apply will write (ADR 0008).
 *
 * **Apply** is the "make this real here" verb: write source/target state onto an
 * environment's real Files (CONTEXT.md "Apply"). Before writing, dotden computes a
 * reviewable *plan*. This is the minimal MVP slice (issue 1-04): it produces
 * **incoming-clean** plan items only — Files arriving from the Remote for which no
 * local copy exists and no Conflict is in play.
 *
 * `ApplyPlanner` owns two of ADR 0008's invariants in its full form (the
 * uncommitted-edit guard, #2, and incoming-deletion confirmation, #4) — those land
 * in later slices (1-10). What it already enforces here is its **consumption** of
 * invariant #3: every plan item is keyed by an {@link AppliesHere} witness it is
 * *handed*. The planner cannot mint that witness (the brand is private to
 * {@link ApplicabilityResolver}); it can only act on Files an applicability check
 * has already vouched for. So "plan an Apply for a non-applicable File" is a
 * compile-time impossibility, not a runtime check the planner might forget.
 */
import type { AppliesHere } from './applicability-resolver.js'

/**
 * The kind of change an incoming-clean plan item represents.
 *
 * The MVP thread only ever produces `create` (a File that exists on the Remote but
 * not locally). `update`/`delete` are part of the fuller plan model that arrives
 * with the Review & Apply slice (1-09/1-10); they are named here so the type is
 * stable, but {@link planIncomingClean} emits only `create`.
 */
export type ApplyChangeKind = 'create' | 'update' | 'delete'

/**
 * One reviewable item in an Apply plan.
 *
 * It carries the {@link AppliesHere} witness for its File so that the act of
 * applying it is, by construction, scoped to a File this environment subscribes to.
 * Downstream code that writes the File reads `witness.targetPath`, never a raw path
 * the planner invented.
 */
export interface ApplyPlanItem {
  /** Un-forgeable proof this File applies to this environment (invariant #3, ADR 0008). */
  readonly witness: AppliesHere
  /** The change Apply will perform for this File. MVP emits only `create`. */
  readonly kind: ApplyChangeKind
}

/**
 * A complete Apply plan: the set of items the user reviews before applying.
 */
export interface ApplyPlan {
  /** The reviewable changes; each is gated by an {@link AppliesHere} witness. */
  readonly items: readonly ApplyPlanItem[]
}

/**
 * Build the incoming-clean Apply plan for a set of applicable, incoming Files.
 *
 * "Incoming-clean" = a File present on the Remote with **no local copy** and **no
 * Conflict** — the only path this MVP slice handles. The caller proves each File is
 * incoming-clean (the SyncEngine routes only that path) and applicable (it passes
 * an {@link AppliesHere} witness per File); the planner turns each witness into a
 * `create` plan item. There is intentionally NO overload that accepts a bare path:
 * the only way to get a File into the plan is to hand over its witness.
 *
 * @param witnesses One {@link AppliesHere} per incoming-clean File to apply.
 * @returns The plan of `create` items, one per witness.
 */
export function planIncomingClean(witnesses: readonly AppliesHere[]): ApplyPlan {
  return {
    items: witnesses.map((witness) => ({ witness, kind: 'create' })),
  }
}
