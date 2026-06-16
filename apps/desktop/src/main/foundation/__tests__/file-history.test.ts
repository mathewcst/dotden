/**
 * FileHistory parser — the pure transform behind the History tab (issue 2-01).
 *
 * These tests pin the rules the renderer depends on WITHOUT a real repo: ordering
 * (newest first), the Current flag (newest only), short-SHA derivation, the empty-input
 * (no-history) case, and total parsing of malformed lines. The real `git log` →
 * `fileHistory` wiring is proven separately in the den-service e2e test.
 */
import { describe, expect, it } from 'vitest'
import { parseFileHistory, shortSha } from '../file-history.js'

/** Build one `git log` line in the exact `%H␟%an␟%ae␟%aI␟%s` format GitTransport emits. */
function logLine(
  sha: string,
  author: string,
  email: string,
  date: string,
  subject: string,
): string {
  return [sha, author, email, date, subject].join('\x1f')
}

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const SHA_C = 'c'.repeat(40)

describe('parseFileHistory', () => {
  it('returns an empty list for an empty or whitespace log (no committed history yet)', () => {
    expect(parseFileHistory('')).toEqual([])
    expect(parseFileHistory('   \n  ')).toEqual([])
  })

  it('parses each commit field and keeps git log’s newest-first order', () => {
    const raw = [
      logLine(
        SHA_A,
        'this-mac',
        'me@example.test',
        '2026-06-16T10:30:00-03:00',
        'Sync nvim plugins',
      ),
      logLine(SHA_B, 'work-laptop', 'me@example.test', '2026-06-15T09:00:00-03:00', 'Add aliases'),
    ].join('\n')
    const versions = parseFileHistory(raw)
    expect(versions).toHaveLength(2)
    expect(versions[0]).toMatchObject({
      sha: SHA_A,
      shortSha: 'aaaaaaa',
      message: 'Sync nvim plugins',
      authorName: 'this-mac',
      authorEmail: 'me@example.test',
      committedAt: '2026-06-16T10:30:00-03:00',
      current: true,
    })
    // The order is preserved (newest first); only the second entry differs.
    expect(versions[1]).toMatchObject({ sha: SHA_B, message: 'Add aliases', current: false })
  })

  it('flags ONLY the newest version as Current (the version matching the current Den state)', () => {
    const raw = [
      logLine(SHA_A, 'a', 'a@x', '2026-06-16T10:00:00Z', 'newest'),
      logLine(SHA_B, 'b', 'b@x', '2026-06-15T10:00:00Z', 'middle'),
      logLine(SHA_C, 'c', 'c@x', '2026-06-14T10:00:00Z', 'oldest'),
    ].join('\n')
    const versions = parseFileHistory(raw)
    expect(versions.map((v) => v.current)).toEqual([true, false, false])
    // Exactly one Current in a non-empty list.
    expect(versions.filter((v) => v.current)).toHaveLength(1)
  })

  it('derives a 7-char short SHA from the full SHA', () => {
    const versions = parseFileHistory(
      logLine('7b1e44abcdef0000000000000000000000000000', 'x', 'x@x', '2026-06-16T00:00:00Z', 'm'),
    )
    expect(versions[0]?.shortSha).toBe('7b1e44a')
  })

  it('parses a malformed line totally — missing fields degrade to empty strings, never crash', () => {
    // A line with only a SHA (no separators) must not throw; missing fields become empty.
    const versions = parseFileHistory(SHA_A)
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({
      sha: SHA_A,
      shortSha: 'aaaaaaa',
      message: '',
      authorName: '',
      authorEmail: '',
      committedAt: '',
      current: true,
    })
  })
})

describe('shortSha', () => {
  it('takes the first 7 chars of a full SHA', () => {
    expect(shortSha(SHA_A)).toBe('aaaaaaa')
  })

  it('returns a short or empty value unchanged (the malformed fallback)', () => {
    expect(shortSha('abc')).toBe('abc')
    expect(shortSha('')).toBe('')
  })
})
