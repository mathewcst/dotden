import { THEMES, themeClassName, type ThemeId } from '../../shared/appearance-settings'

/**
 * Apply a {@link ThemeId} to the document — the renderer half of issue 2-10's theme control.
 *
 * dotden is dark-only, so a "theme" is which warm accent the interactive hue uses. Applying one
 * is a single class toggle on `<html>`: the chosen `theme-<id>` class (or none, for the default
 * ember base) re-points the `--dd-ember-*` accent stops at that ramp in `index.css`, so every
 * ember-bound utility and semantic alias shifts together — genuinely applied appearance.
 *
 * This lives in the renderer (not `shared/`) precisely because it touches `document`: the shared
 * `appearance-settings.ts` stays a pure, DOM-free module the Electron-free main process can also
 * import (ADR 0023). It removes every known `theme-*` class first, so switching themes never
 * leaves a stale accent layered under the new one.
 *
 * @param id The theme to apply (its persisted id).
 */
export function applyTheme(id: ThemeId): void {
  const root = document.documentElement
  // Drop any previously-applied theme class so accents never stack.
  for (const theme of THEMES) {
    const cls = themeClassName(theme.id)
    if (cls) root.classList.remove(cls)
  }
  const next = themeClassName(id)
  if (next) root.classList.add(next)
}

// Re-export the settings types/values the tab also needs, so callers import one renderer module
// for the theme concern rather than reaching across to `shared/` for everything.
export type {
  AppearanceOverride,
  AppearanceSettings,
  DefaultApplyBehavior,
  NotifyOn,
  ThemeId,
} from '../../shared/appearance-settings'
export { resolveAppearanceSettings, THEMES } from '../../shared/appearance-settings'
