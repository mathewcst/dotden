/**
 * chezmoi-status parser tests — the pure local-axis translator (issue 1-07).
 *
 * Locks the faithful mapping from `chezmoi status` porcelain (`XY <path>`) onto the
 * dotden local axis the three-pane tree decorates with (the 1-00 spike recipe).
 * Per `chezmoi help status` (verified empirically against the bundled binary):
 * column 1 / X = last-written-vs-actual = the LOCAL edit on this environment;
 * column 2 / Y = actual-vs-target = what `chezmoi apply` will do = the INCOMING axis
 * (issue 1-09). The local axis here reads column **X only** — an incoming-only change
 * (X blank) must NOT decorate this axis. The exact two-column strings below are the
 * real shapes the bundled chezmoi v2 emits (captured against the binary).
 */
import { describe, expect, it } from 'vitest'
import {
  parseChezmoiStatus,
  parseIncomingApplyChanges,
  parseIncomingDeletions,
} from '../chezmoi-status.js'

describe('parseChezmoiStatus', () => {
  it('maps a locally modified File (MM) to modified', () => {
    // `MM .zshrc`: X=M (local edit) and Y=M (apply will modify) agree — modified.
    expect(parseChezmoiStatus('MM .zshrc\n')).toEqual([{ path: '.zshrc', status: 'modified' }])
  })

  it('maps a locally deleted File (DA) to deleted from column X', () => {
    // `DA .gitconfig`: X=D (the user deleted it locally), Y=A (apply would re-add it).
    // The local axis reads X → deleted; folding in Y would mislabel it "added".
    expect(parseChezmoiStatus('DA .gitconfig\n')).toEqual([
      { path: '.gitconfig', status: 'deleted' },
    ])
  })

  it('omits an incoming-only add (" A path") — no local edit, so no local decoration', () => {
    // ` A .vimrc`: X=blank (the user touched nothing), Y=A (apply will add it). That
    // incoming axis belongs to issue 1-09, so the local axis emits nothing here.
    expect(parseChezmoiStatus(' A .vimrc\n')).toEqual([])
  })

  it('omits an incoming-only modify (" M path") — no local edit, so no local decoration', () => {
    // ` M .zshrc`: X=blank, Y=M (apply will modify). Purely incoming → local axis empty.
    expect(parseChezmoiStatus(' M .zshrc\n')).toEqual([])
  })

  it('omits a pending run-script row (" R path") — R lives only in the incoming column', () => {
    // Per chezmoi's table `R` is "Not applicable" to column 1; it only ever appears in
    // column 2 (the incoming axis). So on the local axis a run-script row decorates
    // nothing here (it surfaces in issue 1-09's Remote axis).
    expect(parseChezmoiStatus(' R run_once_install.sh\n')).toEqual([])
  })

  it('parses multiple lines preserving order, keeping only rows with a local change', () => {
    // A local delete, an incoming-only add (dropped), and a local modify, in order.
    const raw = 'DA .gitconfig\n A .vimrc\nMM .zshrc\n'
    expect(parseChezmoiStatus(raw)).toEqual([
      { path: '.gitconfig', status: 'deleted' },
      { path: '.zshrc', status: 'modified' },
    ])
  })

  it('handles nested destination-relative paths', () => {
    expect(parseChezmoiStatus('MM .config/nvim/init.lua\n')).toEqual([
      { path: '.config/nvim/init.lua', status: 'modified' },
    ])
  })

  it('returns an empty list for empty, whitespace, or change-free output', () => {
    expect(parseChezmoiStatus('')).toEqual([])
    expect(parseChezmoiStatus('\n\n')).toEqual([])
  })

  it('skips lines with no recognizable status in the local (X) column', () => {
    // An unknown X column and a path → no local status to assign, so the row is
    // dropped (degrade to "no decoration" rather than throw).
    expect(parseChezmoiStatus('?? .junk\n')).toEqual([])
  })
})

describe('parseIncomingDeletions (incoming-deletion axis, issue 1-10)', () => {
  it('keeps a File chezmoi will delete on apply (column Y = D)', () => {
    // ` D .zshrc`: X=blank (no local edit), Y=D (the source removed it → apply deletes it).
    expect(parseIncomingDeletions(' D .zshrc\n')).toEqual(['.zshrc'])
  })

  it('ignores a LOCAL delete (X=D) — that is the local axis, not an incoming deletion', () => {
    // `DA .gitconfig`: X=D (the USER deleted it locally), Y=A (apply would re-add). This is
    // not an incoming deletion — reading column Y (A) correctly excludes it.
    expect(parseIncomingDeletions('DA .gitconfig\n')).toEqual([])
  })

  it('ignores incoming creates/modifies (Y = A / M)', () => {
    expect(parseIncomingDeletions(' A .vimrc\n M .zshrc\n')).toEqual([])
  })

  it('extracts only the will-be-deleted rows from mixed output, preserving order', () => {
    const raw = ' D .zshrc\n A .vimrc\n D .config/foo\nMM .gitconfig\n'
    expect(parseIncomingDeletions(raw)).toEqual(['.zshrc', '.config/foo'])
  })

  it('returns an empty list for empty or change-free output', () => {
    expect(parseIncomingDeletions('')).toEqual([])
    expect(parseIncomingDeletions('\n\n')).toEqual([])
  })
})

describe('parseIncomingApplyChanges (incoming Review & Apply axis)', () => {
  it('reads column Y as add/modify/delete changes', () => {
    expect(
      [...parseIncomingApplyChanges(' A .vimrc\n M .zshrc\n D .oldrc\nDA .gitconfig\n')],
    ).toEqual([
      ['.vimrc', 'add'],
      ['.zshrc', 'modify'],
      ['.oldrc', 'delete'],
      ['.gitconfig', 'add'],
    ])
  })

  it('ignores rows with no apply-direction change', () => {
    expect([...parseIncomingApplyChanges('M  .zshrc\n R run_once.sh\n')]).toEqual([])
  })
})
