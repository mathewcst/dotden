import { registerCustomCSSVariableTheme, type FileDiffOptions } from '@pierre/diffs'

/**
 * The Shiki theme name registered for dotden's read-only history previews.
 *
 * `@pierre/diffs` resolves theme names through Shiki, so the name must be stable: changing it
 * would force the shared highlighter to resolve and attach a second theme. The values behind the
 * theme are CSS variables, which keeps syntax highlighting aligned with the live Appearance accent
 * (`theme-*` on `<html>`) without re-registering the Shiki theme on every accent switch.
 */
export const DOTDEN_FILE_HISTORY_SHIKI_THEME = 'dotden-file-history'

/**
 * Register a CSS-variable Shiki theme whose tokens point at dotden's design-system palette.
 *
 * The `registerCustomCSSVariableTheme` helper uses `--diffs-*` variables internally. We provide
 * defaults that are themselves dotden variables; those variables inherit through the
 * `diffs-container` custom element's shadow boundary, so syntax tokens stay on-brand inside
 * `@pierre/diffs` while still responding to the app's accent-class rebinding.
 */
registerCustomCSSVariableTheme(
  DOTDEN_FILE_HISTORY_SHIKI_THEME,
  {
    background: 'var(--card)',
    foreground: 'var(--foreground)',

    'token-comment': 'var(--muted-foreground)',
    'token-constant': 'var(--dd-amber-400)',
    'token-deleted': 'var(--dd-red-400)',
    'token-function': 'var(--dd-blue-400)',
    'token-inserted': 'var(--dd-green-400)',
    'token-keyword': 'var(--dd-ember-400)',
    'token-link': 'var(--dd-ember-300)',
    'token-parameter': 'var(--dd-ink-200)',
    'token-punctuation': 'var(--dd-ink-300)',
    'token-string': 'var(--dd-green-400)',
    'token-string-expression': 'var(--dd-amber-400)',
    'token-changed': 'var(--dd-amber-400)',

    'ansi-black': 'var(--dd-ink-950)',
    'ansi-red': 'var(--dd-red-400)',
    'ansi-green': 'var(--dd-green-400)',
    'ansi-yellow': 'var(--dd-amber-400)',
    'ansi-blue': 'var(--dd-blue-400)',
    'ansi-magenta': 'var(--dd-ember-400)',
    'ansi-cyan': 'var(--dd-blue-400)',
    'ansi-white': 'var(--dd-ink-100)',
    'ansi-bright-black': 'var(--dd-ink-500)',
    'ansi-bright-red': 'var(--dd-red-400)',
    'ansi-bright-green': 'var(--dd-green-400)',
    'ansi-bright-yellow': 'var(--dd-amber-400)',
    'ansi-bright-blue': 'var(--dd-blue-400)',
    'ansi-bright-magenta': 'var(--dd-ember-300)',
    'ansi-bright-cyan': 'var(--dd-blue-400)',
    'ansi-bright-white': 'var(--dd-ink-50)',
  },
  false,
)

/**
 * Shared PatchDiff options for the History tab preview.
 *
 * Kept outside React render so `PatchDiff` receives a stable options object. This is intentionally
 * read-only presentation: no interaction handlers, only a branded Shiki theme and compact diff
 * chrome that fits the raised preview card.
 */
export const FILE_HISTORY_PATCH_DIFF_OPTIONS = {
  theme: DOTDEN_FILE_HISTORY_SHIKI_THEME,
  themeType: 'dark',
  diffStyle: 'unified',
  diffIndicators: 'bars',
  hunkSeparators: 'line-info-basic',
  lineDiffType: 'word',
  overflow: 'wrap',
} satisfies FileDiffOptions<undefined>
