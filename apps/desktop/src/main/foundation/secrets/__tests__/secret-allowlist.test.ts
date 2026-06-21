/**
 * secret-allowlist — unit tests for the PURE per-File "don't warn" allowlist model (issue 2-04).
 *
 * The allowlist is the user's "I judged this File safe, stop nagging me" decision (story 16),
 * SYNCED across their environments (story 26) so it is not re-answered on every computer. The
 * security-critical contract this pins: an allowlist entry must NOT silently re-enable a real
 * leak — it is scoped **per File + the specific match** (kind + masked value), so a DIFFERENT
 * or NEW secret appearing in the same File later still warns. These tests prove exactly that
 * scoping at the pure-model seam (no I/O); the synced persistence is proven in
 * den-store.test.ts and the cross-environment behavior in den-service.e2e.test.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  addAllowlistEntry,
  findingFingerprint,
  isAllowlisted,
  partitionFindings,
} from '../secret-allowlist.js'
import type { SecretAllowlist } from '../../../../shared/secrets.js'
import type { SecretFinding } from '../../../../shared/secrets.js'

/** A finding fixture (the scanner's shape) with sensible defaults for terse tests. */
function finding(overrides: Partial<SecretFinding> = {}): SecretFinding {
  return {
    file: '.aws/credentials',
    kind: 'AWS Access Key ID',
    line: 2,
    maskedValue: 'AKIA••••••••N7QX',
    ...overrides,
  }
}

describe('findingFingerprint — the per-File+match scope key', () => {
  it('is identical for the same File + kind + masked value', () => {
    // Re-Committing the SAME secret in the SAME File must produce the SAME fingerprint, so a
    // prior "don't warn" decision keeps suppressing it.
    expect(findingFingerprint(finding())).toBe(findingFingerprint(finding()))
  })

  it('does NOT depend on the line number (a moved secret is the same secret)', () => {
    // Editing the File above the secret shifts its line; that is still the same value the user
    // already judged safe, so the fingerprint must ignore line.
    expect(findingFingerprint(finding({ line: 2 }))).toBe(findingFingerprint(finding({ line: 99 })))
  })

  it('differs when the masked value differs (a NEW secret in the same File)', () => {
    // The security crux: a different value in the same File is a different match and must get a
    // different fingerprint, so allowlisting the first never suppresses the second.
    expect(findingFingerprint(finding({ maskedValue: 'AKIA••••••••N7QX' }))).not.toBe(
      findingFingerprint(finding({ maskedValue: 'AKIA••••••••ZZZZ' })),
    )
  })

  it('differs when the kind differs (a different kind of secret in the same File)', () => {
    expect(findingFingerprint(finding({ kind: 'AWS Access Key ID' }))).not.toBe(
      findingFingerprint(finding({ kind: 'GitHub Token' })),
    )
  })

  it('differs when the File differs (the same value in a different File still warns)', () => {
    expect(findingFingerprint(finding({ file: '.aws/credentials' }))).not.toBe(
      findingFingerprint(finding({ file: '.env' })),
    )
  })
})

describe('isAllowlisted — suppression is scoped per File + match', () => {
  it('suppresses a finding whose fingerprint is on the allowlist', () => {
    const list = addAllowlistEntry({ entries: [] }, finding())
    expect(isAllowlisted(list, finding())).toBe(true)
  })

  it('does NOT suppress a NEW secret in an already-allowlisted File (no silent re-enable)', () => {
    // THE acceptance-criteria nuance: allowlisting `.aws/credentials`'s first key must not mute
    // a second, different key that appears in that same File later.
    const list = addAllowlistEntry({ entries: [] }, finding({ maskedValue: 'AKIA••••••••N7QX' }))
    expect(isAllowlisted(list, finding({ maskedValue: 'AKIA••••••••ZZZZ' }))).toBe(false)
  })

  it('does NOT suppress the same value once it moves to a different File', () => {
    const list = addAllowlistEntry({ entries: [] }, finding({ file: '.aws/credentials' }))
    expect(isAllowlisted(list, finding({ file: '.env' }))).toBe(false)
  })

  it('still suppresses after the secret moves lines (line is not part of the scope)', () => {
    const list = addAllowlistEntry({ entries: [] }, finding({ line: 2 }))
    expect(isAllowlisted(list, finding({ line: 40 }))).toBe(true)
  })
})

describe('addAllowlistEntry — append-only, de-duplicated, immutable', () => {
  it('records the File, kind, masked value and fingerprint (a human-auditable entry)', () => {
    const list = addAllowlistEntry({ entries: [] }, finding())
    expect(list.entries).toEqual([
      {
        file: '.aws/credentials',
        kind: 'AWS Access Key ID',
        maskedValue: 'AKIA••••••••N7QX',
        fingerprint: findingFingerprint(finding()),
      },
    ])
  })

  it('does not duplicate an entry already on the list (idempotent)', () => {
    const once = addAllowlistEntry({ entries: [] }, finding())
    const twice = addAllowlistEntry(once, finding())
    expect(twice.entries).toHaveLength(1)
  })

  it('keeps distinct matches as separate entries', () => {
    let list: SecretAllowlist = { entries: [] }
    list = addAllowlistEntry(list, finding({ maskedValue: 'AKIA••••••••N7QX' }))
    list = addAllowlistEntry(list, finding({ maskedValue: 'AKIA••••••••ZZZZ' }))
    expect(list.entries).toHaveLength(2)
  })

  it('does not mutate the input allowlist (pure)', () => {
    const input: SecretAllowlist = { entries: [] }
    addAllowlistEntry(input, finding())
    expect(input.entries).toEqual([])
  })
})

describe('partitionFindings — what the warn step shows vs. what the allowlist hides', () => {
  it('splits a scan into the findings to warn about and the ones already allowlisted', () => {
    const allowed = finding({ file: '.aws/credentials', maskedValue: 'AKIA••••••••N7QX' })
    const fresh = finding({ file: '.env', kind: 'GitHub Token', maskedValue: 'ghp_••••••••aaaa' })
    const list = addAllowlistEntry({ entries: [] }, allowed)

    const { toWarn, allowlisted } = partitionFindings(list, [allowed, fresh])

    expect(toWarn).toEqual([fresh])
    expect(allowlisted).toEqual([allowed])
  })

  it('returns every finding under toWarn when the allowlist is empty', () => {
    const findings = [finding(), finding({ file: '.env', maskedValue: 'ghp_••••••••aaaa' })]
    const { toWarn, allowlisted } = partitionFindings({ entries: [] }, findings)
    expect(toWarn).toEqual(findings)
    expect(allowlisted).toEqual([])
  })
})
