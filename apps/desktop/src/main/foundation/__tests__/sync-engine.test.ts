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
        { id: 'personal', label: 'Personal' },
        { id: 'work', label: 'Work' },
      ],
      placements: [
        { targetPath: '.zshrc', workspaceId: 'personal' },
        { targetPath: '.work-only', workspaceId: 'work' },
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
      workspaces: [{ id: 'personal', label: 'Personal' }],
      placements: [{ targetPath: '.zshrc', workspaceId: 'personal' }],
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

  it('property: no planned item is ever for a non-applicable File or a Conflict', () => {
    // Exhaustively-ish drive randomized subscription/placement/status combinations
    // and assert the two invariants hold for EVERY planned item — this is the
    // composition guarantee a single example test cannot give.
    const workspaceIds = ['personal', 'work', 'home']
    let cases = 0

    for (let seed = 0; seed < 400; seed++) {
      const rng = mulberry32(seed)
      const subscribed = workspaceIds.filter(() => rng() < 0.5)
      const placements = workspaceIds.flatMap((workspaceId, index) => {
        if (rng() < 0.4) return []
        return [{ targetPath: `.file-${index}`, workspaceId }]
      })
      const workspaces: WorkspacesDoc = {
        workspaces: workspaceIds.map((id) => ({ id, label: id })),
        placements,
      }
      const engine = new SyncEngine({ environment: env(subscribed), workspaces })

      const incoming: IncomingFile[] = workspaceIds.map((_id, index) => ({
        targetPath: `.file-${index}`,
        status: rng() < 0.3 ? 'conflict' : 'incoming-clean',
      }))
      const { plan } = engine.routeIncomingClean(incoming, `trace-prop-${seed}`)

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
        expect(status).toBe('incoming-clean')
      }
    }

    // Sanity: the randomized run actually planned some Applies (the test is not vacuous).
    expect(cases).toBeGreaterThan(0)
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
