/**
 * secrets — IPC contract types shared by main + renderer (ADR 0030).
 * Moved out of foundation so the renderer speaks them without importing main.
 */

/**
 * The kind of secret a detector recognized — a short human label shown verbatim in the
 * warn card ("AWS Access Key ID · line 3"). New shapes add a case to {@link DETECTORS};
 * the union is open by design (kind is a label, not a closed policy enum).
 */
export type SecretKind =
  | 'AWS Access Key ID'
  | 'AWS Secret Access Key'
  | 'GitHub Token'
  | 'GitLab Personal Access Token'
  | 'Slack Token'
  | 'Google API Key'
  | 'Stripe API Key'
  | 'OpenAI API Key'
  | 'JSON Web Token'
  | 'Private Key'
  | 'Generic API Key or Secret'
  | 'High-entropy String'

/**
 * One detected secret — the exact shape the issue's acceptance criteria name. The warn
 * step renders one card per finding: the **File**, the **kind** of secret, the **line**,
 * and a **masked preview** of the value.
 */
export interface SecretFinding {
  /** Destination-relative File path the secret was found in (e.g. `.aws/credentials`). */
  readonly file: string
  /** Human label for the kind of secret detected (e.g. `AWS Access Key ID`). */
  readonly kind: SecretKind
  /** 1-based line number the secret appears on (the line the warn card shows). */
  readonly line: number
  /**
   * A masked preview of the value — head/tail revealed, middle elided. NEVER the full
   * secret (the security invariant: {@link maskSecret}). Shown so the user recognizes
   * *which* value was flagged without re-exposing it.
   */
  readonly maskedValue: string
}

/**
 * The id of a v1-supported password manager — the closed enum of CLIs dotden detects + converts
 * against. Each maps 1:1 onto a chezmoi template function (chezmoi supports more; v1 targets the
 * common three per scope-v1 "Secrets"). The id is also the CLI binary name on PATH.
 */
export type PasswordManagerId = 'op' | 'bw' | 'pass'

/**
 * Static catalog metadata for one supported password manager — the data the picker UI renders
 * and the detector probes. Pure data (no behavior), so the UI, the detector, and the converter
 * all read the SAME single source of truth rather than re-listing managers.
 */
export interface PasswordManagerInfo {
  /** Stable id = the CLI binary name probed on PATH (`op` / `bw` / `pass`). */
  readonly id: PasswordManagerId
  /** Human label shown in the picker ("1Password", "Bitwarden", "pass"). */
  readonly label: string
  /** The CLI command the user must have installed for this option to be selectable. */
  readonly cli: string
  /**
   * A short, provider-specific **install hint** shown when the CLI is absent (acceptance
   * criterion 4) so the disabled option explains *why* it can't be picked + how to fix it
   * (never fail silently). Generic/OS-agnostic wording — dotden does not run the install.
   */
  readonly installHint: string
  /**
   * An example reference, shown as placeholder/help so the user knows the shape to paste
   * (`op://vault/item/field`, a Bitwarden item name, a pass entry path).
   */
  readonly referenceExample: string
}

/**
 * One catalog manager annotated with this environment's detection result — exactly what the
 * picker renders: the static {@link PasswordManagerInfo} fields plus `available`. An unavailable
 * manager keeps its `installHint` so the disabled option can explain why it can't be picked.
 */
export interface DetectedPasswordManager extends PasswordManagerInfo {
  /** True iff this manager's CLI resolved on this environment's PATH (the option is selectable). */
  readonly available: boolean
}

/**
 * The remembered conversion default — the preferred manager + (for 1Password) the chosen account.
 * `null` (absent file) means "no remembered choice; ask which manager each time".
 */
export interface PmPreference {
  /** The preferred password manager future conversions go straight to. */
  readonly manager: PasswordManagerId
  /** (1Password) the remembered non-default account, if the user picked one. */
  readonly account?: string
}

/**
 * One allowlist entry — a single match the user judged safe and asked dotden to stop warning
 * about. Carries the human-auditable `file`/`kind`/`maskedValue` (so the entry is legible in the
 * synced JSON git diff and any future "manage my allowlist" surface) PLUS the derived
 * `fingerprint` that is the actual match key. The masked value is the SAME masked preview the
 * scanner produced — never the raw secret (it would otherwise sync raw, defeating the point).
 */
export interface SecretAllowlistEntry {
  /** Destination-relative File path the allowlisted secret was found in (e.g. `.aws/credentials`). */
  readonly file: string
  /** The kind of secret (the scanner's label), part of the per-File+match scope. */
  readonly kind: string
  /** The masked preview of the value — NEVER the raw secret (it would sync raw otherwise). */
  readonly maskedValue: string
  /** The stable {@link findingFingerprint} this entry suppresses (the match key). */
  readonly fingerprint: string
}

/** The synced allowlist document (`.dotden/secret-allowlist.json`). Append-only in practice. */
export interface SecretAllowlist {
  /** Every match the user has judged safe across the Den (synced across environments). */
  readonly entries: readonly SecretAllowlistEntry[]
}

/**
 * A request to convert a flagged value into a Secret reference — the user's picker choice plus the
 * vault coordinates the reference points at. Notably this carries NO raw secret value: the value
 * stays in the user's vault, so it is not even representable here (the privacy posture is in the
 * type — mirrors the operation-tracer allowlist).
 */
export interface SecretReferenceRequest {
  /** Which password manager the reference resolves from (the user's picker choice). */
  readonly manager: PasswordManagerId
  /**
   * The vault reference: for 1Password the `op://vault/item/field` URI; for Bitwarden the item
   * name; for pass the entry path. This is the only coordinate that enters source state — never
   * the secret value.
   */
  readonly reference: string
  /**
   * (1Password only) a non-default account identifier — when set, the template adds the account
   * arg (`--account <account>`). Omitted/blank ⇒ the default account.
   */
  readonly account?: string
  /**
   * (Bitwarden only) which custom field of the item to read; defaults to `password`. Ignored by
   * the other managers.
   */
  readonly field?: string
}
