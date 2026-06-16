/**
 * SyncEngine — the orchestration seam that routes Sync event paths (ADR 0008).
 *
 * dotden's safety invariants don't live in isolation; they **compose at runtime in
 * SyncEngine, per event** (ADR 0008). SyncEngine is therefore the single place that
 * routes an event to its handler — and the single place a routing mistake would be
 * dangerous. ADR 0008's discipline: SyncEngine **never re-checks an invariant an
 * owner already guarantees**. It depends on the owners' types instead:
 *
 * - to act on a File it must hold an {@link AppliesHere} witness, which only
 *   {@link ApplicabilityResolver} can mint (invariant #3, "act only within
 *   subscription"); SyncEngine never re-derives applicability itself;
 * - it routes incoming Files through {@link ApplyPlanner} (which consumes those
 *   witnesses) and never auto-resolves a Conflict — Conflicts are simply not on the
 *   incoming-clean path this slice routes (invariant #1 is owned by `ConflictModel`,
 *   a later slice; SyncEngine's job is to *not route a conflicting File as clean*).
 *
 * This MVP slice routes exactly one path: **incoming-clean** — Files arriving from
 * the Remote that have no local copy and no Conflict. That is the load-bearing
 * integration test point for ADR 0008 (per-event-path tests).
 */
import { planIncomingClean, type ApplyPlan } from './apply-planner.js'
import { ApplicabilityResolver, isAppliesHere } from './applicability-resolver.js'
import type { EnvironmentEntry, WorkspacesDoc } from './myenv-store.js'
import type { OperationTracer } from './operation-tracer.js'

/**
 * One incoming File observed during a Sync fetch, classified by its Remote-vs-local
 * relationship.
 *
 * `status` is what lets SyncEngine route safely WITHOUT re-deriving an invariant:
 * - `incoming-clean` — on the Remote, absent locally, no Conflict → the only status
 *   this slice applies;
 * - `conflict` — the same File changed both here and on the Remote in a way git
 *   cannot auto-merge (CONTEXT.md "Conflict"). SyncEngine must NEVER treat this as
 *   clean; the incoming-clean router drops it untouched for the ConflictModel owner.
 */
export interface IncomingFile {
  /** Destination-relative File path arriving from the Remote (e.g. `.zshrc`). */
  readonly targetPath: string
  /** Remote-vs-local classification computed upstream (git status/diff). */
  readonly status: 'incoming-clean' | 'conflict'
}

/**
 * The result of routing one Sync's incoming Files through the incoming-clean path.
 *
 * Separates what was planned for Apply from what was *deferred* (conflicts and
 * non-applicable Files), so callers can see exactly what SyncEngine did and did not
 * touch — never fail silently.
 */
export interface IncomingCleanRouting {
  /** The Apply plan built from incoming-clean, applicable Files (witness-gated). */
  readonly plan: ApplyPlan
  /**
   * Files deliberately NOT applied by this path, with why: a `conflict` (handed off
   * to the ConflictModel owner, never auto-resolved) or `not-applicable` (outside
   * this environment's subscription, refused by {@link ApplicabilityResolver}).
   */
  readonly deferred: readonly { targetPath: string; reason: 'conflict' | 'not-applicable' }[]
}

/** Construction dependencies for {@link SyncEngine}. */
export interface SyncEngineOptions {
  /** This environment's registry entry (its subscriptions), from `.myenv/`. */
  readonly environment: EnvironmentEntry
  /** The synced Workspace tree + File placements, from `.myenv/`. */
  readonly workspaces: WorkspacesDoc
  /** Tracer used to emit one wide event per routed Sync (ADR 0007); optional. */
  readonly tracer?: OperationTracer
}

/**
 * Routes Sync events to their handlers without re-checking owners' invariants.
 *
 * Holds the synced subscription model so it can ask {@link ApplicabilityResolver}
 * for a witness per File; it never decides applicability itself. It performs no
 * I/O of its own (the actual `chezmoi apply` write happens later, downstream of the
 * plan), which keeps it a fast, deterministic unit to property-test.
 */
export class SyncEngine {
  private readonly resolver: ApplicabilityResolver
  private readonly tracer?: OperationTracer

  /**
   * @param options Environment + synced model + optional tracer (see {@link SyncEngineOptions}).
   */
  constructor(options: SyncEngineOptions) {
    this.resolver = new ApplicabilityResolver(options.environment, options.workspaces)
    this.tracer = options.tracer
  }

  /**
   * Route a Sync's incoming Files through the **incoming-clean** path only.
   *
   * For each File:
   * - a `conflict` is deferred untouched — SyncEngine never auto-resolves it
   *   (invariant #1 stays with `ConflictModel`); routing it as clean would be the
   *   exact regression ADR 0008 guards against;
   * - an `incoming-clean` File is checked for applicability via the resolver; only a
   *   minted {@link AppliesHere} witness lets it enter the Apply plan (invariant #3);
   *   a non-applicable File is deferred with reason `not-applicable`.
   *
   * @param incoming The classified incoming Files from this Sync's fetch.
   * @param traceId Correlation id for the wide event (the IPC `_trace.traceId`).
   * @returns The witness-gated Apply plan plus the deferred Files and why.
   */
  routeIncomingClean(incoming: readonly IncomingFile[], traceId: string): IncomingCleanRouting {
    const span = this.tracer?.startOperation('sync', traceId)
    const applicable: import('./applicability-resolver.js').AppliesHere[] = []
    const deferred: { targetPath: string; reason: 'conflict' | 'not-applicable' }[] = []

    for (const file of incoming) {
      // Conflicts are NEVER auto-resolved or applied here. Drop them for the
      // ConflictModel owner; do not even consult applicability (ADR 0008 #1).
      if (file.status === 'conflict') {
        deferred.push({ targetPath: file.targetPath, reason: 'conflict' })
        continue
      }
      // Ask the sole owner of invariant #3 for proof; we cannot mint it ourselves.
      const result = this.resolver.resolve(file.targetPath)
      if (isAppliesHere(result)) {
        applicable.push(result)
      } else {
        deferred.push({ targetPath: file.targetPath, reason: 'not-applicable' })
      }
    }

    // Hand the witnesses (not raw paths) to the planner; it can only create plan
    // items from witnesses, so the plan is scoped-by-construction.
    const plan = planIncomingClean(applicable)

    if (span) {
      span.setAttribute('fileCount', plan.items.length)
      span.setAttribute('outcome', 'ok')
      span.end('ok')
    }

    return { plan, deferred }
  }
}
