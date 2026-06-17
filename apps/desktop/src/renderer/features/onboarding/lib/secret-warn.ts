/**
 * secret-warn — the PURE warn-derivation for the onboarding Discover step (issue 2-07).
 *
 * This is the load-bearing logic that reconciles the SecretScanner (issue 2-03) into the
 * onboarding Discover-row framing. The renderer runs the commit-time scanner over the
 * **discovered** Files (the same `window.dotden.den.scanCommit` path the Commit step uses —
 * no parallel detector), gets back a flat list of {@link SecretFinding}s, and needs to know
 * **which Discover rows should show the amber `Warn` state** ("Secret · review at commit").
 *
 * The warn model is **per-File, not per-finding** (ADR 0001 / roadmap "warn-not-block"): a
 * Discover row is a single config File, so one or many findings inside it collapse to one
 * caution on its row. This module turns the finding list into the set of File paths to flag.
 *
 * Kept PURE + Electron-free + DOM-free so it is unit-testable in plain Node at the
 * derivation seam (mirrors the scanner's own testing posture, issue 2-03) — the warn state
 * is data the row merely renders, not behaviour buried in a component.
 *
 * **Why warn, never exclude (the issue's reconciliation).** A flagged File stays a normal,
 * *selectable* Discover row — the user can still Track it — and is **not** auto-deselected.
 * The secret is handled deliberately at Commit time, where {@link SecretWarning}'s warn step
 * (Convert to a Secret reference / Commit anyway) takes over. This module therefore only
 * *marks* rows; it never removes a suggestion or changes the default selection.
 */
import type { SecretFinding } from '../../../../main/foundation/secret-scanner'

/**
 * Reduce a flat list of commit-scan findings to the **set of File paths that look
 * secret-bearing** — the rows the Discover step renders in the amber `Warn` state.
 *
 * Each {@link SecretFinding} carries the destination-relative File it was found in; this
 * collapses every finding to its File so a File with N detected secrets is one warned row,
 * not N. The returned set is what `OBDiscover` consults per row (`warnedPaths.has(path)`).
 *
 * Membership is keyed on the SAME destination-relative path the discovery scan produces
 * (`DiscoverySuggestion.targetPath`), because `scanCommit` is called with exactly those
 * paths — so the lookup is a direct identity match, no normalization needed.
 *
 * Pure: a fold over the findings, no I/O. The masked previews and kinds are intentionally
 * dropped here — the Discover row shows only "this File looks secret-bearing", deferring the
 * per-value detail to the commit-time warn card (the row must stay scannable, not a report).
 *
 * @param findings The commit-scan findings (already allowlist-filtered by the main process).
 * @returns The set of destination-relative File paths to flag with the `Warn` state (empty
 *   when nothing was flagged — every row stays neutral).
 */
export function warnedPathsFromFindings(findings: readonly SecretFinding[]): ReadonlySet<string> {
  const warned = new Set<string>()
  for (const finding of findings) warned.add(finding.file)
  return warned
}
