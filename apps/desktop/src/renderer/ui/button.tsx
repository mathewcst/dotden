import { Button as BaseButton } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '@/shared/lib/utils'

const buttonVariants = cva(
  'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        // Destructive — the red Confirm for the Delete-everywhere dialog (functional
        // colour discipline: red is reserved for destructive intent, design system).
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        // Outline — the Cancel button on confirm cards. Cancel is Outline (not
        // Secondary) because a Secondary button vanishes on the popover-toned card
        // (confirm-dialogs screen spec), so it reads as a bordered, transparent button.
        outline: 'border-border bg-transparent text-foreground hover:bg-secondary/40 shadow-none',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type ButtonProps = React.ComponentPropsWithoutRef<typeof BaseButton> &
  VariantProps<typeof buttonVariants>

function Button({ className, variant, size, ...props }: ButtonProps) {
  return <BaseButton className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
