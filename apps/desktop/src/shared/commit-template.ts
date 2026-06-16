/**
 * Commit-message template — the `$var` scheme behind the Settings → Commit tab (issue 2-09).
 *
 * dotden lets the user author the message its **Commits** carry, mapping to chezmoi's
 * `git.commitMessageTemplate` (scope-v1 "Customizable commit-message template"). The
 * template is plain text with `$variable` tokens drawn from a CLOSED set (below); the
 * editor shows every variable, a live preview, and a one-click reset to the default.
 *
 * This module is the SINGLE source of truth for rendering that template, shared by both
 * the renderer (the Commit tab's live preview) and the main process (the actual Commit
 * message, once PRD2#17 wires the synced template into `DenService.commitTracked`). It is
 * placed in `shared/` precisely so one pure function renders both — the preview can never
 * drift from the real message.
 *
 * **No-shell discipline (the load-bearing privacy rule, scope-v1 / ADR 0007):** rendering
 * is a pure, no-shell, no-network function over its inputs. The cross-OS-sensitive facts
 * are sourced safely and handed IN:
 * - `$os` / `$arch` / `$hostname` come from **chezmoi template data** (`.chezmoi.os` etc.),
 *   which is already canonical — never from a host shell (`date` vs `Get-Date`, `uname` vs
 *   `$env:OS` diverge across OSes). dotden applies the one presentation rename the design
 *   asks for: chezmoi's `darwin` is shown as `macos` ({@link normalizeOs}).
 * - `$year`…`$time` come from the **app runtime clock** (a `Date` handed in), not the OS
 *   `date` command. The renderer is impossible to turn into a shell or exfiltration vector:
 *   it interpolates a fixed token set and nothing else.
 */

/**
 * The CLOSED set of variables a commit-message template may interpolate.
 *
 * Authoritative list (scope-v1): the Commit tab renders one insertable chip per entry, and
 * {@link renderCommitTemplate} interpolates exactly these `$name` tokens — anything else is
 * left verbatim. `description`/`sample` drive the tab's variable reference + the chip hint.
 */
export interface CommitTemplateVariable {
  /** The token name WITHOUT the leading `$` (e.g. `os`); the chip inserts `$os`. */
  readonly name: string
  /** Where the value comes from + what it means, for the variable-reference list. */
  readonly description: string
  /** An illustrative resolved value, shown beside the chip (e.g. `macos`, `2026`). */
  readonly sample: string
}

/**
 * Every variable the template understands, in display order (scope-v1).
 *
 * The first three are **environment facts from chezmoi template data** (cross-OS-safe); the
 * rest are **app-runtime-clock** date/time fields plus the Commit's `environment` label and
 * `filecount`. This array is the closed allowlist {@link renderCommitTemplate} interpolates.
 */
export const COMMIT_TEMPLATE_VARIABLES: readonly CommitTemplateVariable[] = [
  {
    name: 'os',
    description: 'This computer’s OS, from chezmoi (darwin shows as macos).',
    sample: 'macos',
  },
  { name: 'arch', description: 'This computer’s CPU architecture, from chezmoi.', sample: 'arm64' },
  {
    name: 'hostname',
    description: 'This computer’s hostname, from chezmoi.',
    sample: 'work-laptop',
  },
  {
    name: 'environment',
    description: 'This environment’s label in dotden (e.g. “this-mac”).',
    sample: 'this-mac',
  },
  { name: 'year', description: 'Current year (4-digit), from the app clock.', sample: '2026' },
  { name: 'month', description: 'Current month (01–12), from the app clock.', sample: '06' },
  { name: 'day', description: 'Current day of month (01–31), from the app clock.', sample: '16' },
  { name: 'hour', description: 'Current hour (00–23), from the app clock.', sample: '09' },
  { name: 'minute', description: 'Current minute (00–59), from the app clock.', sample: '42' },
  {
    name: 'date',
    description: 'Current date as YYYY-MM-DD, from the app clock.',
    sample: '2026-06-16',
  },
  { name: 'time', description: 'Current time as HH:MM, from the app clock.', sample: '09:42' },
  {
    name: 'filecount',
    description: 'How many Files this Commit records.',
    sample: '3',
  },
]

/**
 * dotden's built-in default commit-message template (scope-v1).
 *
 * `[$os-sync-$year-$month-$day]` renders like `[macos-sync-2026-06-16]` — an OS-tagged,
 * date-stamped marker that reads cleanly in `git log`. The Commit tab's "Reset to default"
 * restores exactly this string, and it is the synced default until the user edits it.
 */
export const DEFAULT_COMMIT_MESSAGE_TEMPLATE = '[$os-sync-$year-$month-$day]'

/**
 * The cross-OS environment facts a template needs, sourced from **chezmoi template data**
 * (never a host shell) — see {@link import('../main/foundation/chezmoi-adapter.js').ChezmoiAdapter.templateData}.
 *
 * These are the `.chezmoi.*` values chezmoi resolves identically on every OS, so `$os`/`$arch`/
 * `$hostname` are stable regardless of which environment authored the template.
 */
export interface CommitTemplateData {
  /** chezmoi's `.chezmoi.os` (e.g. `darwin`, `linux`, `windows`). Renamed darwin→macos for `$os`. */
  readonly os: string
  /** chezmoi's `.chezmoi.arch` (e.g. `arm64`, `amd64`). */
  readonly arch: string
  /** chezmoi's `.chezmoi.hostname`. */
  readonly hostname: string
}

/**
 * The per-Commit facts the template interpolates alongside {@link CommitTemplateData}.
 *
 * Deliberately tiny + closed (like {@link CommitTemplateData}) so the renderer can never be
 * widened into a general context object — keeping it impossible to use as a data-exfiltration
 * or shell vector.
 */
export interface CommitTemplateContext {
  /** The chezmoi template data (os/arch/hostname). */
  readonly data: CommitTemplateData
  /** This environment's dotden label (e.g. "this-mac") — the `$environment` value. */
  readonly environment: string
  /** Number of Files this Commit records — the `$filecount` value. */
  readonly fileCount: number
  /**
   * The instant the date/time fields render against — the **app runtime clock**, handed in so
   * the function stays pure/testable and never calls the OS `date` command. The Commit tab
   * passes `new Date()`; tests pass a fixed Date for determinism.
   */
  readonly now: Date
}

/**
 * Present chezmoi's OS token the way the design names it: `darwin` → `macos`, else unchanged.
 *
 * chezmoi reports `runtime.GOOS` (`darwin` on a Mac); the design's `$os` shows `macos`
 * (scope-v1 "darwin→macos"). This is the ONE presentation rename — a faithful-wrapper
 * presentation choice (ADR 0003), applied here so both the preview and the real message agree.
 */
export function normalizeOs(chezmoiOs: string): string {
  return chezmoiOs === 'darwin' ? 'macos' : chezmoiOs
}

/** Zero-pad a number to two digits (e.g. `6` → `"06"`) for the date/time fields. */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Resolve every template variable to its concrete value for a given context.
 *
 * os/arch/hostname come from {@link CommitTemplateData} (chezmoi); the date/time fields come
 * from `context.now` (the app clock) using its **local** components (the message reads in the
 * user's own wall-clock time); `environment`/`filecount` come straight from the context. This
 * is the closed map {@link renderCommitTemplate} substitutes from — no other token resolves.
 */
export function resolveCommitTemplateValues(
  context: CommitTemplateContext,
): Record<string, string> {
  const { data, environment, fileCount, now } = context
  const year = now.getFullYear()
  const month = pad2(now.getMonth() + 1)
  const day = pad2(now.getDate())
  const hour = pad2(now.getHours())
  const minute = pad2(now.getMinutes())
  return {
    os: normalizeOs(data.os),
    arch: data.arch,
    hostname: data.hostname,
    environment,
    year: String(year),
    month,
    day,
    hour,
    minute,
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
    filecount: String(fileCount),
  }
}

/**
 * Render a commit-message template (the `$var` scheme) to its final text — PURE, no shell.
 *
 * Replaces each `$name` whose `name` is in the closed variable set ({@link COMMIT_TEMPLATE_VARIABLES})
 * with its resolved value; any other `$token` (or a literal `$` not starting a known name) is
 * left untouched, so a typo degrades to literal text rather than throwing (never fail silently,
 * but never crash a Commit either). Longest names are matched first so `$filecount` is never
 * mis-split, and a trailing word boundary stops `$year` from matching inside `$yearly`.
 *
 * This same function backs BOTH the Commit tab's live preview and (via PRD2#17) the real Commit
 * message, so what the user previews is exactly what `git log` records.
 *
 * @param template The user's template text (e.g. `[$os-sync-$year-$month-$day]`).
 * @param context The closed facts available to the template (chezmoi data + clock + counts).
 * @returns The fully interpolated message.
 */
export function renderCommitTemplate(template: string, context: CommitTemplateContext): string {
  const values = resolveCommitTemplateValues(context)
  // Match the LONGEST known names first (`filecount`/`hostname`/`environment` before `arch`/…)
  // so a shorter name can never greedily consume a longer one. `\b` after the name keeps `$year`
  // from matching the `year` inside a hypothetical `$yearly`.
  const names = COMMIT_TEMPLATE_VARIABLES.map((variable) => variable.name).sort(
    (a, b) => b.length - a.length,
  )
  const pattern = new RegExp(`\\$(${names.join('|')})\\b`, 'g')
  return template.replaceAll(pattern, (whole, name: string) => values[name] ?? whole)
}
