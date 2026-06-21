/**
 * Remote-axis decoration mapping — the SECOND status axis glyph (issue 1-09).
 *
 * The tree paints an independent Remote axis (↓ incoming / ⚠ conflict) beside the local
 * git-status letter. The mapping
 * from a File's Remote-axis marker to that overlay glyph is pure, so it is tested here
 * directly — no React, no DOM (this file runs in vitest's default node environment, like
 * the foundation tests).
 */
import { describe, expect, it } from 'vitest'
import type { RemoteAxisMarker } from '@shared/den'
import { remoteAxisDecoration, remoteAxisSummary } from '../remote-axis'

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

describe('remoteAxisSummary (issue 1-11)', () => {
  it('formats incoming totals with conflicts called out', () => {
    const axis = new Map<string, RemoteAxisMarker>([
      ['.zshrc', 'incoming'],
      ['.gitconfig', 'conflict'],
    ])

    expect(remoteAxisSummary(axis)).toBe('2 incoming, 1 conflict')
  })

  it('formats a clean incoming count without conflict copy', () => {
    const axis = new Map<string, RemoteAxisMarker>([['.zshrc', 'incoming']])

    expect(remoteAxisSummary(axis)).toBe('1 incoming')
  })

  it('formats an empty Remote axis as up to date', () => {
    expect(remoteAxisSummary(new Map())).toBe('Up to date')
  })
})
