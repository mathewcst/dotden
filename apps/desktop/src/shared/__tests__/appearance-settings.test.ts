/**
 * Unit tests for the appearance + default Apply/notification settings model (issue 2-10).
 *
 * This module is the SINGLE source of truth for the shape, defaults, normalization, and the
 * theme→class mapping shared by the renderer (the tab + live theme paint) and the main process
 * (the synced `.myenv/` store) — so it is TDD'd here: the closed theme set, the default-base
 * empty class, per-field normalization of a partial/garbage file (never throwing), and the safe
 * defaults exactly as the spec states.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_THEME_ID,
  isDefaultApplyBehavior,
  isThemeId,
  normalizeAppearanceSettings,
  themeClassName,
  THEMES,
} from '../appearance-settings'

describe('appearance-settings — theme model', () => {
  it('exposes a closed theme set whose default is ember (first)', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['ember', 'amber', 'blue', 'green'])
    expect(DEFAULT_THEME_ID).toBe('ember')
    expect(THEMES[0]?.id).toBe(DEFAULT_THEME_ID)
  })

  it('isThemeId guards exactly the known ids', () => {
    expect(isThemeId('ember')).toBe(true)
    expect(isThemeId('blue')).toBe(true)
    expect(isThemeId('purple')).toBe(false)
    expect(isThemeId(null)).toBe(false)
    expect(isThemeId(42)).toBe(false)
  })

  it('maps the default theme to NO class (it is the base) and others to theme-<id>', () => {
    // The base ember needs no extra class — index.css :root already is ember.
    expect(themeClassName('ember')).toBe('')
    expect(themeClassName('amber')).toBe('theme-amber')
    expect(themeClassName('blue')).toBe('theme-blue')
    expect(themeClassName('green')).toBe('theme-green')
  })
})

describe('appearance-settings — default-Apply model', () => {
  it('isDefaultApplyBehavior guards exactly review/apply-all', () => {
    expect(isDefaultApplyBehavior('review')).toBe(true)
    expect(isDefaultApplyBehavior('apply-all')).toBe(true)
    expect(isDefaultApplyBehavior('yolo')).toBe(false)
    expect(isDefaultApplyBehavior(undefined)).toBe(false)
  })
})

describe('appearance-settings — safe defaults', () => {
  it('defaults to ember + review + incoming/conflict-on, applied-off', () => {
    expect(DEFAULT_APPEARANCE_SETTINGS).toEqual({
      theme: 'ember',
      defaultApply: 'review',
      notifyOn: { incoming: true, conflict: true, applied: false },
    })
  })
})

describe('appearance-settings — normalization (never fail silently)', () => {
  it('returns the safe defaults for a missing/garbage value', () => {
    expect(normalizeAppearanceSettings(undefined)).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(normalizeAppearanceSettings(null)).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(normalizeAppearanceSettings('not-an-object')).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(normalizeAppearanceSettings(123)).toEqual(DEFAULT_APPEARANCE_SETTINGS)
  })

  it('fills each field independently from a partial / forward-incompatible file', () => {
    // Only `theme` is present (and valid) — every other field degrades to its default.
    expect(normalizeAppearanceSettings({ theme: 'blue' })).toEqual({
      theme: 'blue',
      defaultApply: 'review',
      notifyOn: { incoming: true, conflict: true, applied: false },
    })
    // A bad theme + a valid defaultApply + a partial notifyOn — each handled on its own.
    expect(
      normalizeAppearanceSettings({
        theme: 'rainbow',
        defaultApply: 'apply-all',
        notifyOn: { applied: true },
      }),
    ).toEqual({
      theme: 'ember',
      defaultApply: 'apply-all',
      notifyOn: { incoming: true, conflict: true, applied: true },
    })
  })

  it('coerces a non-object notifyOn back to defaults rather than throwing', () => {
    expect(normalizeAppearanceSettings({ notifyOn: 'nope' }).notifyOn).toEqual(
      DEFAULT_APPEARANCE_SETTINGS.notifyOn,
    )
    expect(normalizeAppearanceSettings({ notifyOn: null }).notifyOn).toEqual(
      DEFAULT_APPEARANCE_SETTINGS.notifyOn,
    )
  })

  it('preserves a fully-valid object verbatim', () => {
    const full = {
      theme: 'green' as const,
      defaultApply: 'apply-all' as const,
      notifyOn: { incoming: false, conflict: true, applied: true },
    }
    expect(normalizeAppearanceSettings(full)).toEqual(full)
  })
})
