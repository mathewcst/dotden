/**
 * CommitMessageRenderer — resolves a Commit's message from a template (PRD 1).
 *
 * A dotden **Commit** records edited Files into the Den (CONTEXT.md "Commit"). Its
 * git commit message is produced from a named template so the UI can show both the
 * *resolved* message and *which template* produced it (issue 1-04 acceptance:
 * "template message shown, with which template"). The synced default template is
 * stored in `.dotden/` (ADR 0024 "commit-message template"); a later Settings slice
 * (2-09) lets the user edit it.
 *
 * Critically, this renderer is a **pure, no-shell, no-network function** over its
 * inputs — the same "no-shell-reachable" discipline ADR 0007 names. It interpolates
 * a tiny, fixed set of placeholders; it never evals, never reaches a CLI, and never
 * touches anything outside the values it is handed.
 */

/**
 * A named Commit-message template.
 *
 * `id` is what the UI surfaces as "which template" produced the message; `body`
 * is the template text with `{{placeholder}}` tokens. The default lives in
 * `.dotden/`; v1 ships exactly the built-in default below.
 */
export interface CommitMessageTemplate {
  /** Stable template identifier shown in the UI (e.g. `default`). */
  readonly id: string
  /** Human label for the template, e.g. "Default". */
  readonly label: string
  /** Template text containing `{{fileCount}}` / `{{fileList}}` / `{{environment}}` tokens. */
  readonly body: string
}

/**
 * The facts a template may interpolate.
 *
 * Deliberately a CLOSED, small set — only counts and the chosen Files plus the
 * environment label. There is no general "context object", which keeps the renderer
 * impossible to turn into a data-exfiltration or shell vector.
 */
export interface CommitMessageContext {
  /** Destination-relative paths of the Files being committed (e.g. `['.zshrc']`). */
  readonly targetPaths: readonly string[]
  /** This environment's label (e.g. "this-mac"), for attribution in the message. */
  readonly environmentLabel: string
}

/**
 * The resolved message plus provenance, so the Commit UI can show both.
 */
export interface RenderedCommitMessage {
  /** The fully interpolated commit message git will record. */
  readonly message: string
  /** Id of the template that produced {@link message} — the "which template" surface. */
  readonly templateId: string
  /** Human label of that template, for display. */
  readonly templateLabel: string
}

/**
 * dotden's built-in default Commit-message template.
 *
 * Exported so onboarding can seed it into `.dotden/` and tests can assert against
 * it. The body uses the closed placeholder set understood by {@link renderCommitMessage}.
 */
export const DEFAULT_COMMIT_TEMPLATE: CommitMessageTemplate = {
  id: 'default',
  label: 'Default',
  body: 'Commit {{fileCount}} file(s) from {{environment}}: {{fileList}}',
}

/**
 * Render a Commit message from a template and context.
 *
 * Replaces a fixed set of placeholders and nothing else:
 * - `{{fileCount}}` → number of Files committed,
 * - `{{fileList}}` → comma-separated File paths,
 * - `{{environment}}` → the environment label.
 * Unknown `{{tokens}}` are left untouched (a malformed template degrades to literal
 * text rather than throwing — never fail silently, but never crash a Commit either).
 *
 * @param template The template to use (defaults to {@link DEFAULT_COMMIT_TEMPLATE}).
 * @param context The closed set of facts available to the template.
 * @returns The resolved message plus the template's id/label for the UI.
 */
export function renderCommitMessage(
  context: CommitMessageContext,
  template: CommitMessageTemplate = DEFAULT_COMMIT_TEMPLATE,
): RenderedCommitMessage {
  const replacements: Record<string, string> = {
    fileCount: String(context.targetPaths.length),
    fileList: context.targetPaths.join(', '),
    environment: context.environmentLabel,
  }
  // Only the closed placeholder set is interpolated; any other token is left verbatim.
  const message = template.body.replaceAll(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    const value = replacements[key]
    return value ?? whole
  })
  return { message, templateId: template.id, templateLabel: template.label }
}
