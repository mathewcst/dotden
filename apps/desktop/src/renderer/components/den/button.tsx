import type { ComponentProps } from 'react'
import { Button as UiButton } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Button — the dotden branded button (ADR 0036 `den/` surface).
 *
 * A thin wrapper that **composes over** the vanilla shadcn {@link UiButton}
 * (`components/ui/button`, itself a Base UI `Button`): it inherits every tested
 * behavior — focus ring, disabled handling, the `render` slot — for free, plus the
 * ember semantic tokens the `index.css` layer already binds (`--primary` →
 * `--dd-ember-500`). On top of that it adds the one dotden *default* the design
 * system mandates: the **destructive** verb renders as a SOLID red confirm
 * (white-on-red), not shadcn's soft tint, because red is reserved for destructive
 * intent (functional-colour discipline, CONTEXT.md / confirm-dialogs spec). That is a
 * `den/` default layered on `ui/` behaviour — never a re-implementation (ADR 0036's
 * "compose-over, never re-implement").
 *
 * Phase A only relocates the branded surface and preserves the call-site API
 * (`variant` ∈ default|secondary|destructive|outline, `size` ∈ default|sm — all already
 * on `ui/button`). The full Figma `37:2` variant/size set is Phase B.
 */
export type ButtonProps = ComponentProps<typeof UiButton>

export function Button({ className, variant, ...props }: ButtonProps) {
  return (
    <UiButton
      variant={variant}
      className={cn(
        // dotden functional-colour discipline: destructive is solid red, not a soft tint.
        variant === 'destructive' &&
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        className,
      )}
      {...props}
    />
  )
}
