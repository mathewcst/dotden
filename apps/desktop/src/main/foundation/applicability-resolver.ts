/**
 * ApplicabilityResolver — sole owner of invariant #3, "act only within
 * subscription" (ADR 0008).
 *
 * dotden may only Apply a File that falls inside a Workspace this environment
 * **subscribes to** (Workspaces are the environment-access boundary, ADR 0005).
 * Rather than have every caller re-check "is this File in a subscribed Workspace?"
 * (and risk one caller forgetting), this resolver is the *one* place that decides,
 * and it proves its decision with an un-forgeable {@link AppliesHere} witness.
 *
 * The witness is a **branded type**: its brand symbol is module-private, so no code
 * outside this file can construct an `AppliesHere` value — it can only obtain one by
 * asking {@link ApplicabilityResolver.resolve}. `ApplyPlanner` and `SyncEngine`
 * **require** an `AppliesHere` as input to act on a File, so the type system makes
 * "applied to a non-applicable File" *unrepresentable* (ADR 0008's "cannot express
 * the unsafe state"), not merely "remembered to check".
 */
import type { EnvironmentEntry, WorkspacesDoc } from './myenv-store.js'

/**
 * Module-private brand symbol. It is a REAL runtime symbol (so the witness can
 * actually carry it) but it is NOT exported, so no other module can name the key —
 * the only way to get a value carrying it is through {@link ApplicabilityResolver.resolve}.
 * That is what makes the witness un-forgeable at both the type and runtime levels.
 */
const AppliesHereBrand: unique symbol = Symbol('dotden.AppliesHere')

/**
 * An un-forgeable witness that a specific File applies to *this* environment.
 *
 * Carrying it as a function argument is dotden's structural proof of invariant #3:
 * a caller cannot fabricate one (the brand is private) and cannot re-derive it
 * (only {@link ApplicabilityResolver} can mint it), so any code path that acts on a
 * File must have gone through the resolver first. The `targetPath` it certifies is
 * readable so callers know *which* File the witness vouches for.
 */
export interface AppliesHere {
  /** The destination-relative File path this witness certifies as applicable here. */
  readonly targetPath: string
  /** Private brand — present only on values minted inside this module. */
  readonly [AppliesHereBrand]: true
}

/**
 * Why a File is NOT applicable to this environment — returned instead of a witness.
 *
 * Surfaced so the UI can explain (never fail silently): the File lives in a
 * Workspace this environment does not subscribe to, or it has no placement at all.
 */
export interface NotApplicable {
  /** The File that does not apply here. */
  readonly targetPath: string
  /** Machine-readable reason, for UI copy and tests. */
  readonly reason: 'not-subscribed' | 'unplaced'
  /** The Workspace the File belongs to, when known (absent for `unplaced`). */
  readonly workspaceId?: string
}

/** The result of an applicability check: either the witness or a typed refusal. */
export type ApplicabilityResult = AppliesHere | NotApplicable

/** True when a resolver result is the applicable witness (type guard for callers). */
export function isAppliesHere(result: ApplicabilityResult): result is AppliesHere {
  // The brand key is module-private, so this guard can only ever match values this
  // module minted — callers cannot smuggle a hand-rolled object past it.
  return AppliesHereBrand in result
}

/**
 * Decides whether Files apply to one environment, given the synced subscription
 * model, and mints the {@link AppliesHere} witness for those that do.
 *
 * Construct one per applicability question with the current environment entry and
 * the current Workspace/placement doc (both read from `.myenv/`). It performs no
 * I/O — it is a pure function over the synced model, which is what lets `SyncEngine`
 * exercise it in fast property tests.
 */
export class ApplicabilityResolver {
  /**
   * @param environment This environment's registry entry (its subscriptions).
   * @param workspaces The synced Workspace tree + File placements.
   */
  constructor(
    private readonly environment: EnvironmentEntry,
    private readonly workspaces: WorkspacesDoc,
  ) {}

  /**
   * Resolve whether `targetPath` applies to this environment.
   *
   * A File applies when its placement's Workspace is one this environment
   * subscribes to (ADR 0005). When it applies, an un-forgeable {@link AppliesHere}
   * witness is minted; otherwise a typed {@link NotApplicable} explains why.
   *
   * @param targetPath Destination-relative File path to check (e.g. `.zshrc`).
   * @returns The witness when applicable, or a refusal with a machine-readable reason.
   */
  resolve(targetPath: string): ApplicabilityResult {
    const placement = this.workspaces.placements.find((p) => p.targetPath === targetPath)
    if (!placement) {
      // No placement means dotden does not know which Workspace owns this File, so
      // it cannot prove subscription — refuse rather than guess (never act blind).
      return { targetPath, reason: 'unplaced' }
    }
    if (!this.environment.subscribedWorkspaces.includes(placement.workspaceId)) {
      return { targetPath, reason: 'not-subscribed', workspaceId: placement.workspaceId }
    }
    // Mint the witness. This object literal is the ONLY place an AppliesHere comes
    // into existence in the whole codebase — the brand key is unreachable elsewhere.
    return { targetPath, [AppliesHereBrand]: true }
  }
}
