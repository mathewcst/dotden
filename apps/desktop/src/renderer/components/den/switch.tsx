import type { ComponentProps } from 'react'
import { Switch as UiSwitch } from '@/components/ui/switch'

/**
 * Switch — the dotden branded on/off toggle (ADR 0036 `den/` surface).
 *
 * A pass-through over the vanilla shadcn {@link UiSwitch} (`components/ui/switch`, a
 * Base UI `Switch.Root`): the toggle's accessibility (keyboard, ARIA, the `data-checked`
 * state) and the ember "on" track come for free from the primitive plus the `index.css`
 * token layer (ember is the sole interactive hue, ADR 0017). dotden adds no behaviour
 * here — the wrapper exists so app/feature code renders through one branded import root
 * (`den/`) while `ui/` stays a swappable vendor detail (ADR 0036). Settings rows drive it
 * controlled via `checked` / `onCheckedChange`.
 */
export type SwitchProps = ComponentProps<typeof UiSwitch>

export function Switch(props: SwitchProps) {
  return <UiSwitch {...props} />
}
