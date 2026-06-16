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
import { isAppliesHere } from '../applicability-resolver.js'
import type { EnvironmentEntry, WorkspacesDoc } from '../myenv-store.js'
import { SyncEngine, type IncomingFile } from '../sync-engine.js'

/** Build an environment entry subscribed to the given Workspaces. */
function env(subscribedWorkspaces: string[]): EnvironmentEntry {
  return { id: 'env-test', label: 'test', os: 'linux', subscribedWorkspaces }
}

describe('SyncEngine incoming-clean routing (ADR 0008 load-bearing)', () => {
  it('plans Apply only for incoming-clean Files in a subscribed Workspace', () => {
    const workspaces: WorkspacesDoc = {
      workspaces: [
        { id: 'personal', label: 'Personal', groups: [] },
        { id: 'work', label: 'Work', groups: [] },
      ],
      placements: [
        { targetPath: '.zshrc', workspaceId: 'personal', groupId: null },
        { targetPath: '.work-only', workspaceId: 'work', groupId: null },
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
      workspaces: [{ id: 'personal', label: 'Personal', groups: [] }],
      placements: [{ targetPath: '.zshrc', workspaceId: 'personal', groupId: null }],
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
      workspaces: [{ id: 'personal', label: 'Personal', groups: [] }],
      placements: [{ targetPath: '.zshrc', workspaceId: 'personal', groupId: null }],
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
      workspaces: [{ id: 'personal', label: 'Personal', groups: [] }],
      placements: [{ targetPath: '.zshrc', workspaceId: 'personal', groupId: null }],
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
        { id: 'personal', label: 'Personal', groups: [] },
        { id: 'work', label: 'Work', groups: [] },
      ],
      placements: [{ targetPath: '.work-only', workspaceId: 'work', groupId: null }],
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
        return [{ targetPath: `.file-${index}`, workspaceId, groupId: null }]
      })
      const workspaces: WorkspacesDoc = {
        workspaces: workspaceIds.map((id) => ({ id, label: id, groups: [] })),
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
