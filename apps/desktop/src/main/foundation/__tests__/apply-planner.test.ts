/**
 * ApplyPlanner unit tests — the two `ApplyPlanner`-owned invariants (ADR 0008, issue 1-10).
 *
 * `ApplyPlanner` is the SOLE owner of:
 *   - **invariant #2** (never lose data silently): an incoming Apply for a File with an
 *     uncommitted local edit is **blocked**, not silently overwritten;
 *   - **invariant #4** (confirm incoming deletions): a `delete` is a first-class plan
 *     item that **requires explicit confirmation**, never applied silently.
 *
 * These exhaustively lock both, INCLUDING a property test that no blocked item is ever
 * left ready and no deletion ever skips confirmation, for randomized inputs. Witnesses
 * are minted through the real {@link ApplicabilityResolver} (the brand is module-private,
 * so tests cannot forge one) — exactly how `SyncEngine` obtains them in production.
 */
import { describe, expect, it } from 'vitest'
import {
  ApplicabilityResolver,
  isAppliesHere,
  type AppliesHere,
} from '../applicability-resolver.js'
import {
  blocked,
  deletions,
  planIncoming,
  planIncomingClean,
  ready,
  type IncomingChange,
} from '../apply-planner.js'
import type { EnvironmentEntry, WorkspacesDoc } from '../den-store.js'

/**
 * Mint a real {@link AppliesHere} witness for `targetPath` via the resolver — the only
 * way to get one (the brand is private). Every test path placed in `personal`, which the
 * environment subscribes to, so the witness is always issued.
 */
function witnessFor(targetPath: string): AppliesHere {
  const environment: EnvironmentEntry = {
    id: 'env-test',
    label: 'test',
    os: 'linux',
    subscribedWorkspaces: ['personal'],
  }
  const workspaces: WorkspacesDoc = {
    workspaces: [{ id: 'personal', label: 'Personal', groups: [], scope: null }],
    placements: [{ targetPath, workspaceId: 'personal', groupId: null, scope: null }],
  }
  const result = new ApplicabilityResolver(environment, workspaces).resolve(targetPath)
  if (!isAppliesHere(result)) throw new Error(`test setup: ${targetPath} should be applicable`)
  return result
}

describe('ApplyPlanner — invariant #2 (uncommitted-edit guard)', () => {
  it('blocks an incoming update to a File with an uncommitted local edit (never silently overwrites)', () => {
    const change: IncomingChange = { witness: witnessFor('.zshrc'), kind: 'update' }
    const plan = planIncoming([change], { uncommittedEdits: new Set(['.zshrc']) })

    // The item is present (surfaced) but BLOCKED — it is never silently written.
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]?.blockedReason).toBe('uncommitted-edit')
    // It is excluded from the ready set and listed in the blocked set.
    expect(ready(plan)).toHaveLength(0)
    expect(blocked(plan).map((i) => i.witness.targetPath)).toEqual(['.zshrc'])
  })

  it('does NOT block an incoming change to a File with no local edit', () => {
    const change: IncomingChange = { witness: witnessFor('.zshrc'), kind: 'update' }
    const plan = planIncoming([change], { uncommittedEdits: new Set() })

    expect(plan.items[0]?.blockedReason).toBeNull()
    expect(ready(plan).map((i) => i.witness.targetPath)).toEqual(['.zshrc'])
    expect(blocked(plan)).toHaveLength(0)
  })

  it('treats a missing LocalEditState as "no local edits" (a fresh env B has nothing dirty)', () => {
    const plan = planIncoming([{ witness: witnessFor('.zshrc'), kind: 'create' }])
    expect(plan.items[0]?.blockedReason).toBeNull()
    expect(ready(plan)).toHaveLength(1)
  })

  it('blocks ONLY the dirty Files in a mixed batch — the clean ones still apply', () => {
    const plan = planIncoming(
      [
        { witness: witnessFor('.zshrc'), kind: 'update' },
        { witness: witnessFor('.gitconfig'), kind: 'update' },
      ],
      { uncommittedEdits: new Set(['.zshrc']) },
    )
    expect(blocked(plan).map((i) => i.witness.targetPath)).toEqual(['.zshrc'])
    expect(ready(plan).map((i) => i.witness.targetPath)).toEqual(['.gitconfig'])
  })
})

describe('ApplyPlanner — invariant #4 (confirm incoming deletions)', () => {
  it('emits a deletion as a first-class plan item that requires confirmation', () => {
    const plan = planIncoming([{ witness: witnessFor('.zshrc'), kind: 'delete' }])

    // The deletion is NOT dropped — it is a real plan item the user reviews…
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]?.kind).toBe('delete')
    // …and it requires explicit confirmation before it can be applied.
    expect(plan.items[0]?.requiresConfirmation).toBe(true)
    expect(deletions(plan)).toHaveLength(1)
  })

  it('does not require confirmation for create/update (only deletions are gated)', () => {
    const plan = planIncoming([
      { witness: witnessFor('.zshrc'), kind: 'create' },
      { witness: witnessFor('.gitconfig'), kind: 'update' },
    ])
    expect(plan.items.every((i) => i.requiresConfirmation === false)).toBe(true)
    expect(deletions(plan)).toHaveLength(0)
  })

  it('a deletion blocked by a local edit is BOTH blocked AND confirm-required (both invariants compose)', () => {
    const plan = planIncoming([{ witness: witnessFor('.zshrc'), kind: 'delete' }], {
      uncommittedEdits: new Set(['.zshrc']),
    })
    expect(plan.items[0]?.blockedReason).toBe('uncommitted-edit')
    expect(plan.items[0]?.requiresConfirmation).toBe(true)
    // Blocked wins for "ready": a deletion that would clobber a local edit is never ready.
    expect(ready(plan)).toHaveLength(0)
  })
})

describe('ApplyPlanner — planIncomingClean (MVP create path, built on planIncoming)', () => {
  it('produces a ready, no-confirm create per witness', () => {
    const plan = planIncomingClean([witnessFor('.zshrc'), witnessFor('.gitconfig')])
    expect(plan.items.map((i) => i.kind)).toEqual(['create', 'create'])
    expect(plan.items.every((i) => i.blockedReason === null)).toBe(true)
    expect(plan.items.every((i) => i.requiresConfirmation === false)).toBe(true)
    expect(ready(plan)).toHaveLength(2)
  })
})

describe('ApplyPlanner — property: the two invariants hold for randomized plans', () => {
  it('every blocked item is excluded from ready, and every deletion requires confirmation', () => {
    let blockedSeen = 0
    let deletionsSeen = 0

    for (let seed = 0; seed < 500; seed++) {
      const rng = mulberry32(seed)
      const kinds: IncomingChange['kind'][] = ['create', 'update', 'delete']
      const changes: IncomingChange[] = []
      const dirty = new Set<string>()
      const count = 1 + Math.floor(rng() * 5)
      for (let i = 0; i < count; i++) {
        const path = `.file-${i}`
        changes.push({ witness: witnessFor(path), kind: kinds[Math.floor(rng() * 3)]! })
        if (rng() < 0.4) dirty.add(path)
      }
      const plan = planIncoming(changes, { uncommittedEdits: dirty })

      for (const item of plan.items) {
        // Invariant #2: a File with a local edit is ALWAYS blocked, never silently applied.
        if (dirty.has(item.witness.targetPath)) {
          expect(item.blockedReason).toBe('uncommitted-edit')
          blockedSeen++
        }
        // Invariant #4: a deletion ALWAYS requires confirmation.
        if (item.kind === 'delete') {
          expect(item.requiresConfirmation).toBe(true)
          deletionsSeen++
        }
        // A blocked item is never in the ready set (cannot be silently overwritten).
        if (item.blockedReason !== null) {
          expect(ready(plan)).not.toContain(item)
        }
      }
      // The witness gate held: every item carries a real witness (invariant #3 consumed).
      expect(plan.items.every((i) => isAppliesHere(i.witness))).toBe(true)
    }

    // The randomized run actually exercised both invariants (not vacuous).
    expect(blockedSeen).toBeGreaterThan(0)
    expect(deletionsSeen).toBeGreaterThan(0)
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
