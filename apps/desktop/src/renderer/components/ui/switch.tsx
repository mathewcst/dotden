import { Switch as BaseSwitch } from '@base-ui/react/switch'
import type * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Switch — the on/off toggle used by the Settings rows (issue 2-08; design-system
 * `Switch` `44:16`).
 *
 * A thin styled wrapper over base-ui's headless `Switch` so the toggle is accessible
 * (keyboard + ARIA handled by base-ui) while binding dd/* semantic tokens (ADR 0017):
 * the **on** track is `primary` (ember — the sole interactive hue), the **off** track is
 * the muted input surface, and the thumb is the foreground knob. Ember is reserved for
 * interactive controls only, so this is the one place the accent appears in a Settings row.
 *
 * @param checked Controlled on/off state.
 * @param onCheckedChange Fired with the next boolean when the user toggles it.
 */
export function Switch({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseSwitch.Root>) {
  return (
    <BaseSwitch.Root
      className={cn(
        // Track: pill rail; ember when on (data-checked), muted input surface when off.
        'focus-visible:outline-ring inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
        'bg-input data-[checked]:bg-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {/* Thumb: foreground knob that slides 16px right when checked. */}
      <BaseSwitch.Thumb className="bg-dd-ink-50 size-4 rounded-full shadow-sm transition-transform data-[checked]:translate-x-4" />
    </BaseSwitch.Root>
  )
}
