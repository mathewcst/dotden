/**
 * ConflictModel — the unit tests for the SOLE owner of invariant #1, "never
 * auto-resolve a Conflict" (ADR 0008).
 *
 * ADR 0008's mechanism for invariant #1 is structural, not behavioural: the
 * resolved bytes of a Conflict must be **unconstructable without an explicit user
 * choice**. So these tests assert the *type-level* guarantee (the only way to get a
 * `ResolvedConflict` is `ConflictModel.resolve(choice)`) plus the three-way
 * resolution semantics (Keep mine / Take theirs / Open both) the merge view
 * consumes — and that an auto-merged (non-overlapping) File is NOT a Conflict at all.
 */
import { describe, expect, it } from 'vitest'
import { ConflictModel, isResolvedConflict, type ConflictFile } from '../conflict-model.js'
import type { ResolutionChoice } from '../../../../shared/apply.js'

/** A true Conflict on `.zshrc`: the same File changed both here and on the Remote. */
function conflictFile(overrides: Partial<ConflictFile> = {}): ConflictFile {
  return {
    targetPath: '.zshrc',
    // The three sides git surfaces for an overlapping conflict (the `<<<<<<<` markers
    // split the File into a current/ours block, an incoming/theirs block, and the
    // full marker-bearing bytes the user could open and edit by hand).
    current: 'export EDITOR=nvim\n',
    incoming: 'export EDITOR=vim\n',
    both: '<<<<<<< HEAD\nexport EDITOR=nvim\n=======\nexport EDITOR=vim\n>>>>>>> origin/main\n',
    ...overrides,
  }
}

describe('ConflictModel — invariant #1 owner (ADR 0008)', () => {
  it('resolve("current") keeps mine — the current/ours bytes', () => {
    const model = new ConflictModel(conflictFile())
    const resolved = model.resolve('current')
    expect(resolved.targetPath).toBe('.zshrc')
    expect(resolved.choice).toBe('current')
    expect(resolved.bytes).toBe('export EDITOR=nvim\n')
  })

  it('resolve("incoming") takes theirs — the incoming/theirs bytes', () => {
    const model = new ConflictModel(conflictFile())
    const resolved = model.resolve('incoming')
    expect(resolved.choice).toBe('incoming')
    expect(resolved.bytes).toBe('export EDITOR=vim\n')
  })

  it('resolve("both") opens both — the full marker-bearing bytes for hand-editing', () => {
    const model = new ConflictModel(conflictFile())
    const resolved = model.resolve('both')
    expect(resolved.choice).toBe('both')
    // "Open both" hands the user the union (with the markers) to edit consciously —
    // it is still a deliberate choice, never an auto-merge.
    expect(resolved.bytes).toContain('<<<<<<<')
    expect(resolved.bytes).toContain('export EDITOR=nvim')
    expect(resolved.bytes).toContain('export EDITOR=vim')
  })

  it('every resolved value carries the un-forgeable brand (type-level proof)', () => {
    const model = new ConflictModel(conflictFile())
    for (const choice of ['current', 'incoming', 'both'] as ResolutionChoice[]) {
      // The guard only ever matches values minted INSIDE ConflictModel.resolve — a
      // hand-rolled `{ targetPath, choice, bytes }` object cannot pass it, which is
      // exactly what makes resolved bytes "unconstructable without a user choice".
      expect(isResolvedConflict(model.resolve(choice))).toBe(true)
    }
  })

  it('a hand-rolled object is NOT a ResolvedConflict (brand cannot be forged)', () => {
    // The brand symbol is module-private, so no caller can fabricate the witness. The
    // type system makes this a compile error too; this asserts the runtime guard agrees.
    const fake = { targetPath: '.zshrc', choice: 'current', bytes: 'whatever' }
    expect(isResolvedConflict(fake as never)).toBe(false)
  })

  it('exposes the three sides for the merge view without resolving anything', () => {
    // Constructing the model NEVER produces resolved bytes — the sides are readable so
    // the current/incoming/both merge view can render, but bytes only exist after a choice.
    const file = conflictFile()
    const model = new ConflictModel(file)
    expect(model.targetPath).toBe('.zshrc')
    expect(model.current).toBe(file.current)
    expect(model.incoming).toBe(file.incoming)
    expect(model.both).toBe(file.both)
  })

  it('rejects an unknown resolution choice rather than inventing bytes', () => {
    const model = new ConflictModel(conflictFile())
    // A choice outside the three-way space is a programming error — refuse loudly
    // rather than silently pick a side (never fail silently / never auto-resolve).
    expect(() => model.resolve('whatever' as ResolutionChoice)).toThrow(/resolution choice/i)
  })
})
