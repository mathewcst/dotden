/**
 * pm-picker — the PURE selection + enablement rules behind {@link SecretPicker} (issue 2-05).
 *
 * Extracted from the component so the picker's DECISIONS are unit-testable without a renderer
 * (the codebase's renderer tests are pure-logic; see `onboarding/secret-warn.ts`). The component
 * stays a thin shell that renders these decisions:
 *
 * - {@link defaultManagerSelection} — which manager is pre-selected when the picker opens
 *   (acceptance criteria 3 + 5: 1Password auto-ready when `op` is detected; a remembered choice
 *   wins when its CLI is still installed).
 * - {@link canConvert} — whether the Convert action is enabled (a selectable manager + a non-empty
 *   reference), so the user can't fire a conversion that would produce an unresolvable template.
 */
import type { DetectedPasswordManager, PasswordManagerId } from '@shared/secrets'
import type { PmPreference } from '@shared/secrets'

/**
 * Decide which manager is selected when the picker opens.
 *
 * Order of preference:
 * 1. a remembered choice whose CLI is still **available** here (acceptance criterion 5) — a
 *    remembered manager that is no longer installed is ignored, never pre-selecting a disabled
 *    option;
 * 2. otherwise the FIRST available manager in display order — since 1Password leads the catalog,
 *    this auto-selects it whenever `op` is detected (acceptance criterion 3);
 * 3. `null` when nothing is available (no option is selectable — the picker shows all disabled).
 *
 * @param managers The detected catalog (each annotated with `available`), in display order.
 * @param preference The remembered preference, or null when none.
 * @returns The id to pre-select, or null when no manager is selectable.
 */
export function defaultManagerSelection(
  managers: readonly DetectedPasswordManager[],
  preference: PmPreference | null,
): PasswordManagerId | null {
  // A remembered choice wins, but only if its CLI is still installed here.
  if (preference) {
    const remembered = managers.find((m) => m.id === preference.manager)
    if (remembered?.available) return remembered.id
  }
  // Otherwise the first available manager (1Password leads the catalog → auto-ready when detected).
  return managers.find((m) => m.available)?.id ?? null
}

/**
 * Whether the Convert action is enabled — guards against firing a conversion that would produce an
 * unresolvable template. Requires a selected manager that is actually **available** (defensive: the
 * UI never lets a disabled row be selected, but we re-check) AND a non-empty reference.
 *
 * @param managers The detected catalog.
 * @param selected The currently selected manager id, or null.
 * @param reference The reference the user typed (trimmed here).
 * @returns True when Convert may proceed.
 */
export function canConvert(
  managers: readonly DetectedPasswordManager[],
  selected: PasswordManagerId | null,
  reference: string,
): boolean {
  if (!selected) return false
  if (reference.trim().length === 0) return false
  return managers.some((m) => m.id === selected && m.available)
}
