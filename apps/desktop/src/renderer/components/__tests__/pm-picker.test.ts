/**
 * pm-picker pure-logic tests — the SecretPicker's selection + enablement rules (issue 2-05).
 *
 * The picker's DOM is thin; its DECISIONS are pure and live here so they are unit-testable without
 * a renderer (the codebase's renderer tests are pure-logic, no jsdom): which manager is selected by
 * default (the first available, honoring a remembered preference), and whether Convert is allowed
 * (a selectable manager + a non-empty reference). These rules encode the issue's acceptance
 * criteria 3 (1Password auto-ready when detected) and 5 (remembered choice wins).
 */
import { describe, expect, it } from 'vitest'
import { canConvert, defaultManagerSelection } from '../pm-picker'
import type { DetectedPasswordManager } from '../../../main/foundation/pm-detect'

/** Build a detected-manager list with the given availability per id (defaults all false). */
function managers(
  available: Partial<Record<DetectedPasswordManager['id'], boolean>>,
): readonly DetectedPasswordManager[] {
  const base = [
    { id: 'op', label: '1Password', cli: 'op' },
    { id: 'bw', label: 'Bitwarden', cli: 'bw' },
    { id: 'pass', label: 'pass', cli: 'pass' },
  ] as const
  return base.map((m) => ({
    ...m,
    installHint: `install ${m.cli}`,
    referenceExample: 'ref',
    available: available[m.id] ?? false,
  }))
}

describe('defaultManagerSelection', () => {
  it('selects 1Password when op is detected (acceptance criterion 3)', () => {
    expect(defaultManagerSelection(managers({ op: true, bw: true }), null)).toBe('op')
  })

  it('falls back to the first AVAILABLE manager when op is absent', () => {
    expect(defaultManagerSelection(managers({ bw: true, pass: true }), null)).toBe('bw')
  })

  it('prefers a remembered choice when that manager is available (acceptance criterion 5)', () => {
    expect(defaultManagerSelection(managers({ op: true, bw: true }), { manager: 'bw' })).toBe('bw')
  })

  it('ignores a remembered choice whose CLI is no longer installed (falls back to first available)', () => {
    // Remembered `pass`, but pass is gone now → don't pre-select an unselectable option.
    expect(defaultManagerSelection(managers({ op: true }), { manager: 'pass' })).toBe('op')
  })

  it('returns null when NO manager is available (nothing is selectable)', () => {
    expect(defaultManagerSelection(managers({}), null)).toBeNull()
  })
})

describe('canConvert', () => {
  it('allows convert with a selectable manager + a non-empty reference', () => {
    expect(canConvert(managers({ op: true }), 'op', 'op://vault/item/field')).toBe(true)
  })

  it('blocks convert when the reference is blank', () => {
    expect(canConvert(managers({ op: true }), 'op', '   ')).toBe(false)
  })

  it('blocks convert when no manager is selected', () => {
    expect(canConvert(managers({ op: true }), null, 'op://vault/item/field')).toBe(false)
  })

  it('blocks convert when the selected manager is unavailable (defensive)', () => {
    expect(canConvert(managers({ op: false }), 'op', 'op://vault/item/field')).toBe(false)
  })
})
