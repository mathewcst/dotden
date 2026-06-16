/**
 * Remote-axis decoration mapping — the SECOND status axis glyph (issue 1-09).
 *
 * The tree paints an independent Remote axis (↓ incoming / ⚠ conflict) beside the local
 * git-status letter via `renderRowDecoration` (geometry per the 1-00 spike). The mapping
 * from a File's Remote-axis marker to that overlay glyph is pure, so it is tested here
 * directly — no React, no DOM (this file runs in vitest's default node environment, like
 * the foundation tests).
 */
import { describe, expect, it } from 'vitest'
import { remoteAxisDecoration } from '../remote-axis.js'

describe('remoteAxisDecoration (issue 1-09)', () => {
  it('maps an incoming marker to the ↓ glyph with an explaining tooltip', () => {
    const decoration = remoteAxisDecoration('incoming')
    expect(decoration?.text).toBe('↓')
    expect(decoration?.title).toMatch(/incoming/i)
  })

  it('maps a conflict marker to the ⚠ glyph with an explaining tooltip', () => {
    const decoration = remoteAxisDecoration('conflict')
    expect(decoration?.text).toBe('⚠')
    expect(decoration?.title).toMatch(/conflict/i)
  })

  it('returns null when nothing is incoming (no Remote-axis overlay glyph)', () => {
    // A File with no incoming marker must not paint a Remote-axis glyph, so the local
    // git-status letter is the only thing in the row's status cluster.
    expect(remoteAxisDecoration(undefined)).toBeNull()
  })
})
