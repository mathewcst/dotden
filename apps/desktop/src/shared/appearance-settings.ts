/**
 * Appearance + default Apply/notification preferences — the SYNCED settings behind the
 * Settings → Appearance tab (issue 2-10, story 54).
 *
 * Story 54 names three settings that **sync across environments as defaults** so a fresh
 * environment "starts configured the way I like": the commit-message template (issue 2-09,
 * already real), **and these two** —
 *
 * - **theme** — the app's visual theme. dotden is **dark-only** by design (warm-dark/ember;
 *   `docs/design-system/color-tokens.md`), so the theme choice is not light-vs-dark but which
 *   warm **accent** the (sole interactive) hue uses. The default is the brand **ember**; a few
 *   alternative warm accents already in the palette ({@link THEMES}) let a user tint the app to
 *   taste without leaving the dark-only system. The choice re-binds the `--primary`/`--ring`
 *   tokens via a single theme class on `:root` ({@link themeClassName}) — genuinely applied
 *   appearance, not a stored-but-inert flag.
 * - **default Apply/notification preferences** — the user's defaults for how incoming changes
 *   are handled and which cross-environment events fire an OS notification:
 *   - **`defaultApply`** — the *preferred* default Apply behaviour, `review` (always review
 *     before applying — the safe default, mirroring Manual/Auto-sync, ADR 0006) vs `apply-all`
 *     (a stated *preference* to apply incoming changes without per-File review). This authors a
 *     **value only**: it never relaxes an invariant on its own. The actual automation gate stays
 *     owned by {@link AutomationPolicy} + {@link ApplyPlanner} (ADR 0008) — Conflicts never
 *     auto-resolve and incoming deletions always confirm regardless of this preference; the
 *     Automation tab (issue 2-12) + the sync-as-default wiring (issue 2-17) consume it, never
 *     this module.
 *   - **`notifyOn`** — which cross-environment events notify (issue 3-07's catalogue):
 *     `incoming` (another environment pushed), `conflict` (a Conflict appeared), `applied`
 *     (changes were applied for you under Auto-apply). The poller/notifier (issue 1-12 / 3-07)
 *     reads these flags; this slice only authors them.
 *
 * Like the commit template, BOTH of these are **user-authored organization-of-presentation /
 * preference**, so by ADR 0024's synced-vs-local split they live in the synced `.myenv/`
 * directory and travel with the Den as **defaults** (an environment may later override locally
 * — issue 2-17). This module is the SINGLE source of truth for their shape, defaults, and
 * normalization, shared by the renderer (the tab + the live theme application) and the main
 * process (the `.myenv/` store), so neither end can drift.
 *
 * **Authoring only (the load-bearing scope rule):** setting either control sends nothing across
 * environments by itself and changes no behaviour beyond the local theme paint — the
 * cross-environment sync-as-default plumbing is issue 2-17, exactly as for the commit template.
 */

/**
 * The selectable app themes (issue 2-10). dotden is dark-only, so each theme is a **warm accent
 * variant** of the one warm-dark base — it re-tints the sole interactive hue (`--primary`/
 * `--ring`) without introducing a light mode (which the design system does not have).
 *
 * The set is CLOSED: the Appearance tab renders one option per entry, and {@link themeClassName}
 * maps the id to the `:root` class that re-binds the tokens. `ember` is first and is the default.
 */
export interface AppTheme {
  /** Stable id persisted in `.myenv/` + used as the radio value. */
  readonly id: ThemeId
  /** The tab's option label (dotden vocabulary). */
  readonly label: string
  /** One-line description of the tint, for the option's sub-copy. */
  readonly description: string
  /**
   * The CSS custom-property hex/oklch swatch the tab shows as a preview dot, sourced from the
   * dd/* primitive this theme binds `--primary` to (kept in sync with `index.css`). Purely
   * illustrative — the real binding is the theme class, not this string.
   */
  readonly swatchVar: string
}

/** The closed set of theme ids (the persisted value). `ember` is the brand default. */
export type ThemeId = 'ember' | 'amber' | 'blue' | 'green'

/**
 * The selectable themes, in tab order. Each is a warm accent already present in the palette
 * (`docs/design-system/color-tokens.md`), so no new primitives are introduced — the theme
 * class simply re-points `--primary`/`--ring` at the chosen ramp.
 */
export const THEMES: readonly AppTheme[] = [
  {
    id: 'ember',
    label: 'Ember',
    description: 'The signature warm orange. dotden’s default.',
    swatchVar: 'var(--dd-ember-500)',
  },
  {
    id: 'amber',
    label: 'Amber',
    description: 'A golden, sunlit warm.',
    swatchVar: 'var(--dd-amber-500)',
  },
  {
    id: 'blue',
    label: 'Dusk',
    description: 'A cool blue accent against the warm dark.',
    swatchVar: 'var(--dd-blue-500)',
  },
  {
    id: 'green',
    label: 'Moss',
    description: 'A calm, sage-green accent.',
    swatchVar: 'var(--dd-green-500)',
  },
]

/** The default theme — the brand ember (the first entry); used when nothing is stored. */
export const DEFAULT_THEME_ID: ThemeId = 'ember'

/** True when `value` is one of the known {@link ThemeId}s. */
export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value)
}

/**
 * The `:root`/`<html>` class that applies a theme's token re-binding (issue 2-10).
 *
 * `ember` is the default base (no extra class needed — the base tokens already are ember), so it
 * maps to the empty string; every other theme maps to `theme-<id>`, whose CSS block in
 * `index.css` re-points `--primary`/`--ring`/`--sidebar-primary` at that accent ramp. The
 * renderer applies exactly one such class to `document.documentElement`, so swapping themes is a
 * single class toggle — genuinely applied appearance, dark-only preserved.
 */
export function themeClassName(id: ThemeId): string {
  return id === DEFAULT_THEME_ID ? '' : `theme-${id}`
}

/**
 * The *preferred* default Apply behaviour (issue 2-10). This is a stated PREFERENCE the user
 * authors — it never itself relaxes an invariant (ADR 0008 owners still gate the real Apply):
 *
 * - **`review`** — always review incoming changes before applying (the safe default; mirrors the
 *   Manual/Auto-sync stance, ADR 0006).
 * - **`apply-all`** — a preference to apply incoming changes without per-File review. Consumed by
 *   the Automation tab (2-12) + sync-as-default wiring (2-17); Conflicts still never auto-resolve
 *   and incoming deletions still always confirm, no matter this value.
 */
export type DefaultApplyBehavior = 'review' | 'apply-all'

/** True when `value` is a known {@link DefaultApplyBehavior}. */
export function isDefaultApplyBehavior(value: unknown): value is DefaultApplyBehavior {
  return value === 'review' || value === 'apply-all'
}

/**
 * Which cross-environment events fire an OS notification (issue 2-10; the event catalogue is
 * issue 3-07's). Every flag is independent so a user can, say, hear about Conflicts but stay
 * quiet on routine incoming changes.
 *
 * - **`incoming`** — another environment pushed changes (Review & Apply awaits).
 * - **`conflict`** — a Conflict appeared (needs the user to resolve).
 * - **`applied`** — changes were applied for the user under Auto-apply (informational).
 */
export interface NotifyOn {
  readonly incoming: boolean
  readonly conflict: boolean
  readonly applied: boolean
}

/**
 * The synced appearance + default Apply/notification preferences (issue 2-10, story 54). All
 * three fields sync as DEFAULTS via `.myenv/` (ADR 0024); an environment may later override
 * locally (issue 2-17).
 */
export interface AppearanceSettings {
  /** The selected app theme (warm accent; dark-only). */
  readonly theme: ThemeId
  /** The preferred default Apply behaviour (a value only — never gates the real Apply itself). */
  readonly defaultApply: DefaultApplyBehavior
  /** Which cross-environment events fire an OS notification. */
  readonly notifyOn: NotifyOn
}

/**
 * The SAFE defaults for a Den that has never written these settings (a fresh Den, or one synced
 * by an older dotden that predates this file).
 *
 * - **theme `ember`** — the brand default.
 * - **defaultApply `review`** — the safe, least-surprise stance: nothing applies without a review
 *   out of the box (mirrors the Manual automation default, ADR 0006).
 * - **notifyOn** — `incoming` + `conflict` on (the events a user wants to learn about promptly),
 *   `applied` off (it is informational, and Auto-apply is itself opt-in).
 */
export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  theme: DEFAULT_THEME_ID,
  defaultApply: 'review',
  notifyOn: { incoming: true, conflict: true, applied: false },
}

/**
 * Normalize an arbitrary parsed value into a coherent {@link AppearanceSettings}, filling each
 * field independently from {@link DEFAULT_APPEARANCE_SETTINGS} when absent/invalid.
 *
 * A missing file, malformed JSON, or any individually-missing/forward-incompatible field
 * degrades to its safe default rather than throwing — a partially-written or older-schema file
 * still yields a usable object (never fail silently into a surprising state). Shared by the store
 * (on read) and the renderer (defensively), so both ends normalize identically.
 *
 * @param value The raw parsed JSON (or anything), possibly partial or wrong-typed.
 * @returns A complete, coherent settings object.
 */
export function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<
    Record<keyof AppearanceSettings, unknown>
  >
  const notify = (
    typeof raw.notifyOn === 'object' && raw.notifyOn !== null ? raw.notifyOn : {}
  ) as Partial<Record<keyof NotifyOn, unknown>>
  const defaults = DEFAULT_APPEARANCE_SETTINGS
  return {
    theme: isThemeId(raw.theme) ? raw.theme : defaults.theme,
    defaultApply: isDefaultApplyBehavior(raw.defaultApply)
      ? raw.defaultApply
      : defaults.defaultApply,
    notifyOn: {
      incoming: typeof notify.incoming === 'boolean' ? notify.incoming : defaults.notifyOn.incoming,
      conflict: typeof notify.conflict === 'boolean' ? notify.conflict : defaults.notifyOn.conflict,
      applied: typeof notify.applied === 'boolean' ? notify.applied : defaults.notifyOn.applied,
    },
  }
}
