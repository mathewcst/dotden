/**
 * secret-warn — unit tests for the onboarding Discover warn-derivation (issue 2-07).
 *
 * The Discover step shows the amber `Warn` state ("Secret · review at commit") on scanned
 * Files the SecretScanner flagged. {@link warnedPathsFromFindings} is the load-bearing pure
 * seam that turns the commit-scan finding list into the set of File paths to flag. These
 * tests pin the issue's acceptance behaviour at that seam (warn is per-File, never excluding):
 *
 * - findings collapse to the **set of Files** (a File with many secrets is one warned row);
 * - a File with NO finding is NOT in the set (it stays a neutral, non-warned row);
 * - an empty finding list flags nothing (clean scan → every row neutral);
 * - the marking never deselects/removes — it only reports membership (data, not behaviour).
 */
import { describe, expect, it } from 'vitest'
import { warnedPathsFromFindings } from '../secret-warn'
import type { SecretFinding } from '../../../../main/foundation/secret-scanner'

/** Build a minimal finding for a File — only `file` is load-bearing for the derivation. */
function finding(file: string, line = 1): SecretFinding {
  return { file, kind: 'AWS Access Key ID', line, maskedValue: 'AKIA••••••••••••N7QX' }
}

describe('warnedPathsFromFindings', () => {
  it('returns the set of Files that have at least one finding', () => {
    const warned = warnedPathsFromFindings([finding('.aws/credentials'), finding('.netrc')])
    expect(warned.has('.aws/credentials')).toBe(true)
    expect(warned.has('.netrc')).toBe(true)
    expect(warned.size).toBe(2)
  })

  it('collapses multiple findings in one File to a single warned path (warn is per-File)', () => {
    const warned = warnedPathsFromFindings([
      finding('.aws/credentials', 3),
      finding('.aws/credentials', 7),
      finding('.aws/credentials', 11),
    ])
    expect(warned.size).toBe(1)
    expect(warned.has('.aws/credentials')).toBe(true)
  })

  it('does NOT flag a File that has no finding (it stays a neutral, selectable row)', () => {
    const warned = warnedPathsFromFindings([finding('.aws/credentials')])
    // A clean File the discovery scan also found is simply absent from the set.
    expect(warned.has('.zshrc')).toBe(false)
  })

  it('flags nothing for a clean scan (empty findings → every row neutral)', () => {
    expect(warnedPathsFromFindings([]).size).toBe(0)
  })
})
