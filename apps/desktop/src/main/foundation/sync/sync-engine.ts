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
  type ApplyPlanItem,
  type IncomingChange,
  type LocalEditState,
} from '../apply/apply-planner.js'
import { ApplicabilityResolver, isAppliesHere } from '../environments/applicability-resolver.js'
import type { AutomationPolicy } from '../apply/automation-policy.js'
import { isResolvedConflict, type ResolvedConflict } from '../apply/conflict-model.js'
import type { EnvironmentEntry, WorkspacesDoc } from '../den-store.js'
import type { OperationTracer } from '../platform/operation-tracer.js'

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

/**
 * The result of routing one Sync's incoming Files through the **Auto-apply** event path
 * (issue 2-12), partitioned by what the {@link AutomationPolicy} permits.
 *
 * The split is the whole point: it shows exactly what the engine would write without the
 * user (`autoApply`) versus what it deliberately held back for manual review
 * (`needsReview`) and why — so an Auto-apply Sync never silently overwrites, never
 * auto-resolves a Conflict, and never lands an unconfirmed deletion (never fail silently).
 */
export interface AutoApplyRouting {
  /**
   * The plan items the policy cleared to **apply automatically** — each clean, ready,
   * witness-backed (invariant #3), not blocked (invariant #2), and not a deletion
   * (invariant #4). These are the `targetPath`s the caller writes with no review.
   */
  readonly autoApply: readonly ApplyPlanItem[]
  /**
   * The incoming Files the policy held back for **manual review**, with the owner verdict
   * that held them. These STILL surface to the user (the Incoming banner / Review surface)
   * — Auto-apply narrows what needs a human, it never hides what does.
   */
  readonly needsReview: readonly { targetPath: string; reason: AutoApplyHoldReason }[]
}

/**
 * The decision of the **YOLO auto-Commit-before-merge** event path (issue 2-13) — WHICH
 * local edits the engine should record as a Commit *before* the incoming merge runs.
 *
 * It is the realization of ADR 0008's named "YOLO auto-commit-before-merge path". The
 * whole point of the slice: a fully hands-off environment must not stop to ask the user to
 * Commit, but it must also never lose in-progress local work (invariant #2). So before
 * pulling, YOLO records the local edits as a Commit — and the ORDERING is the safety, so
 * the local edits survive as Commits and the merge runs against them. This routing object
 * is the *plan* for that Commit; the actual `git commit` + `git merge` are executed
 * downstream in `DenService` (this engine performs no I/O).
 */
export interface YoloPreMergeRouting {
  /**
   * Whether this level even permits the pre-merge auto-Commit. `false` at every rung below
   * YOLO (Commit stays a deliberate user action there), in which case {@link commitPaths}
   * is empty and the caller does NOT auto-Commit — it leaves Commit to the user and the
   * merge to the ordinary reviewed path. `true` only at YOLO.
   */
  readonly autoCommitEnabled: boolean
  /**
   * The destination-relative paths to auto-Commit before the merge — the subset of the
   * environment's local edits that are **applicable here** (each backed by an
   * {@link AppliesHere} witness, invariant #3). A local edit to a File this environment does
   * NOT subscribe to is deliberately excluded ({@link skipped}), so the hands-off Commit
   * never sweeps in out-of-subscription drift. Empty when nothing is editable here or the
   * level forbids it.
   */
  readonly commitPaths: readonly string[]
  /**
   * Local-edit paths deliberately NOT auto-Committed because they are **outside this
   * environment's subscription** (no witness; invariant #3, `ApplicabilityResolver`). They
   * are surfaced rather than silently dropped — an out-of-subscription local edit is not the
   * engine's to Commit, but the user should be able to see it was left alone (never fail
   * silently).
   */
  readonly skipped: readonly { targetPath: string; reason: 'not-applicable' }[]
}

/** Construction dependencies for {@link SyncEngine}. */
export interface SyncEngineOptions {
  /** This environment's registry entry (its subscriptions), from `.dotden/`. */
  readonly environment: EnvironmentEntry
  /** The synced Workspace tree + File placements, from `.dotden/`. */
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

  /**
   * Route the **Auto-apply** event path (issue 2-12): partition this Sync's incoming Files
   * into the ones the {@link AutomationPolicy} clears to apply *without* the user, and the
   * ones it deliberately holds back for manual review — never re-checking an owner's
   * invariant (ADR 0008).
   *
   * This is the load-bearing composition test point for Auto-apply. It is built ENTIRELY
   * on {@link routeIncomingClean} (which already enforces invariants #1 and #3 and produces
   * the planner's #2/#4 verdicts) plus the policy's level gate, so there is exactly one
   * place the dangerous composition lives:
   *
   * - a `conflict` was deferred by `routeIncomingClean` *before the planner* — it never
   *   becomes a plan item, so it can never be auto-applied (invariant #1). It is reported
   *   in `needsReview` with reason `conflict`;
   * - a `not-applicable` File got no witness (invariant #3) — reported `not-applicable`;
   * - for every actual plan item we ask {@link AutomationPolicy.mayAutoApply}. The policy
   *   only says yes when the item is not blocked (invariant #2) and needs no confirmation
   *   (invariant #4) — verdicts the planner OWNS and this engine merely reads. A `false`
   *   verdict routes the item to `needsReview` with the specific owner reason
   *   (`uncommitted-edit` / `needs-confirmation`), so the user still sees it.
   *
   * Because `mayAutoApply` returns `false` at Manual/Auto-sync, calling this at those rungs
   * yields an EMPTY `autoApply` and every incoming File in `needsReview` — i.e. it degrades
   * to "review everything", exactly the manual contract. Nothing is auto-applied that the
   * owners did not already clear, at any level.
   *
   * @param incoming The classified incoming Files from this Sync's fetch.
   * @param policy The environment's {@link AutomationPolicy} — the LEVEL gate this depends on.
   * @param traceId Correlation id for the wide event (the IPC `_trace.traceId`).
   * @param localEdits The local-drift facts the planner needs for invariant #2.
   * @returns The auto-applicable items and the held-back Files (with the owner reason).
   */
  routeAutoApply(
    incoming: readonly IncomingFile[],
    policy: AutomationPolicy,
    traceId: string,
    localEdits?: LocalEditState,
  ): AutoApplyRouting {
    const span = this.tracer?.startOperation('sync', traceId)
    // Reuse the one router that owns invariants #1 + #3 and surfaces the planner's #2/#4
    // verdicts — Auto-apply NEVER forks a second path that could route a row differently.
    const { plan, deferred } = this.routeIncomingClean(incoming, traceId, localEdits)

    const autoApply: ApplyPlanItem[] = []
    const needsReview: { targetPath: string; reason: AutoApplyHoldReason }[] = []

    // Conflicts + non-applicable Files were deferred before the planner — they are never
    // plan items, so they can never be auto-applied; carry them through to `needsReview`.
    for (const item of deferred) {
      needsReview.push({ targetPath: item.targetPath, reason: item.reason })
    }

    for (const item of plan.items) {
      // The LEVEL gate: depend on the policy, which depends on the planner's verdicts. We
      // do NOT re-read `blockedReason`/`requiresConfirmation` to decide — only to name WHY
      // an item the policy refused was held (so the reason matches the owner's verdict).
      if (policy.mayAutoApply({ witness: item.witness, item })) {
        autoApply.push(item)
      } else {
        // The policy refused. Name WHY by reading the OWNER'S verdict on the item (we do not
        // re-derive the verdict — the planner already set it; we only translate it to a
        // surfaced reason), so a held item always carries the true owner cause:
        // - invariant #2: an uncommitted-edit block — never overwrite in-progress work;
        // - invariant #4: an incoming deletion needing explicit confirmation;
        // - otherwise it is a clean, ready item the LEVEL (Manual/Auto-sync) keeps manual.
        const reason: AutoApplyHoldReason =
          item.blockedReason === 'uncommitted-edit'
            ? 'uncommitted-edit'
            : item.requiresConfirmation
              ? 'needs-confirmation'
              : 'clean'
        needsReview.push({ targetPath: item.witness.targetPath, reason })
      }
    }

    if (span) {
      span.setAttribute('fileCount', autoApply.length)
      span.setAttribute('outcome', 'ok')
      span.end('ok')
    }

    return { autoApply, needsReview }
  }

  /**
   * Route the **YOLO auto-Commit-before-merge** event path (issue 2-13) — decide which of
   * this environment's local edits to Commit *before* the incoming merge, depending on the
   * {@link AutomationPolicy} level gate and never re-checking an owner's invariant (ADR
   * 0008). This is the third load-bearing per-event-path test point ADR 0008 names
   * ("the YOLO auto-commit-before-merge path").
   *
   * The dangerous composition this path exists to make safe-by-construction is the ORDERING:
   * a hands-off environment must Commit local edits **before** it merges, so the edits
   * survive as Commits (the never-lose-data invariant #2 expressed as an action) instead of
   * being overwritten by — or lost to — the incoming merge. This method does NOT merge and
   * does NOT Commit; it returns the *plan* (`autoCommitEnabled` + `commitPaths`) the caller
   * executes in the strict order Commit→push→merge→auto-apply.
   *
   * It depends on two owners and re-derives neither:
   * - {@link AutomationPolicy.mayAutoCommitBeforeMerge} — the LEVEL gate. At every rung below
   *   YOLO it is `false`, so `autoCommitEnabled` is `false` and `commitPaths` is empty: the
   *   engine auto-Commits nothing and Commit stays the user's (transport-not-commit, ADR
   *   0006). The method degrades to a clean no-op at those rungs.
   * - {@link ApplicabilityResolver} — invariant #3. Only a local edit to a File this
   *   environment subscribes to gets a witness and is eligible to Commit; an
   *   out-of-subscription edit is reported in `skipped` (`not-applicable`), never swept into
   *   the hands-off Commit.
   *
   * Crucially, this path does NOT touch Conflicts at all. Auto-Committing first is what lets
   * the *subsequent* merge surface a true overlapping Conflict to the resolver — and that
   * Conflict is STILL never auto-resolved (invariant #1 stays with `ConflictModel`; the
   * merge is routed through {@link routeConflictResolution} / `DenService.detectConflicts`,
   * which only ever writes branded, user-chosen resolutions). So even YOLO's hands-off
   * Commit cannot manufacture a silent Conflict resolution.
   *
   * @param localEdits The destination-relative paths with uncommitted local edits on THIS
   *   environment (the local-drift axis, from `chezmoi status` column X).
   * @param policy The environment's {@link AutomationPolicy} — the LEVEL gate this depends on.
   * @param traceId Correlation id for the wide event (the IPC `_trace.traceId`).
   * @returns Whether the pre-merge auto-Commit is enabled and exactly which applicable paths
   *   to Commit (plus the out-of-subscription edits deliberately left alone).
   */
  routeYoloPreMerge(
    localEdits: readonly string[],
    policy: AutomationPolicy,
    traceId: string,
  ): YoloPreMergeRouting {
    const span = this.tracer?.startOperation('sync', traceId)
    // The LEVEL gate, read straight off the policy — never re-derived. At any rung below YOLO
    // this is false: we auto-Commit nothing and leave Commit to the user (ADR 0006).
    const autoCommitEnabled = policy.mayAutoCommitBeforeMerge()

    const commitPaths: string[] = []
    const skipped: { targetPath: string; reason: 'not-applicable' }[] = []

    if (autoCommitEnabled) {
      for (const targetPath of localEdits) {
        // Invariant #3: only Commit an edit to a File this environment actually subscribes to.
        // We cannot mint the witness ourselves — we ask the sole owner (ApplicabilityResolver).
        const result = this.resolver.resolve(targetPath)
        if (isAppliesHere(result)) {
          // Carry the witness's targetPath (not a raw input string) so the committed set is
          // scoped-by-construction to applicable Files.
          commitPaths.push(result.targetPath)
        } else {
          // An out-of-subscription local edit is not ours to Commit — surface it, never sweep it.
          skipped.push({ targetPath, reason: 'not-applicable' })
        }
      }
    }

    if (span) {
      span.setAttribute('fileCount', commitPaths.length)
      span.setAttribute('automationLevel', policy.automationLevel)
      span.setAttribute('outcome', 'ok')
      span.end('ok')
    }

    return { autoCommitEnabled, commitPaths, skipped }
  }

  /**
   * Route the **conflict-resolved** event path: turn the user's explicit resolutions into
   * the set of writes to apply, refusing any that did not go through {@link ConflictModel}.
   *
   * This is the second half of the Conflict story (the first half is `routeIncomingClean`
   * deferring a `conflict`, never applying it). When the user has resolved Conflicts, the
   * resolution writes arrive here as {@link ResolvedConflict} values — and SyncEngine does
   * NOT re-derive the resolution or pick a side. It only checks the structural guarantee
   * (ADR 0008 #1): every write MUST carry the un-forgeable brand that proves it came from
   * an explicit `ConflictModel.resolve(choice)` call. A value missing the brand (a
   * hand-rolled "auto-resolution") is dropped into `rejected`, never written. Because the
   * brand is unconstructable outside `ConflictModel`, there is no automation level — not
   * even YOLO — that can manufacture a resolution this router would accept; "auto-resolved
   * a Conflict" is a state the types cannot express.
   *
   * @param resolutions The user's resolved Conflicts (each a `ConflictModel.resolve` result).
   * @param traceId Correlation id for the wide event (the IPC `_trace.traceId`).
   * @returns The accepted writes (branded, user-chosen) and any rejected non-witnesses.
   */
  routeConflictResolution(
    resolutions: readonly CandidateResolution[],
    traceId: string,
  ): ConflictResolutionRouting {
    const span = this.tracer?.startOperation('sync', traceId)
    const writes: ResolvedConflict[] = []
    const rejected: { targetPath: string; reason: 'not-user-resolved' }[] = []

    for (const resolution of resolutions) {
      // The ONLY gate: prove the bytes came from an explicit user choice. SyncEngine never
      // inspects the choice or the bytes — it just refuses anything ConflictModel didn't mint.
      if (isResolvedConflict(resolution)) {
        writes.push(resolution)
      } else {
        // A candidate that did not pass the brand gate (a forged/auto "resolution"). Surface
        // its path when it has one, else a neutral marker — never write it.
        const targetPath =
          typeof resolution.targetPath === 'string' ? resolution.targetPath : '(unknown)'
        rejected.push({ targetPath, reason: 'not-user-resolved' })
      }
    }

    if (span) {
      span.setAttribute('fileCount', writes.length)
      span.setAttribute('outcome', rejected.length === 0 ? 'ok' : 'error')
      span.end(rejected.length === 0 ? 'ok' : 'error')
    }

    return { writes, rejected }
  }
}

/**
 * A *candidate* resolution handed to {@link SyncEngine.routeConflictResolution}.
 *
 * It is deliberately a loose shape — it carries (at most) a readable `targetPath` and is
 * NOT assumed to be a real {@link ResolvedConflict}. That is the point: the router's job
 * is to separate genuine, branded user choices from forgeries (an auto-resolve path's
 * un-branded value), so it must accept the unsafe shape in order to reject it. The brand
 * gate ({@link isResolvedConflict}) is the only thing that promotes a candidate to a write.
 */
export interface CandidateResolution {
  /** The File the candidate claims to resolve, for the rejection record (may be absent). */
  readonly targetPath?: string
}

/**
 * The result of routing the conflict-resolved path through {@link SyncEngine}.
 *
 * Separates the resolution writes SyncEngine will let through (each proven to be a
 * user choice) from any it refused, so the caller can see exactly what was accepted and
 * never silently writes an unresolved/auto-resolved Conflict (ADR 0008 #1).
 */
export interface ConflictResolutionRouting {
  /** The accepted resolution writes — each an un-forgeable, user-chosen {@link ResolvedConflict}. */
  readonly writes: readonly ResolvedConflict[]
  /**
   * Resolutions refused because they did NOT carry `ConflictModel`'s brand — i.e. they
   * were not produced by an explicit user choice. Never written; surfaced so the refusal
   * is visible (never fail silently).
   */
  readonly rejected: readonly { targetPath: string; reason: 'not-user-resolved' }[]
}
