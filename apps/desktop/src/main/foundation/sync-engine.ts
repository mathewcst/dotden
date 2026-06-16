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
import {
  planIncoming,
  type ApplyChangeKind,
  type ApplyPlan,
  type IncomingChange,
  type LocalEditState,
} from './apply-planner.js'
import { ApplicabilityResolver, isAppliesHere } from './applicability-resolver.js'
import type { EnvironmentEntry, WorkspacesDoc } from './myenv-store.js'
import type { OperationTracer } from './operation-tracer.js'

/**
 * One incoming File observed during a Sync fetch, classified by its Remote-vs-local
 * relationship.
 *
 * `status` is what lets SyncEngine route safely WITHOUT re-deriving an invariant:
 * - `incoming-clean` — on the Remote, absent locally, no Conflict → applied as a `create`;
 * - `incoming-delete` — the Remote removed a File that exists here; routed as a `delete`
 *   plan item that {@link ApplyPlanner} marks `requiresConfirmation` (invariant #4:
 *   confirm incoming deletions — never applied silently);
 * - `conflict` — the same File changed both here and on the Remote in a way git
 *   cannot auto-merge (CONTEXT.md "Conflict"). SyncEngine must NEVER treat this as
 *   clean; the router drops it untouched for the ConflictModel owner (invariant #1).
 */
export interface IncomingFile {
  /** Destination-relative File path arriving from the Remote (e.g. `.zshrc`). */
  readonly targetPath: string
  /** Remote-vs-local classification computed upstream (git status/diff). */
  readonly status: 'incoming-clean' | 'incoming-delete' | 'conflict'
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
 * Map an {@link IncomingFile.status} that the planner ACTS on onto its {@link ApplyChangeKind}.
 *
 * Only the two acted-on statuses appear here — `conflict` is filtered out *before* this
 * lookup (it is never routed as a plan item; invariant #1). Keeping the mapping in one
 * object means SyncEngine never invents a kind: it reads the classification it was given.
 */
const STATUS_TO_KIND: Record<'incoming-clean' | 'incoming-delete', ApplyChangeKind> = {
  'incoming-clean': 'create',
  'incoming-delete': 'delete',
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
   * Route a Sync's incoming Files into a witness-gated Apply plan.
   *
   * Routes the three acted-on/deferred classifications, never re-checking an owner's
   * invariant:
   * - a `conflict` is deferred untouched — SyncEngine never auto-resolves it
   *   (invariant #1 stays with `ConflictModel`); routing it as clean would be the
   *   exact regression ADR 0008 guards against;
   * - an `incoming-clean` File becomes a `create`, an `incoming-delete` becomes a
   *   `delete` — but ONLY after the resolver mints an {@link AppliesHere} witness for
   *   it (invariant #3); a non-applicable File is deferred with reason `not-applicable`;
   * - the witness-backed changes go to {@link planIncoming}, the sole owner of the
   *   uncommitted-edit guard (invariant #2) and deletion-confirmation (invariant #4).
   *   SyncEngine does NOT re-decide either — it hands `localEdits` to the planner and
   *   consumes the plan items' `blockedReason`/`requiresConfirmation` verdicts.
   *
   * @param incoming The classified incoming Files from this Sync's fetch.
   * @param traceId Correlation id for the wide event (the IPC `_trace.traceId`).
   * @param localEdits The local-drift facts (paths dirty on THIS environment) that the
   *   planner needs for invariant #2; omitted ⇒ no local edits (e.g. a fresh env B).
   * @returns The witness-gated Apply plan plus the deferred Files and why.
   */
  routeIncomingClean(
    incoming: readonly IncomingFile[],
    traceId: string,
    localEdits?: LocalEditState,
  ): IncomingCleanRouting {
    const span = this.tracer?.startOperation('sync', traceId)
    const changes: IncomingChange[] = []
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
        // Carry the classification's kind through to the planner (create vs delete);
        // the planner — not SyncEngine — decides confirmation + blocking from it.
        changes.push({ witness: result, kind: STATUS_TO_KIND[file.status] })
      } else {
        deferred.push({ targetPath: file.targetPath, reason: 'not-applicable' })
      }
    }

    // Hand the witnesses (not raw paths) + the local-drift facts to the planner; it can
    // only create plan items from witnesses, so the plan is scoped-by-construction, and
    // it — not SyncEngine — owns the uncommitted-edit block + deletion confirmation.
    const plan = planIncoming(changes, localEdits)

    if (span) {
      span.setAttribute('fileCount', plan.items.length)
      span.setAttribute('outcome', 'ok')
      span.end('ok')
    }

    return { plan, deferred }
  }
}
