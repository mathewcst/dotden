/**
 * SecretAllowlist — the PURE per-File "don't warn" allowlist model (issue 2-04).
 *
 * Step 1 of the secret flow gives the user a deliberate two-option choice (secret-and-errors
 * screen spec): **Convert to a Secret reference** (recommended) or **Commit the secret anyway**.
 * Under "Commit anyway" the user may tick **"Don't warn me about this File again"** so a File
 * they have consciously judged safe stops nagging on every future Commit (story 16). Because
 * that judgement is user-authored organization-of-trust, it **syncs** across the user's
 * environments through the chezmoi-ignored `.dotden/` directory (story 26, ADR 0024) — the same
 * prompt is never re-answered on a second computer.
 *
 * The security-critical design constraint (the issue's headline): the allowlist must **not
 * silently re-enable a real leak**. So an entry is scoped **per File + the specific match**
 * (kind + masked value), NOT per File alone and NEVER a global kill-switch for the scanner:
 *
 * - Allowlisting `.aws/credentials`'s flagged AWS key suppresses *that* finding on later
 *   Commits — but a **different/new** secret that appears in the same File still warns, because
 *   its fingerprint differs. A blanket per-File mute would let a fresh credential slip in raw
 *   behind a stale "I trust this file" decision; that is exactly the leak we refuse to enable.
 * - The same value moving to a *different* File still warns (a copy-paste leak is a new place).
 * - The line number is deliberately **excluded** from the scope: editing the File above the
 *   secret shifts its line, but it is the same value the user already judged safe.
 *
 * This module is PURE (no I/O, no shell) so the scoping invariant is trivially unit-testable at
 * the model seam. The synced persistence lives in {@link import('./den-store.js').DenStore}
 * (`.dotden/secret-allowlist.json`), and the commit-time filtering in
 * {@link import('./den-service.js').DenService.scanCommit}.
 */
import { createHash } from 'node:crypto'
import type { SecretFinding } from '../../../shared/secrets.js'
import type { SecretAllowlist } from '../../../shared/secrets.js'

/** An empty allowlist — the default before the user has dismissed any finding. */
export const EMPTY_SECRET_ALLOWLIST: SecretAllowlist = { entries: [] }

/**
 * The stable **per-File + match** fingerprint of a finding — the allowlist's match key.
 *
 * Derived from `file` + `kind` + `maskedValue` (NOT `line`), so:
 * - the SAME secret in the SAME File fingerprints identically across Commits (a prior "don't
 *   warn" decision keeps suppressing it) even after it moves lines;
 * - a DIFFERENT value (different `maskedValue`), a different `kind`, or a different `file`
 *   fingerprints differently, so allowlisting one match never suppresses another — the
 *   guarantee that a new/real leak is never silently re-enabled.
 *
 * A short SHA-256 hex digest of a `\0`-joined tuple: collision-resistant and order-stable, and
 * the `\0` separator keeps `a|b` from colliding with `ab|`. Hashing the masked (not raw) value
 * is safe and sufficient — distinct secrets mask distinctly enough for a per-File scope, and we
 * never want the raw value in the synced fingerprint.
 *
 * @param finding A scanner finding.
 * @returns A hex fingerprint string used as the allowlist match key.
 */
export function findingFingerprint(finding: SecretFinding): string {
  return createHash('sha256')
    .update([finding.file, finding.kind, finding.maskedValue].join('\0'))
    .digest('hex')
    .slice(0, 16)
}

/**
 * Whether a finding is suppressed by the allowlist — true iff its {@link findingFingerprint} is
 * already on the list. This is the single predicate the commit-time scan consults to decide
 * whether the warn step still opens for a finding.
 *
 * @param allowlist The current (synced) allowlist.
 * @param finding A fresh scan finding.
 * @returns True when the user already chose "don't warn about this File again" for THIS match.
 */
export function isAllowlisted(allowlist: SecretAllowlist, finding: SecretFinding): boolean {
  const fingerprint = findingFingerprint(finding)
  return allowlist.entries.some((entry) => entry.fingerprint === fingerprint)
}

/**
 * Add a finding to the allowlist — the "Don't warn me about this File again" action.
 *
 * Pure + immutable: returns a NEW allowlist, never mutates the input. De-duplicates on
 * fingerprint so ticking the box twice (or re-Committing the same already-allowlisted secret)
 * never grows the synced JSON. The entry stores the human-auditable `file`/`kind`/`maskedValue`
 * alongside the `fingerprint` so the synced file stays legible.
 *
 * @param allowlist The current allowlist.
 * @param finding The finding the user judged safe.
 * @returns A new allowlist with the finding's match recorded (idempotent).
 */
export function addAllowlistEntry(
  allowlist: SecretAllowlist,
  finding: SecretFinding,
): SecretAllowlist {
  const fingerprint = findingFingerprint(finding)
  if (allowlist.entries.some((entry) => entry.fingerprint === fingerprint)) {
    // Already allowlisted — return the list unchanged so a repeat tick produces no git churn.
    return allowlist
  }
  return {
    entries: [
      ...allowlist.entries,
      { file: finding.file, kind: finding.kind, maskedValue: finding.maskedValue, fingerprint },
    ],
  }
}

/** The two halves of a scan once the allowlist has been applied. */
export interface PartitionedFindings {
  /** Findings the warn step must still surface (not allowlisted). */
  readonly toWarn: readonly SecretFinding[]
  /** Findings the allowlist already suppressed (kept for instrumentation/auditing only). */
  readonly allowlisted: readonly SecretFinding[]
}

/**
 * Split a raw scan into the findings the warn step must surface and the ones the allowlist
 * already hides. The commit-time scan returns only `toWarn`; `allowlisted` is kept so the
 * caller can count "N suppressed by allowlist" without ever leaking the values.
 *
 * @param allowlist The current (synced) allowlist.
 * @param findings Every finding the pure scanner produced.
 * @returns The findings to warn about and the ones the allowlist suppressed.
 */
export function partitionFindings(
  allowlist: SecretAllowlist,
  findings: readonly SecretFinding[],
): PartitionedFindings {
  const toWarn: SecretFinding[] = []
  const allowlisted: SecretFinding[] = []
  for (const finding of findings) {
    if (isAllowlisted(allowlist, finding)) allowlisted.push(finding)
    else toWarn.push(finding)
  }
  return { toWarn, allowlisted }
}
