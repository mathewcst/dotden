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
import type { WorkspacesDoc } from '../den-store.js'
import type { EnvironmentEntry } from '../../../shared/environments.js'
import { effectiveScope, narrowScope, scopeAppliesOn } from '../platform/os-scope.js'
import type { Os, Scope } from '../../../shared/scope.js'

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
  /**
   * Machine-readable reason, for UI copy and tests:
   * - `unplaced` — the File has no `.dotden/` placement, so its Workspace is unknown;
   * - `not-subscribed` — the File's Workspace is one this environment does not subscribe to
   *   (the access axis, invariant #3);
   * - `out-of-scope` — the File's **OS Scope** does not include this environment's OS (the
   *   applicability axis, issue 1-15: `file.scope matches env.os` failed).
   */
  readonly reason: 'not-subscribed' | 'unplaced' | 'out-of-scope'
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
 * the current Workspace/placement doc (both read from `.dotden/`). It performs no
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
    // Access axis (invariant #3): the File's Workspace must be one this environment subscribes to.
    if (!this.environment.subscribedWorkspaces.includes(placement.workspaceId)) {
      return { targetPath, reason: 'not-subscribed', workspaceId: placement.workspaceId }
    }
    // OS-applicability axis (issue 1-15): the File's EFFECTIVE Scope (its own declared Scope
    // narrowed by every inherited Folder/Workspace Scope) must include THIS environment's OS.
    // A File scoped to other OSes does not apply here — its `.chezmoiignore` rule already keeps
    // chezmoi from writing it; refusing it here keeps the witness and the ignore in lock-step,
    // so a non-applicable File is never planned for Apply (ADR 0008's `appliesHere` OS clause).
    if (
      !scopeAppliesOn(
        this.effectiveScopeOf(placement.workspaceId, placement.groupId, placement.scope),
        this.environment.os as Os,
      )
    ) {
      return { targetPath, reason: 'out-of-scope', workspaceId: placement.workspaceId }
    }
    // Mint the witness. This object literal is the ONLY place an AppliesHere comes
    // into existence in the whole codebase — the brand key is unreachable elsewhere.
    return { targetPath, [AppliesHereBrand]: true }
  }

  /**
   * Compute a File's EFFECTIVE OS Scope by folding the Workspace → Group chain → the File's
   * own Scope (issue 1-15). Mirrors {@link import('./den-store.js').DenStore.effectiveScopeOf}
   * but operates on the in-memory synced doc the resolver already holds, so the resolver stays
   * a pure function (no I/O) and can be exercised in `SyncEngine`'s property tests.
   *
   * @param workspaceId The File's owning Workspace.
   * @param groupId The File's Group, or `null` for the Workspace root.
   * @param ownScope The File's own declared Scope.
   * @returns The File's effective Scope (`null` = applies on every OS).
   */
  private effectiveScopeOf(workspaceId: string, groupId: string | null, ownScope: Scope): Scope {
    const workspace = this.workspaces.workspaces.find((w) => w.id === workspaceId)
    // Walk leaf Group → root, collecting Group Scopes, guarding against a malformed cycle.
    const ancestors: Scope[] = []
    const seen = new Set<string>()
    let current = groupId
    while (current !== null && !seen.has(current)) {
      seen.add(current)
      const group = workspace?.groups.find((g) => g.id === current)
      if (!group) break
      ancestors.push(group.scope)
      current = group.parentId
    }
    // Outermost-first chain: Workspace Scope, then Group ancestors outer→inner, then the File's.
    const chain: Scope[] = [workspace?.scope ?? null, ...ancestors.reverse()]
    return narrowScope(effectiveScope(chain), ownScope)
  }
}
