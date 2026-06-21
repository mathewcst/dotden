/**
 * secret-reference — the PURE chezmoi `.tmpl` Secret-reference shape (issue 2-05).
 *
 * This is the heart of the convert flow: it turns a user's password-manager choice + a vault
 * reference into the exact chezmoi **template call** that resolves the secret from the vault at
 * **Apply** time — and the matching chezmoi **source filename** (encoded `dot_…` + `.tmpl`) so
 * chezmoi treats the File as a Go template rather than a literal.
 *
 * Why this lives as its own PURE module (no shell, no I/O):
 *
 * - **The security invariant is the rendered template, and it must be trivially testable.** A
 *   Secret reference (CONTEXT.md) is a placeholder like `op://vault/item/field`; the real secret
 *   never enters the Den. The single thing that guarantees that is the string this module emits —
 *   it is a *reference/template call*, never the raw value. Keeping it pure lets the unit tests pin
 *   the exact shape per manager (the issue's acceptance criterion) with zero binaries.
 * - **The chezmoi templating exposure is narrow and named here.** v1 exposes exactly one guided
 *   slice of chezmoi templating (scope-v1 "Secrets"). The three template functions below are the
 *   whole surface; everything else about templating stays hidden. Confining the shape to one module
 *   keeps that exposure auditable.
 *
 * The actual write of the `.tmpl` File into source state (the integration seam) lives in
 * {@link import('./chezmoi-adapter.js').ChezmoiAdapter.convertToSecretReference}; this module only
 * computes the bytes + the filename. Apply-time resolution + the provider-agnostic failure mapping
 * live in {@link import('./den-service.js').DenService.convertSecret}/`applyIncoming`.
 *
 * Template-function shapes (confirmed against chezmoi docs via Context7):
 * - 1Password → `{{ onepasswordRead "op://vault/item/field" }}` (calls `op read --no-newline`;
 *   the optional second arg adds `--account <account>`).
 * - Bitwarden → `{{ (bitwardenFields "item" "<name>").<field>.value }}` (a custom-field lookup;
 *   the field defaults to `password`).
 * - pass → `{{ pass "<entry>" }}` (the first line of `pass show <entry>`).
 */

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
 * The v1 password-manager catalog (1Password / Bitwarden / pass) — the SINGLE source of truth for
 * the picker, the detector, and the converter. Order is the picker's display order (1Password
 * first: the spec's default-selected option). chezmoi supports many more managers; these are the
 * common three v1 ships (scope-v1 "Secrets"), and others are cheap to add by extending this list +
 * {@link renderSecretReferenceTemplate}.
 */
export const PASSWORD_MANAGERS: readonly PasswordManagerInfo[] = [
  {
    id: 'op',
    label: '1Password',
    cli: 'op',
    installHint: 'Install the 1Password CLI (`op`) and sign in to use 1Password references.',
    referenceExample: 'op://vault/item/field',
  },
  {
    id: 'bw',
    label: 'Bitwarden',
    cli: 'bw',
    installHint:
      'Install the Bitwarden CLI (`bw`) and unlock your vault to use Bitwarden references.',
    referenceExample: 'item name (e.g. GitHub)',
  },
  {
    id: 'pass',
    label: 'pass',
    cli: 'pass',
    installHint: 'Install `pass` (the standard unix password manager) to use pass references.',
    referenceExample: 'entry path (e.g. github/token)',
  },
]

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

/**
 * Escape a string for embedding inside a Go-template **double-quoted** string literal.
 *
 * Defense-in-depth: a reference/account/field the user pasted could contain a `"` or `\`, which
 * would otherwise break out of the quoted arg and produce a malformed (or, worse, attacker-shaped)
 * template. We escape backslash first, then the quote, matching Go string-literal escaping. The
 * common case (a clean `op://…` ref) is unaffected.
 */
function escapeTemplateString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

/**
 * Render the chezmoi template call that resolves a Secret reference from the user's password
 * manager — the heart of the convert flow (issue 2-05, acceptance criterion 6).
 *
 * The returned string is the ENTIRE content dotden writes into the `.tmpl` source File (for a
 * single-secret File) — a reference/template call, NEVER the raw secret. At Apply time chezmoi
 * evaluates it, calling the manager's CLI to fetch the value from the vault, so the config still
 * works on every environment while the secret never enters git history.
 *
 * @param request The user's manager choice + vault reference (+ optional account/field).
 * @returns The chezmoi template call string (e.g. `{{ onepasswordRead "op://vault/item/field" }}`).
 * @throws {Error} When the reference is blank — emitting an empty/unresolvable template would
 *   fail silently at Apply; we reject it here so the convert UI can surface "enter a reference".
 */
export function renderSecretReferenceTemplate(request: SecretReferenceRequest): string {
  const reference = request.reference.trim()
  if (reference.length === 0) {
    throw new Error(
      'A Secret reference cannot be empty — enter where the secret lives in your vault.',
    )
  }
  const ref = escapeTemplateString(reference)

  switch (request.manager) {
    case 'op': {
      // `op read --no-newline <ref>`; the optional account becomes `--account <account>`.
      const account = request.account?.trim()
      if (account && account.length > 0) {
        return `{{ onepasswordRead "${ref}" "${escapeTemplateString(account)}" }}`
      }
      return `{{ onepasswordRead "${ref}" }}`
    }
    case 'bw': {
      // A custom-field lookup on a Bitwarden item; default the field to `password`.
      const field =
        request.field?.trim() && request.field.trim().length > 0 ? request.field.trim() : 'password'
      return `{{ (bitwardenFields "item" "${ref}").${field}.value }}`
    }
    case 'pass': {
      // The first line of `pass show <entry>`.
      return `{{ pass "${ref}" }}`
    }
  }
}

/**
 * Markers that a chezmoi apply failure was caused by a **password-manager CLI** failing to resolve
 * a Secret reference (issue 2-05, acceptance criterion 9) — a locked/signed-out CLI or a
 * missing item/field. We match on the chezmoi template-function names (`onepasswordRead`,
 * `bitwardenFields`/`bitwarden`, `pass`) and the common CLI failure phrases. Kept broad +
 * provider-spanning so one detector covers all three managers; the *message* we surface is
 * provider-agnostic (the user shouldn't need to know which manager's wording leaked through).
 */
const SECRET_RESOLUTION_MARKERS: readonly RegExp[] = [
  // The chezmoi template functions themselves appearing in the error = a reference failed to render.
  /onepasswordRead|bitwardenFields?|bitwarden\b|\bpass(?:Fields)?\b|\bgopass\b/i,
  // Common CLI lock/sign-in/auth phrases (op / bw share these shapes).
  /not (?:currently )?signed in|not logged in|vault is locked|please run .?op signin|session (?:has )?expired/i,
  // Common missing-item / missing-field / not-in-store phrases.
  /isn'?t an item|not in the password store|no item matching|couldn'?t find|item not found/i,
]

/**
 * Whether a chezmoi apply failure (stderr/message text) looks like a **Secret-reference resolution
 * failure** — a password-manager CLI that is locked/signed-out, or a missing item/field (issue
 * 2-05, acceptance criterion 9).
 *
 * Used by {@link import('./den-service.js').DenService.applyIncoming} to turn the raw provider
 * stderr into a clean, provider-AGNOSTIC error pointing the user at the fix (unlock/sign in, or
 * correct the reference) rather than surfacing chezmoi's internal template error verbatim. Pure
 * string classification so it is unit-testable without a vault.
 *
 * @param failureText The chezmoi apply failure text (its message / stderr).
 * @returns True when the failure is attributable to a password-manager reference not resolving.
 */
export function isSecretReferenceResolutionFailure(failureText: string): boolean {
  return SECRET_RESOLUTION_MARKERS.some((marker) => marker.test(failureText))
}

/**
 * chezmoi's attribute-prefix for a leading-dot path segment in source state. A destination
 * `.zshrc` is stored as `dot_zshrc`; `.aws/credentials` as `dot_aws/credentials`. Only the FIRST
 * segment is encoded here (chezmoi encodes each level, but the convert flow operates on a single
 * already-managed File whose intermediate dirs chezmoi created, so encoding the leading segment is
 * what flips the source name — matching the existing adapter's `dot_zshrc` convention).
 */
const DOT_PREFIX = 'dot_'

/** The `.tmpl` suffix chezmoi requires for a source File to be evaluated as a Go template. */
const TMPL_SUFFIX = '.tmpl'

/**
 * Compute the chezmoi **source filename** for a destination File that is becoming a template —
 * i.e. the name that makes chezmoi (a) map it back to the right destination path and (b) treat it
 * as a template (the `.tmpl` suffix). A leading-dot first segment is encoded `dot_…`; the suffix
 * is added idempotently (a path already ending in `.tmpl` is not double-suffixed).
 *
 * Used by {@link import('./chezmoi-adapter.js').ChezmoiAdapter.convertToSecretReference} to know
 * where to write the rendered template. Kept pure + here so the encoding is unit-tested alongside
 * the template shape.
 *
 * @param targetPath Destination-relative File path (e.g. `.aws/credentials`).
 * @returns The source-relative template filename (e.g. `dot_aws/credentials.tmpl`).
 */
export function sourceTemplateName(targetPath: string): string {
  // Normalize separators so the encoding is stable on Windows-style inputs too.
  const normalized = targetPath.replaceAll('\\', '/')
  const segments = normalized.split('/')
  const first = segments[0] ?? ''
  // Encode a leading-dot first segment to chezmoi's `dot_` attribute prefix.
  if (first.startsWith('.')) {
    segments[0] = `${DOT_PREFIX}${first.slice(1)}`
  }
  const encoded = segments.join('/')
  // Idempotent suffix: never produce `.tmpl.tmpl`.
  return encoded.endsWith(TMPL_SUFFIX) ? encoded : `${encoded}${TMPL_SUFFIX}`
}
