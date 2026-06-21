/**
 * SecretScanner — the PURE commit-time secret detector (issue 2-03).
 *
 * Runs on the set of Files about to be **Committed** into the Den and emits findings of
 * shape {@link SecretFinding} `{ file, kind, line, maskedValue }`. It is the detection
 * half of the secrets flow; the **warn step** that surfaces these findings (and lets the
 * user Convert to a Secret reference or Commit anyway) is the renderer's job (issue 2-03
 * UI + 2-04/2-05). This module never decides policy — it only reports what it found.
 *
 * Design constraints (from the workflow brief + scope-v1 "Secrets"):
 *
 * - **PURE — no shell, no I/O, no network.** Detection is regex + Shannon entropy over a
 *   string the caller already read. That keeps it trivially unit-testable at the scanner
 *   seam (the issue's Testing Decision) and means scanning cannot itself leak a secret
 *   (no `op`/`bw`/`git` subprocess, no egress). The caller (`DenService.commitTracked`)
 *   reads each File's on-disk bytes and hands them here.
 * - **WARN, never block (ADR 0001 + scope-v1).** A finding is a *caution*: the Commit can
 *   always proceed. This module returns data; it has no power to prevent a Commit. The
 *   warn surface is amber, never destructive-red (catching a secret is non-destructive
 *   and the remedy — Convert to a Secret reference — is safe).
 * - **The mask never exposes the full value.** {@link maskSecret} reveals at most a short
 *   head/tail and always elides the middle, so the warn card shows *what* was flagged
 *   (`AKIA••••••••••••N7QX`) without re-exposing the secret. This is the security-relevant
 *   invariant the unit tests pin (the issue's acceptance criterion).
 * - **Reasonable false-positive posture.** Obvious placeholders (`xxxx`, `<your-token>`,
 *   `changeme`, `example`, all-same-char fills) are excluded so the warn step stays
 *   trustworthy rather than crying wolf on every config file. We err toward *missing* a
 *   contrived fake over *flagging* an obvious placeholder — a missed secret is caught by
 *   the user's review of their own file, but a noisy scanner trains users to dismiss it.
 *
 * Why scan the about-to-be-committed bytes (not chezmoi's source state): the user is about
 * to record exactly these bytes into the Den, where they would sync to every environment
 * *raw* unless converted. Catching them here is catching the secret "at the door" before
 * it enters the Den (secret-and-errors screen spec).
 */
import type { SecretFinding, SecretKind } from '../../../shared/secrets.js'

/**
 * A single File handed to the scanner: its destination-relative path plus the exact bytes
 * about to be committed (decoded as UTF-8 text by the caller). Binary Files are the
 * caller's concern to skip — the scanner treats `content` as text.
 */
export interface ScanInput {
  /** Destination-relative File path (e.g. `.zshrc`), carried straight into each finding. */
  readonly file: string
  /** The File's text content about to be committed (the caller read it from disk). */
  readonly content: string
}

/**
 * How long a value must be before the mask reveals a head AND tail. Below this we reveal
 * nothing but a fixed bullet run, so a short secret cannot be substantially exposed by the
 * preview. (12 = comfortably longer than the 4-char head + 4-char tail we reveal above it.)
 */
const MASK_REVEAL_THRESHOLD = 12

/** Characters revealed at each end of a long value's mask (head and tail). */
const MASK_EDGE = 4

/** The bullet used to elide the masked middle (matches the design spec's `••••`). */
const MASK_BULLET = '•'

/**
 * Mask a secret value for display — the **security-relevant** function (its unit test pins
 * that the FULL value is never present in the output).
 *
 * - Long values (≥ {@link MASK_REVEAL_THRESHOLD}): reveal {@link MASK_EDGE} head + tail
 *   chars with a fixed-width bullet run between, e.g. `AKIA••••••••••••N7QX`. The bullet
 *   run is a CONSTANT width (not the elided length) so the preview never even leaks how
 *   many characters were hidden.
 * - Short values: reveal nothing — a fixed bullet run only — because revealing head+tail of
 *   a short secret could expose most of it.
 *
 * @param value The raw secret value (already extracted from the line).
 * @returns A masked preview safe to render; never contains the full `value`.
 */
export function maskSecret(value: string): string {
  // Fixed-width elision so the preview leaks neither the middle nor the hidden length.
  const middle = MASK_BULLET.repeat(8)
  if (value.length < MASK_REVEAL_THRESHOLD) {
    // Too short to reveal edges safely — show bullets only.
    return middle
  }
  const head = value.slice(0, MASK_EDGE)
  const tail = value.slice(value.length - MASK_EDGE)
  return `${head}${middle}${tail}`
}

/**
 * Obvious placeholder values that must NOT be flagged (false-positive guard). These are the
 * strings users put in example configs where a secret would go; flagging them would make the
 * warn step noisy and untrustworthy. Matched case-insensitively as a substring of the
 * candidate value, plus the all-same-character heuristic below.
 */
const PLACEHOLDER_SUBSTRINGS: readonly string[] = [
  'xxxx',
  'example',
  'changeme',
  'placeholder',
  'your-',
  'your_',
  'yourtoken',
  'yourkey',
  'redacted',
  'dummy',
  'sample',
  'todo',
  'replace',
  'notreal',
  'fake',
  'test-token',
  'test_token',
]

/**
 * Whether a candidate value looks like an obvious placeholder rather than a real secret.
 *
 * Guards (any one excludes the value):
 * - contains a known placeholder substring (`xxxx`, `<your-token>`, `changeme`, …);
 * - is wrapped in `<…>`/`{…}`/`${…}` template/interpolation syntax (a reference, not a literal);
 * - is a single character repeated (e.g. `aaaaaaaa`, `00000000`) — a fill, not a key.
 *
 * @param value The candidate secret value.
 * @returns True when the value should be treated as a placeholder and NOT reported.
 */
function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase()
  if (PLACEHOLDER_SUBSTRINGS.some((p) => lower.includes(p))) return true
  // `<...>`, `{{...}}`, `${...}` etc. — an interpolation/reference, not a committed literal.
  if (/^[<{$].*[>}]$/.test(value)) return true
  // A single repeated character (placeholder fill like `aaaaaaaaaaaa` / `xxxxxxxx`).
  if (value.length > 0 && new Set(value).size === 1) return true
  return false
}

/**
 * Shannon entropy (bits per character) of a string — the heuristic that separates a random
 * high-entropy secret from prose/an English word. Pure: a frequency tally over the chars.
 *
 * @param value The string to measure.
 * @returns Average bits of entropy per character (0 for empty/single-char strings).
 */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0
  const counts = new Map<string, number>()
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let entropy = 0
  for (const count of counts.values()) {
    const p = count / value.length
    entropy -= p * Math.log2(p)
  }
  return entropy
}

/**
 * The minimum length AND per-char entropy a *generic* assigned value must clear before the
 * entropy detector treats it as a likely secret. Tuned so random base64/hex API keys clear
 * it while ordinary config values (paths, words, short numbers) do not. The shape-specific
 * detectors (AWS, GitHub, …) do NOT gate on entropy — they match a known prefix/format.
 */
const GENERIC_MIN_LENGTH = 20
const GENERIC_MIN_ENTROPY = 3.5

/**
 * A detector: a labelled regex whose first capture group (or whole match) is the secret
 * value. `entropyGated` detectors additionally require the captured value to clear the
 * generic entropy floor — used for the broad "assigned-looking secret" catch-all so it
 * doesn't fire on every `KEY=word` line. Shape detectors (known prefixes) are not gated.
 */
interface Detector {
  readonly kind: SecretKind
  readonly pattern: RegExp
  /** Require the captured value to clear {@link GENERIC_MIN_ENTROPY} (catch-all detectors). */
  readonly entropyGated?: boolean
}

/**
 * The ordered detector table. Order matters: SPECIFIC shapes (AWS, GitHub, …) come before
 * the GENERIC catch-all so a recognized token is labelled precisely ("GitHub Token") rather
 * than as a bare "Generic API Key". The first detector to match a line wins (one finding per
 * line — a line with a secret is flagged once, by its most specific kind).
 *
 * Every pattern captures the SECRET VALUE in group 1 (or the whole match when there is no
 * surrounding assignment syntax) so {@link maskSecret} masks exactly the sensitive bytes.
 *
 * chezmoi mapping: a flagged value is what the user would Convert into a chezmoi `.tmpl`
 * Secret reference (`{{ (onepasswordRead "op://…") }}`) in issue 2-05 — the detector just
 * locates it; the value never leaves this process.
 */
const DETECTORS: readonly Detector[] = [
  // ── AWS ──
  // Access Key IDs are a fixed 20-char shape with a known prefix set (AKIA/ASIA/AGPA/…).
  {
    kind: 'AWS Access Key ID',
    pattern: /\b((?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[0-9A-Z]{16})\b/,
  },
  // Secret Access Keys are a 40-char base64-ish blob, almost always assigned to a
  // recognizable key name — we anchor on the key name to avoid matching any 40-char string.
  {
    kind: 'AWS Secret Access Key',
    pattern: /aws_secret_access_key\s*[:=]\s*["']?([A-Za-z0-9/+]{40})["']?/i,
  },
  // ── GitHub ── new fine-grained + classic PAT/OAuth/refresh/server prefixes.
  { kind: 'GitHub Token', pattern: /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,})\b/ },
  { kind: 'GitHub Token', pattern: /\b(github_pat_[A-Za-z0-9_]{20,})\b/ },
  // ── GitLab ──
  { kind: 'GitLab Personal Access Token', pattern: /\b(glpat-[A-Za-z0-9_-]{20,})\b/ },
  // ── Slack ──
  { kind: 'Slack Token', pattern: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/ },
  // ── Google ──
  { kind: 'Google API Key', pattern: /\b(AIza[0-9A-Za-z_-]{35})\b/ },
  // ── Stripe ── live/test secret + restricted keys.
  { kind: 'Stripe API Key', pattern: /\b((?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,})\b/ },
  // ── OpenAI ──
  { kind: 'OpenAI API Key', pattern: /\b(sk-[A-Za-z0-9_-]{20,})\b/ },
  // ── JWT ── three base64url segments separated by dots, leading with the `eyJ` header.
  {
    kind: 'JSON Web Token',
    pattern: /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/,
  },
  // ── Private key blocks ── PEM/OpenSSH/PGP headers (the "key blocks" the issue names).
  {
    kind: 'Private Key',
    pattern: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----)/,
  },
  // ── Generic catch-all ── a *-key/-token/-secret/-password assignment to a longish,
  // high-entropy value. Entropy-gated so it ignores `password = hunter2` / `key = name`
  // but catches `api_key = "9f2c8b1e4a7d..."`. Anchored on a credential-ish key name so it
  // doesn't fire on every long string in a file.
  {
    kind: 'Generic API Key or Secret',
    pattern:
      /(?:api[_-]?key|secret|token|password|passwd|access[_-]?key|client[_-]?secret|auth)\s*[:=]\s*["']?([A-Za-z0-9/+_=-]{20,})["']?/i,
    entropyGated: true,
  },
]

/**
 * Scan ONE File's content and return every secret finding in it (issue 2-03).
 *
 * Pure: walks the content line by line, applies the {@link DETECTORS} in order, and emits at
 * most one finding per line (the most specific kind wins). Each finding carries the 1-based
 * line number and a {@link maskSecret} preview. Placeholders ({@link isPlaceholder}) and
 * entropy-failing generic values are skipped so the warn step stays trustworthy.
 *
 * @param input The File path + its about-to-be-committed text content.
 * @returns Findings in line order (empty when the File has no detectable secret).
 */
export function scanFile(input: ScanInput): readonly SecretFinding[] {
  const findings: SecretFinding[] = []
  const lines = input.content.split(/\r?\n/)
  // `entries()` keeps `line` typed as a definite string (vs an index access, which
  // `noUncheckedIndexedAccess` widens to `string | undefined`).
  for (const [i, line] of lines.entries()) {
    for (const detector of DETECTORS) {
      const match = detector.pattern.exec(line)
      if (!match) continue
      // The captured value (group 1) is the secret; fall back to the whole match for
      // detectors with no surrounding assignment syntax (e.g. the private-key header).
      const value = match[1] ?? match[0]
      // False-positive guard: obvious placeholders are never reported.
      if (isPlaceholder(value)) continue
      // The generic catch-all additionally requires real randomness so `token = mytoken`
      // doesn't trip it; the shape detectors already proved their format and skip this.
      if (detector.entropyGated && shannonEntropy(value) < GENERIC_MIN_ENTROPY) continue
      if (detector.entropyGated && value.length < GENERIC_MIN_LENGTH) continue
      findings.push({
        file: input.file,
        kind: detector.kind,
        // 1-based: the warn card and the user's editor both count lines from 1.
        line: i + 1,
        maskedValue: maskSecret(value),
      })
      // One finding per line — the most specific detector matched, so stop scanning this line.
      break
    }
  }
  return findings
}

/**
 * Scan EVERY File in the about-to-be-committed set and return all findings across them
 * (issue 2-03). The flat list is exactly what the warn step renders (one card per finding,
 * grouped by File in the UI). Order follows the input File order, then line order within.
 *
 * This is the function `DenService.commitTracked` calls before recording the Commit: it
 * reads each chosen File's bytes, hands them here, and — if the result is non-empty — the
 * renderer shows the amber warn step. The scan NEVER blocks the Commit (ADR 0001): an empty
 * result means "nothing to warn about", a non-empty result is a caution the user resolves.
 *
 * @param inputs The Files about to be committed (path + content each).
 * @returns Every finding across every File, in File-then-line order.
 */
export function scanForSecrets(inputs: readonly ScanInput[]): readonly SecretFinding[] {
  return inputs.flatMap((input) => scanFile(input))
}
