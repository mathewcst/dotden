import type { ReactNode } from 'react'
import { AlertDialog } from '@base-ui/react/alert-dialog'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/den/button'

/**
 * Tone of a {@link ConfirmDialog} — mirrors the Figma `Dialog` SET's `Tone` prop
 * (`Default | Destructive`, confirm-dialogs screen spec).
 *
 * `default` is the ember Primary Confirm for SAFE actions (Track, **Untrack**) — note
 * Untrack is non-destructive, so it is deliberately NOT styled destructive despite
 * being a "removal". `destructive` is the red Confirm + alert-triangle badge reserved
 * for the **Delete everywhere** verb (functional-colour discipline: red == destructive).
 */
export type ConfirmTone = 'default' | 'destructive'

/** Props for {@link ConfirmDialog}. */
export interface ConfirmDialogProps {
  /** Whether the modal is shown (controlled — the caller owns open state). */
  readonly open: boolean
  /** Called when the dialog requests to close (scrim click, Esc, Cancel, or Confirm). */
  readonly onOpenChange: (open: boolean) => void
  /** Heading — the question being confirmed (Sans/Heading, spec `Title#266:0`). */
  readonly title: string
  /** Explanatory body copy — must state the verb's real effect (spec `Body#266:1`). */
  readonly body: ReactNode
  /** Confirm button label, relabeled per screen (spec `Label#39:0`), e.g. `Untrack`. */
  readonly confirmLabel: string
  /** Tone: ember Primary (safe) or red Destructive (deletes). Defaults to `default`. */
  readonly tone?: ConfirmTone
  /**
   * Optional badge glyph for the **Default-tone** dialog (e.g. the `rotate-ccw` restore
   * badge, file-history.md). The destructive tone always shows its own red alert-triangle
   * badge, so this prop is honored only when `tone === 'default'` — it lets a safe action
   * carry a meaningful glyph without borrowing the red-reserved destructive treatment.
   */
  readonly badge?: ReactNode
  /** Run when the user confirms; the dialog then closes via {@link onOpenChange}. */
  readonly onConfirm: () => void
  /** Disable the Confirm button while a related operation is in flight. */
  readonly confirmDisabled?: boolean
}

/**
 * ConfirmDialog — the Track / Untrack / Delete-everywhere confirmation modal
 * (confirm-dialogs screen spec, issue 1-08). A `den/` branded surface (ADR 0036).
 *
 * Built on `@base-ui/react/alert-dialog` so it is a real accessible alert dialog
 * (focus-trapped, Esc/scrim dismissible, `role="alertdialog"`) rather than a hand-rolled
 * overlay — an alert dialog is the right semantic because these confirm a consequential
 * action. The visual assembly mirrors the Figma `Dialog` primitive: a scrim-dimmed
 * backdrop (the already-dark app stays dimly visible for context) over a centered card
 * holding an optional badge, Title, Body, and a footer of two reused {@link Button}
 * instances (the `den/button`) — an **Outline Cancel** + a Primary/Destructive **Confirm**.
 *
 * dotden never deletes silently: the destructive tone shows the alert-triangle badge in
 * red and the caller passes a Body that names every affected environment, so the user
 * sees the blast radius before confirming (never fail silently).
 *
 * Phase A keeps this bespoke base-ui assembly verbatim (only the Button import moves to
 * `den/`); rebuilding it onto the shadcn `ui/alert-dialog` compound is a Phase B refinement.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  tone = 'default',
  badge,
  onConfirm,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const destructive = tone === 'destructive'
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        {/* Scrim — dd/black @ 0.4 so the dark app stays dimly visible behind the modal
            (the modal-over-app pattern, confirm-dialogs spec). */}
        <AlertDialog.Backdrop className="bg-dd-black/40 fixed inset-0 z-50" />
        <AlertDialog.Popup className="bg-card text-card-foreground border-border fixed top-1/2 left-1/2 z-50 w-[28rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-5 shadow-lg">
          {/* Destructive badge — the only screen that uses red (functional-colour). */}
          {destructive ? (
            <div
              className="bg-dd-red-950 text-dd-red-400 mb-3 inline-flex size-9 items-center justify-center rounded-full"
              aria-hidden
            >
              <AlertTriangle className="size-5" />
            </div>
          ) : badge ? (
            // Default-tone badge (e.g. restore's rotate-ccw) — ember, never red, so a SAFE
            // action reads as safe (file-history.md: restore-forward is non-destructive).
            <div
              className="bg-dd-amber-950 text-dd-amber-400 mb-3 inline-flex size-9 items-center justify-center rounded-full"
              aria-hidden
            >
              {badge}
            </div>
          ) : null}
          <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description
            render={<div />}
            className="text-muted-foreground mt-2 text-sm leading-relaxed"
          >
            {body}
          </AlertDialog.Description>
          {/* Footer — reused Button instances: Outline Cancel + Primary/Destructive Confirm. */}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close
              render={
                <Button variant="outline" size="sm">
                  Cancel
                </Button>
              }
            />
            <Button
              variant={destructive ? 'destructive' : 'default'}
              size="sm"
              disabled={confirmDisabled}
              onClick={() => {
                onConfirm()
                onOpenChange(false)
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
