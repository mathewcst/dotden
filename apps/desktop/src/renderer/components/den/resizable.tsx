import type { ComponentProps } from 'react'
import {
  ResizableHandle as UiResizableHandle,
  ResizablePanel as UiResizablePanel,
  ResizablePanelGroup as UiResizablePanelGroup,
} from '@/components/ui/resizable'
import { cn } from '@/lib/utils'

/**
 * Resizable* — the dotden branded resize primitives (ADR 0036 `den/` surface), composing
 * over the vanilla shadcn `components/ui/resizable` (a thin styling wrapper over
 * `react-resizable-panels`, which owns all drag / persist / keyboard behaviour).
 *
 * **Why the `data-[panel-group-direction=vertical]` overrides exist.** The installed
 * `react-resizable-panels@3` emits `data-panel-group-direction` on the group and handle,
 * but the CLI-owned `ui/resizable` keys its vertical layout off `aria-[orientation]`
 * — a shadcn-vanilla/library mismatch: the library sets no `aria-orientation`, so a
 * vertical group would never flip to a column and the handle would stay a vertical rail.
 * We must not hand-edit `ui/` (the next `shadcn add` overwrites it, ADR 0036), so the
 * `den/` wrapper re-supplies the direction-aware classes the *real* attribute drives.
 * Tailwind's data-attribute variant carries higher specificity than the base width/flex
 * utilities, so the vertical override wins deterministically over `ui/`'s base classes.
 *
 * (Rebuilding `ui/resizable` to the data-attribute selector upstream — or pinning a
 * matching shadcn registry version — is tracked as a Phase B / dependency follow-up.)
 */
export function ResizablePanelGroup({
  className,
  ...props
}: ComponentProps<typeof UiResizablePanelGroup>) {
  return (
    <UiResizablePanelGroup
      className={cn('data-[panel-group-direction=vertical]:flex-col', className)}
      {...props}
    />
  )
}

/** Single resizable pane — re-exported unchanged; it carries no direction styling. */
export const ResizablePanel = UiResizablePanel

export function ResizableHandle({ className, ...props }: ComponentProps<typeof UiResizableHandle>) {
  return (
    <UiResizableHandle
      className={cn(
        // Vertical groups: flip the 1px divider from a column rail to a row rail and
        // re-centre the hit-area pseudo-element + grip. Keyed on data-panel-group-direction
        // (what react-resizable-panels actually sets), not aria-orientation — see header.
        'data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full',
        'data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:translate-x-0 data-[panel-group-direction=vertical]:after:-translate-y-1/2',
        '[&[data-panel-group-direction=vertical]>div]:rotate-90',
        className,
      )}
      {...props}
    />
  )
}
