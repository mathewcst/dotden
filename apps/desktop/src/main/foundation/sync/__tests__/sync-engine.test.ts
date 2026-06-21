/**
 * SyncEngine incoming-clean routing — the LOAD-BEARING invariant-composition test
 * (ADR 0008).
 *
 * ADR 0008's whole point: the four safety invariants compose at runtime in
 * SyncEngine, per event, and the real regression is SyncEngine routing a row wrong
 * — something no pure-owner unit test can catch. So these tests live at the
 * SyncEngine seam and assert the two guarantees for the incoming-clean path:
 *
 *   1. no event applies to a NON-APPLICABLE File (invariant #3, "act only within
 *      subscription") — proven by a property test over randomized subscription /
 *      placement / status combinations;
 *   2. the path NEVER auto-resolves a Conflict (invariant #1) — a conflicting File
 *      is always deferred, never planned for Apply.
 *
 * They complement (not replace) the ApplicabilityResolver unit tests.
 */
import { describe, expect, it } from 'vitest'
import { isAppliesHere } from '../../environments/applicability-resolver.js'
import { AutomationPolicy } from '../../apply/automation-policy.js'
import {
  ConflictModel,
  isResolvedConflict,
  type ResolvedConflict,
} from '../../apply/conflict-model.js'
import type { WorkspacesDoc } from '../../../../shared/workspace.js'
import type { EnvironmentEntry } from '../../../../shared/environments.js'
import { SyncEngine, type IncomingFile } from '../sync-engine.js'

/** Build an environment entry subscribed to the given Workspaces. */
function env(subscribedWorkspaces: string[]): EnvironmentEntry {
  return { id: 'env-test', label: 'test', os: 'linux', subscribedWorkspaces }
}

describe('SyncEngine incoming-clean routing (ADR 0008 load-bearing)', () => {
  it('plans Apply only for incoming-clean Files in a subscribed Workspace', () => {
    const workspaces: WorkspacesDoc = {
      workspaces: [
        { id: 'personal', label: 'Personal', groups: [], scope: null },
        { id: 'work', label: 'Work', groups: [], scope: null },
      ],
      placements: [
        { targetPath: '.zshrc', workspaceId: 'personal', groupId: null, scope: null },
        { targetPath: '.work-only', workspaceId: 'work', groupId: null, scope: null },
      ],
    }
    // Subscribed to 'personal' only — '.work-only' must never be applied here.
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })

    const result = engine.routeIncomingClean(
      [
        { targetPath: '.zshrc', status: 'incoming-clean' },
        { targetPath: '.work-only', status: 'incoming-clean' },
      ],
      'trace-1',
    )

    expect(result.plan.items.map((i) => i.witness.targetPath)).toEqual(['.zshrc'])
    expect(result.deferred).toContainEqual({ targetPath: '.work-only', reason: 'not-applicable' })
  })

  it('never auto-resolves a Conflict: a conflicting File is deferred, never planned', () => {
    const workspaces: WorkspacesDoc = {
      workspaces: [{ id: 'personal', label: 'Personal', groups: [], scope: null }],
      placements: [{ targetPath: '.zshrc', workspaceId: 'personal', groupId: null, scope: null }],
    }
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })

    const result = engine.routeIncomingClean(
      [{ targetPath: '.zshrc', status: 'conflict' }],
      'trace-2',
    )

    // Even though the File is applicable, a Conflict is NEVER applied here — it is
    // handed off to the ConflictModel owner, never auto-resolved (invariant #1).
    expect(result.plan.items).toEqual([])
    expect(result.deferred).toEqual([{ targetPath: '.zshrc', reason: 'conflict' }])
  })

  it('routes an incoming deletion as a first-class plan item that requires confirmation (invariant #4)', () => {
    const workspaces: WorkspacesDoc = {
      workspaces: [{ id: 'personal', label: 'Personal', groups: [], scope: null }],
      placements: [{ targetPath: '.zshrc', workspaceId: 'personal', groupId: null, scope: null }],
    }
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })

    const result = engine.routeIncomingClean(
      [{ targetPath: '.zshrc', status: 'incoming-delete' }],
      'trace-del',
    )

    // The deletion is NOT silently applied or dropped — it is a real `delete` plan item…
    expect(result.plan.items).toHaveLength(1)
    expect(result.plan.items[0]?.kind).toBe('delete')
    // …and it requires explicit confirmation before it can be written (ApplyPlanner owns this).
    expect(result.plan.items[0]?.requiresConfirmation).toBe(true)
    expect(result.deferred).toEqual([])
  })

  it('blocks an incoming change to a File with an uncommitted local edit (invariant #2, no silent overwrite)', () => {
    const workspaces: WorkspacesDoc = {
      workspaces: [{ id: 'personal', label: 'Personal', groups: [], scope: null }],
      placements: [{ targetPath: '.zshrc', workspaceId: 'personal', groupId: null, scope: null }],
    }
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })

    const result = engine.routeIncomingClean(
      [{ targetPath: '.zshrc', status: 'incoming-clean' }],
      'trace-block',
      // The user has an uncommitted local edit on `.zshrc` — applying would clobber it.
      { uncommittedEdits: new Set(['.zshrc']) },
    )

    // The item is surfaced but BLOCKED — SyncEngine consumes the planner's verdict, never overwrites.
    expect(result.plan.items).toHaveLength(1)
    expect(result.plan.items[0]?.blockedReason).toBe('uncommitted-edit')
  })

  it('a non-applicable incoming deletion is deferred, never planned (invariant #3 still gates deletions)', () => {
    const workspaces: WorkspacesDoc = {
      workspaces: [
        { id: 'personal', label: 'Personal', groups: [], scope: null },
        { id: 'work', label: 'Work', groups: [], scope: null },
      ],
      placements: [{ targetPath: '.work-only', workspaceId: 'work', groupId: null, scope: null }],
    }
    // Subscribed to 'personal' only — a deletion of a 'work' File must never be planned here.
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })

    const result = engine.routeIncomingClean(
      [{ targetPath: '.work-only', status: 'incoming-delete' }],
      'trace-del-na',
    )

    expect(result.plan.items).toEqual([])
    expect(result.deferred).toEqual([{ targetPath: '.work-only', reason: 'not-applicable' }])
  })

  it('property: no planned item is ever for a non-applicable File or a Conflict', () => {
    // Exhaustively-ish drive randomized subscription/placement/status combinations
    // and assert the two invariants hold for EVERY planned item — this is the
    // composition guarantee a single example test cannot give.
    const workspaceIds = ['personal', 'work', 'home']
    let cases = 0
    let deletionsSeen = 0
    let blockedSeen = 0

    for (let seed = 0; seed < 400; seed++) {
      const rng = mulberry32(seed)
      const subscribed = workspaceIds.filter(() => rng() < 0.5)
      const placements = workspaceIds.flatMap((workspaceId, index) => {
        if (rng() < 0.4) return []
        return [{ targetPath: `.file-${index}`, workspaceId, groupId: null, scope: null }]
      })
      const workspaces: WorkspacesDoc = {
        workspaces: workspaceIds.map((id) => ({ id, label: id, groups: [], scope: null })),
        placements,
      }
      const engine = new SyncEngine({ environment: env(subscribed), workspaces })

      // Drive all three acted-on/deferred statuses, and randomize local drift, so the
      // property covers the create / delete / conflict paths AND the uncommitted-edit
      // guard composing together at the SyncEngine seam — the real regression surface.
      const dirty = new Set<string>()
      const incoming: IncomingFile[] = workspaceIds.map((_id, index) => {
        const path = `.file-${index}`
        if (rng() < 0.3) dirty.add(path)
        const roll = rng()
        const status: IncomingFile['status'] =
          roll < 0.25 ? 'conflict' : roll < 0.5 ? 'incoming-delete' : 'incoming-clean'
        return { targetPath: path, status }
      })
      const { plan } = engine.routeIncomingClean(incoming, `trace-prop-${seed}`, {
        uncommittedEdits: dirty,
      })

      for (const item of plan.items) {
        cases++
        // Every planned item carries a real, un-forgeable witness.
        expect(isAppliesHere(item.witness)).toBe(true)
        const placement = placements.find((p) => p.targetPath === item.witness.targetPath)
        // Invariant #3: the File is placed in a Workspace this environment subscribes to.
        expect(placement).toBeDefined()
        expect(subscribed).toContain(placement?.workspaceId)
        // Invariant #1: the File was NOT a conflict (conflicts are never planned).
        const status = incoming.find((f) => f.targetPath === item.witness.targetPath)?.status
        expect(status).not.toBe('conflict')
        // Invariant #4: an incoming-delete is ALWAYS a confirm-required `delete` item.
        if (status === 'incoming-delete') {
          expect(item.kind).toBe('delete')
          expect(item.requiresConfirmation).toBe(true)
          deletionsSeen++
        }
        // Invariant #2: a File with a local edit is ALWAYS blocked, never silently applied.
        if (dirty.has(item.witness.targetPath)) {
          expect(item.blockedReason).toBe('uncommitted-edit')
          blockedSeen++
        }
      }
    }

    // Sanity: the randomized run actually exercised every path (the test is not vacuous).
    expect(cases).toBeGreaterThan(0)
    expect(deletionsSeen).toBeGreaterThan(0)
    expect(blockedSeen).toBeGreaterThan(0)
  })
})

describe('SyncEngine conflict-resolved routing (ADR 0008 invariant #1, load-bearing)', () => {
  const workspaces: WorkspacesDoc = {
    workspaces: [{ id: 'personal', label: 'Personal', groups: [], scope: null }],
    placements: [{ targetPath: '.zshrc', workspaceId: 'personal', groupId: null, scope: null }],
  }

  /** Mint a genuine user resolution the only legitimate way: ConflictModel.resolve(choice). */
  function userResolution(targetPath: string): ResolvedConflict {
    return new ConflictModel({
      targetPath,
      current: 'mine\n',
      incoming: 'theirs\n',
      both: '<<<<<<<\nmine\n=======\ntheirs\n>>>>>>>\n',
    }).resolve('current')
  }

  it('accepts a user-resolved Conflict (a real ConflictModel.resolve witness)', () => {
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })

    const { writes, rejected } = engine.routeConflictResolution(
      [userResolution('.zshrc')],
      'trace-resolved',
    )

    // The branded, user-chosen resolution is accepted for writing…
    expect(writes.map((w) => w.targetPath)).toEqual(['.zshrc'])
    expect(writes.every((w) => isResolvedConflict(w))).toBe(true)
    // …and nothing is rejected.
    expect(rejected).toEqual([])
  })

  it('REFUSES an auto-resolution that did not go through ConflictModel (no brand)', () => {
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })

    // A hand-rolled "resolution" with no brand — exactly what an auto-resolve path would
    // try to smuggle in. SyncEngine must never write it.
    const fakeAutoResolved = {
      targetPath: '.zshrc',
      choice: 'incoming' as const,
      bytes: 'theirs\n',
    } as unknown as ResolvedConflict

    const { writes, rejected } = engine.routeConflictResolution([fakeAutoResolved], 'trace-auto')

    expect(writes).toEqual([])
    expect(rejected).toEqual([{ targetPath: '.zshrc', reason: 'not-user-resolved' }])
  })

  it('property: NO accepted write is ever an un-branded (auto-resolved) value', () => {
    // Mix genuine user resolutions with forged ones across many seeds; assert every
    // accepted write carries the un-forgeable brand and every forgery is rejected — the
    // structural guarantee that no path auto-resolves a Conflict (ADR 0008 #1).
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })
    let accepted = 0
    let forged = 0

    for (let seed = 0; seed < 200; seed++) {
      const rng = mulberry32(seed)
      const resolutions: ResolvedConflict[] = []
      const expectForged = new Set<string>()
      for (let i = 0; i < 4; i++) {
        const path = `.file-${i}`
        if (rng() < 0.5) {
          resolutions.push(userResolution(path))
        } else {
          // A forged "resolution" with no brand (the unsafe value the invariant forbids).
          resolutions.push({
            targetPath: path,
            choice: 'current',
            bytes: 'mine\n',
          } as unknown as ResolvedConflict)
          expectForged.add(path)
        }
      }

      const { writes, rejected } = engine.routeConflictResolution(resolutions, `t-${seed}`)
      for (const w of writes) {
        accepted++
        // Invariant #1: an accepted write is ALWAYS a real, branded user choice.
        expect(isResolvedConflict(w)).toBe(true)
        expect(expectForged.has(w.targetPath)).toBe(false)
      }
      for (const r of rejected) {
        forged++
        expect(expectForged.has(r.targetPath)).toBe(true)
      }
    }

    // Sanity: the run actually exercised both accept and reject paths (not vacuous).
    expect(accepted).toBeGreaterThan(0)
    expect(forged).toBeGreaterThan(0)
  })
})

describe('SyncEngine Auto-apply routing (ADR 0008 #1/#2/#3/#4, issue 2-12 load-bearing)', () => {
  // One Workspace this env subscribes to ('personal'); '.work-only' is out of subscription.
  const workspaces: WorkspacesDoc = {
    workspaces: [
      { id: 'personal', label: 'Personal', groups: [], scope: null },
      { id: 'work', label: 'Work', groups: [], scope: null },
    ],
    placements: [
      { targetPath: '.zshrc', workspaceId: 'personal', groupId: null, scope: null },
      { targetPath: '.gitconfig', workspaceId: 'personal', groupId: null, scope: null },
      { targetPath: '.work-only', workspaceId: 'work', groupId: null, scope: null },
    ],
  }
  const autoApply = new AutomationPolicy('auto-apply')

  it('auto-applies a CLEAN incoming change (the core Auto-apply behavior, story 27)', () => {
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })

    const { autoApply: applied, needsReview } = engine.routeAutoApply(
      [{ targetPath: '.zshrc', status: 'incoming-clean' }],
      autoApply,
      'trace-aa-clean',
    )

    // The clean, ready, applicable, non-deletion item lands without the user.
    expect(applied.map((i) => i.witness.targetPath)).toEqual(['.zshrc'])
    expect(needsReview).toEqual([])
  })

  it('still PROMPTS on a Conflict — never auto-resolved/applied (invariant #1, story 28)', () => {
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })

    const { autoApply: applied, needsReview } = engine.routeAutoApply(
      [{ targetPath: '.zshrc', status: 'conflict' }],
      autoApply,
      'trace-aa-conflict',
    )

    // A true Conflict is NEVER auto-applied — it is held for the ConflictModel resolver.
    expect(applied).toEqual([])
    expect(needsReview).toEqual([{ targetPath: '.zshrc', reason: 'conflict' }])
  })

  it('still PROMPTS on the uncommitted-edit guard — no silent overwrite (invariant #2, story 29)', () => {
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })

    const { autoApply: applied, needsReview } = engine.routeAutoApply(
      [{ targetPath: '.zshrc', status: 'incoming-clean' }],
      autoApply,
      'trace-aa-edit',
      // The File has an uncommitted local edit here — auto-applying would clobber it.
      { uncommittedEdits: new Set(['.zshrc']) },
    )

    expect(applied).toEqual([])
    expect(needsReview).toEqual([{ targetPath: '.zshrc', reason: 'uncommitted-edit' }])
  })

  it('still PROMPTS on an incoming DELETION — confirmation required (invariant #4, story 33)', () => {
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })

    const { autoApply: applied, needsReview } = engine.routeAutoApply(
      [{ targetPath: '.gitconfig', status: 'incoming-delete' }],
      autoApply,
      'trace-aa-delete',
    )

    // A deletion is `requiresConfirmation` from the planner — never auto-applied.
    expect(applied).toEqual([])
    expect(needsReview).toEqual([{ targetPath: '.gitconfig', reason: 'needs-confirmation' }])
  })

  it('holds a NON-APPLICABLE File for review (invariant #3, no witness ⇒ never auto-applied)', () => {
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })

    const { autoApply: applied, needsReview } = engine.routeAutoApply(
      [{ targetPath: '.work-only', status: 'incoming-clean' }],
      autoApply,
      'trace-aa-na',
    )

    expect(applied).toEqual([])
    expect(needsReview).toEqual([{ targetPath: '.work-only', reason: 'not-applicable' }])
  })

  it('at Manual/Auto-sync the LEVEL gate auto-applies NOTHING (every File held as clean)', () => {
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })

    for (const level of ['manual', 'auto-sync'] as const) {
      const { autoApply: applied, needsReview } = engine.routeAutoApply(
        [{ targetPath: '.zshrc', status: 'incoming-clean' }],
        new AutomationPolicy(level),
        `trace-aa-${level}`,
      )
      // The very item Auto-apply WOULD land is instead held for ordinary review — the
      // manual contract: enabling a rung never retroactively changes prior behavior.
      expect(applied).toEqual([])
      expect(needsReview).toEqual([{ targetPath: '.zshrc', reason: 'clean' }])
    }
  })

  it('mixes them in one Sync: only the clean applicable item auto-applies, the rest are held', () => {
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })

    const { autoApply: applied, needsReview } = engine.routeAutoApply(
      [
        { targetPath: '.zshrc', status: 'incoming-clean' }, // ← auto-applies
        { targetPath: '.gitconfig', status: 'incoming-delete' }, // ← held (deletion)
        { targetPath: '.work-only', status: 'incoming-clean' }, // ← held (not-applicable)
      ],
      autoApply,
      'trace-aa-mixed',
    )

    expect(applied.map((i) => i.witness.targetPath)).toEqual(['.zshrc'])
    expect(needsReview).toContainEqual({ targetPath: '.gitconfig', reason: 'needs-confirmation' })
    expect(needsReview).toContainEqual({ targetPath: '.work-only', reason: 'not-applicable' })
  })

  it('property: an auto-applied item is ALWAYS clean+applicable+ready (never a risky one)', () => {
    // Drive randomized status/subscription/drift combos and assert EVERY auto-applied item
    // cleared all four owners — the composition guarantee a single example cannot give.
    const ids = ['personal', 'work', 'home']
    let appliedCount = 0
    let heldRisky = 0

    for (let seed = 0; seed < 400; seed++) {
      const rng = mulberry32(seed)
      const subscribed = ids.filter(() => rng() < 0.5)
      const placements = ids.flatMap((workspaceId, index) =>
        rng() < 0.4 ? [] : [{ targetPath: `.f${index}`, workspaceId, groupId: null, scope: null }],
      )
      const ws: WorkspacesDoc = {
        workspaces: ids.map((id) => ({ id, label: id, groups: [], scope: null })),
        placements,
      }
      const engine = new SyncEngine({ environment: env(subscribed), workspaces: ws })

      const dirty = new Set<string>()
      const incoming: IncomingFile[] = ids.map((_id, index) => {
        const path = `.f${index}`
        if (rng() < 0.3) dirty.add(path)
        const roll = rng()
        const status: IncomingFile['status'] =
          roll < 0.25 ? 'conflict' : roll < 0.5 ? 'incoming-delete' : 'incoming-clean'
        return { targetPath: path, status }
      })

      const { autoApply: applied, needsReview } = engine.routeAutoApply(
        incoming,
        autoApply,
        `t-aa-${seed}`,
        { uncommittedEdits: dirty },
      )

      for (const item of applied) {
        appliedCount++
        const path = item.witness.targetPath
        // Invariant #3: applicable (placed in a subscribed Workspace) — witness is real.
        expect(isAppliesHere(item.witness)).toBe(true)
        const placement = placements.find((p) => p.targetPath === path)
        expect(subscribed).toContain(placement?.workspaceId)
        // Invariant #1: never a Conflict.
        expect(incoming.find((f) => f.targetPath === path)?.status).not.toBe('conflict')
        // Invariant #4: never a deletion.
        expect(item.kind).not.toBe('delete')
        // Invariant #2: never a locally-edited (blocked) File.
        expect(item.blockedReason).toBeNull()
        expect(dirty.has(path)).toBe(false)
      }
      // Every conflict / deletion / blocked / non-applicable File is held — never applied.
      for (const held of needsReview) {
        if (held.reason !== 'clean') heldRisky++
        expect(applied.map((i) => i.witness.targetPath)).not.toContain(held.targetPath)
      }
    }

    // Sanity: the run actually exercised both auto-apply and held-back paths (not vacuous).
    expect(appliedCount).toBeGreaterThan(0)
    expect(heldRisky).toBeGreaterThan(0)
  })
})

describe('SyncEngine YOLO auto-Commit-before-merge routing (ADR 0008 named path, issue 2-13 load-bearing)', () => {
  // One subscribed Workspace ('personal'); '.work-only' is OUT of this env's subscription.
  const workspaces: WorkspacesDoc = {
    workspaces: [
      { id: 'personal', label: 'Personal', groups: [], scope: null },
      { id: 'work', label: 'Work', groups: [], scope: null },
    ],
    placements: [
      { targetPath: '.zshrc', workspaceId: 'personal', groupId: null, scope: null },
      { targetPath: '.gitconfig', workspaceId: 'personal', groupId: null, scope: null },
      { targetPath: '.work-only', workspaceId: 'work', groupId: null, scope: null },
    ],
  }

  it('at YOLO, plans an auto-Commit of the applicable local edits BEFORE merge (story 30)', () => {
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })

    const routing = engine.routeYoloPreMerge(
      ['.zshrc', '.gitconfig'],
      new AutomationPolicy('yolo'),
      'trace-yolo-precommit',
    )

    // The hands-off Commit is enabled and names exactly the applicable local edits — so they
    // become Commits BEFORE the merge and survive it (the never-lose-data invariant as action).
    expect(routing.autoCommitEnabled).toBe(true)
    expect([...routing.commitPaths].sort()).toEqual(['.gitconfig', '.zshrc'])
    expect(routing.skipped).toEqual([])
  })

  it('at every rung BELOW YOLO, auto-Commits NOTHING (Commit stays the user’s — ADR 0006)', () => {
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })

    for (const level of ['manual', 'auto-sync', 'auto-apply'] as const) {
      const routing = engine.routeYoloPreMerge(
        ['.zshrc'],
        new AutomationPolicy(level),
        `trace-precommit-${level}`,
      )
      // Below YOLO the LEVEL gate forbids the pre-merge auto-Commit entirely: nothing is
      // planned, so Commit remains a deliberate user action at those rungs.
      expect(routing.autoCommitEnabled).toBe(false)
      expect(routing.commitPaths).toEqual([])
    }
  })

  it('never auto-Commits an OUT-OF-SUBSCRIPTION local edit (invariant #3, even at YOLO)', () => {
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })

    const routing = engine.routeYoloPreMerge(
      ['.zshrc', '.work-only'],
      new AutomationPolicy('yolo'),
      'trace-yolo-na',
    )

    // Only the subscribed File is committed; the 'work' File this env doesn't subscribe to is
    // surfaced as skipped (not-applicable) — the hands-off Commit never sweeps in foreign drift.
    expect(routing.commitPaths).toEqual(['.zshrc'])
    expect(routing.skipped).toEqual([{ targetPath: '.work-only', reason: 'not-applicable' }])
  })

  it('a true Conflict is STILL never auto-resolved at YOLO — only branded user choices write', () => {
    // YOLO's auto-Commit-before-merge does NOT relax invariant #1. The merge that follows the
    // auto-Commit is routed through the SAME conflict-resolution gate every rung uses: an
    // un-branded (auto) "resolution" is refused, only a real ConflictModel.resolve passes.
    const engine = new SyncEngine({ environment: env(['personal']), workspaces })

    const userChoice = new ConflictModel({
      targetPath: '.zshrc',
      current: 'mine\n',
      incoming: 'theirs\n',
      both: '<<<<<<<\nmine\n=======\ntheirs\n>>>>>>>\n',
    }).resolve('current')
    const forgedAutoResolve = {
      targetPath: '.zshrc',
      choice: 'incoming' as const,
      bytes: 'theirs\n',
    } as unknown as ResolvedConflict

    const { writes, rejected } = engine.routeConflictResolution(
      [userChoice, forgedAutoResolve],
      'trace-yolo-conflict',
    )

    // The genuine user choice is accepted; the forged auto-resolution (what a "YOLO just picks
    // a side" regression would smuggle) is refused, never written.
    expect(writes.map((w) => w.targetPath)).toEqual(['.zshrc'])
    expect(writes.every((w) => isResolvedConflict(w))).toBe(true)
    expect(rejected).toEqual([{ targetPath: '.zshrc', reason: 'not-user-resolved' }])
  })

  it('property: every YOLO-committed path is applicable; below YOLO nothing is ever committed', () => {
    // Drive randomized subscription/placement/drift combos and assert the two YOLO guarantees
    // at the SyncEngine seam: (a) every auto-Committed path is in subscription (invariant #3),
    // and (b) no rung below YOLO ever auto-Commits anything (Commit stays the user's).
    const ids = ['personal', 'work', 'home']
    let committedCount = 0
    let skippedCount = 0

    for (let seed = 0; seed < 400; seed++) {
      const rng = mulberry32(seed)
      const subscribed = ids.filter(() => rng() < 0.5)
      const placements = ids.flatMap((workspaceId, index) =>
        rng() < 0.4 ? [] : [{ targetPath: `.f${index}`, workspaceId, groupId: null, scope: null }],
      )
      const ws: WorkspacesDoc = {
        workspaces: ids.map((id) => ({ id, label: id, groups: [], scope: null })),
        placements,
      }
      const engine = new SyncEngine({ environment: env(subscribed), workspaces: ws })

      // A random subset of the Files is locally edited (the local-drift axis).
      const localEdits = ids.map((_id, index) => `.f${index}`).filter(() => rng() < 0.6)

      // Below-YOLO rungs auto-Commit nothing, no matter the drift.
      for (const level of ['manual', 'auto-sync', 'auto-apply'] as const) {
        const r = engine.routeYoloPreMerge(
          localEdits,
          new AutomationPolicy(level),
          `t-${level}-${seed}`,
        )
        expect(r.autoCommitEnabled).toBe(false)
        expect(r.commitPaths).toEqual([])
      }

      // At YOLO, every committed path is applicable; every skipped one is genuinely out of subscription.
      const yolo = engine.routeYoloPreMerge(
        localEdits,
        new AutomationPolicy('yolo'),
        `t-yolo-${seed}`,
      )
      expect(yolo.autoCommitEnabled).toBe(true)
      for (const path of yolo.commitPaths) {
        committedCount++
        const placement = placements.find((p) => p.targetPath === path)
        // Invariant #3: the committed File is placed in a Workspace this env subscribes to.
        expect(placement).toBeDefined()
        expect(subscribed).toContain(placement?.workspaceId)
      }
      for (const s of yolo.skipped) {
        skippedCount++
        // A skipped edit is NOT in the committed set and is genuinely not applicable here.
        expect(yolo.commitPaths).not.toContain(s.targetPath)
        const placement = placements.find((p) => p.targetPath === s.targetPath)
        const applicable = placement !== undefined && subscribed.includes(placement.workspaceId)
        expect(applicable).toBe(false)
      }
    }

    // Sanity: the run actually exercised both committed and skipped paths (not vacuous).
    expect(committedCount).toBeGreaterThan(0)
    expect(skippedCount).toBeGreaterThan(0)
  })
})

/** Tiny deterministic PRNG (mulberry32) so the property test is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
