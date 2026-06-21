import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * IconButton — the icon-only button from the design system (Figma `IconButton`, node
 * 53:2). A **bespoke** `den/` component: shadcn ships no behavioral equivalent, so per
 * ADR 0036 ("fully bespoke where shadcn has no behavioral equivalent — …IconButton")
 * custom is simply correct — there is no `ui/` primitive to compose over and no behavior
 * to badly-copy. A square, ghost-by-default hit target holding a single Lucide glyph:
 * the titlebar's bell/settings, the `WORKSPACES` add affordance, and the environment
 * footer. Swap the nested icon via {@link IconButtonProps.children}.
 *
 * Sizes mirror the design: `md` (28px) on the titlebar, `sm` (24px) inside dense pane
 * headers/footers. The glyph itself stays 14px in both so it reads at the same weight as
 * the surrounding Lucide icons.
 */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Square edge of the hit target. `md` = 28px (titlebar), `sm` = 24px (pane chrome). */
  readonly size?: 'sm' | 'md'
}

export function IconButton({ size = 'md', className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        '[&_svg]:size-3.5',
        size === 'md' ? 'size-7' : 'size-6',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
