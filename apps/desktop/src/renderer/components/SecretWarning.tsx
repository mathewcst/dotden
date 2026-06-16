import { AlertDialog } from '@base-ui/react/alert-dialog'
import { AlertTriangle } from 'lucide-react'
import type { SecretFinding } from '../../main/foundation/secret-scanner'
import { Button } from '@/components/ui/button'

/** Props for {@link SecretWarning}. */
export interface SecretWarningProps {
  /** Whether the warn step is shown (controlled — the caller owns open state). */
  readonly open: boolean
  /** Called when the modal requests to close (scrim click, Esc, Cancel). */
  readonly onOpenChange: (open: boolean) => void
  /** The commit-time scan findings to warn about (one card each). Never empty when open. */
  readonly findings: readonly SecretFinding[]
  /** Proceed with the Commit anyway (this slice's single path; Convert lands in 2-04/2-05). */
  readonly onContinue: () => void
  /** Disable Continue while the Commit it triggers is in flight. */
  readonly continueDisabled?: boolean
}

/**
 * SecretWarning — the commit-time **warn step** (Step 1 of the secret flow), issue 2-03.
 *
 * The PURE {@link import('../../main/foundation/secret-scanner.js').scanForSecrets} detector
 * runs on the about-to-be-Committed Files; when it finds anything, the renderer shows THIS
 * modal before the Commit completes (secret-and-errors screen spec). It is a **caution**,
 * not a hard block — the Commit can always proceed (warn-never-block, ADR 0001) — so it is
 * styled **warn-amber**, never destructive-red (functional-colour discipline reserves red
 * for failure/delete; catching a secret is non-destructive and the remedy is safe).
 *
 * Per finding it shows the **File** (mono), an amber `SECRET` pill + the **kind** and
 * **line** ("AWS Access Key ID · line 3"), and the **masked value** preview
 * (`AKIA••••••••••••N7QX`) so the user sees exactly what was flagged without re-exposing it
 * (the masking is the scanner's security invariant — the full value never reaches the UI).
 *
 * Scope of THIS slice (issue 2-03): detection + the warn surface only. The deliberate
 * two-option choice (Convert to a Secret reference / Commit anyway + the per-File "don't warn
 * again" allowlist) and the password-manager conversion land in issues 2-04/2-05; here the
 * footer is **Cancel** (don't Commit yet — go fix it) / **Commit anyway** (proceed), so the
 * user always stays in control.
 *
 * Built on `@base-ui/react/alert-dialog` (like {@link import('./ConfirmDialog.js').ConfirmDialog})
 * so it is a real focus-trapped, Esc/scrim-dismissible alert dialog rendered over the
 * scrim-dimmed home — the modal-over-app precedent.
 */
export function SecretWarning({
  open,
  onOpenChange,
  findings,
  onContinue,
  continueDisabled = false,
}: SecretWarningProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        {/* Scrim — the dark app stays dimly visible behind the modal (modal-over-app pattern). */}
        <AlertDialog.Backdrop className="bg-dd-black/40 fixed inset-0 z-50" />
        <AlertDialog.Popup className="bg-card text-card-foreground border-border fixed top-1/2 left-1/2 z-50 w-[35rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-5 shadow-lg">
          {/* Amber badge — the warn tone (NOT red): a secret is a caution, not a failure. */}
          <div
            className="bg-dd-amber-950 text-dd-amber-400 mb-3 inline-flex size-9 items-center justify-center rounded-full"
            aria-hidden
          >
            <AlertTriangle className="size-5" />
          </div>
          <AlertDialog.Title className="text-base font-semibold">
            {findings.length === 1 ? 'Possible secret detected' : 'Possible secrets detected'}
          </AlertDialog.Title>
          <AlertDialog.Description className="text-muted-foreground mt-2 text-sm leading-relaxed">
            dotden flagged {findings.length === 1 ? 'a value' : `${findings.length} values`} that
            look like {findings.length === 1 ? 'a secret' : 'secrets'}. Committing
            {findings.length === 1 ? ' it' : ' them'} would sync the value raw to every environment.
            Review below — you can still Commit if this is intentional.
          </AlertDialog.Description>

          {/* One detected card per finding — File (mono) + amber SECRET pill + kind·line + the
              masked value, so the user sees exactly what was flagged without re-exposure. */}
          <div className="mt-4 flex max-h-72 flex-col gap-2 overflow-y-auto">
            {findings.map((finding, index) => (
              <div
                key={`${finding.file}:${finding.line}:${index}`}
                className="bg-muted border-border rounded-lg border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-foreground truncate font-mono text-xs">{finding.file}</span>
                  <span className="bg-dd-amber-950 text-dd-amber-400 shrink-0 rounded-full px-2 py-0.5 text-[0.625rem] font-semibold tracking-wide uppercase">
                    Secret
                  </span>
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {finding.kind} · line {finding.line}
                </div>
                {/* The masked preview — never the full value (scanner security invariant). */}
                <div className="text-foreground mt-1 font-mono text-xs break-all">
                  {finding.maskedValue}
                </div>
              </div>
            ))}
          </div>

          {/* Footer — Cancel (don't Commit yet) / Commit anyway (proceed; warn-never-block). */}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close
              render={
                <Button variant="outline" size="sm">
                  Cancel
                </Button>
              }
            />
            <Button
              variant="default"
              size="sm"
              disabled={continueDisabled}
              onClick={() => {
                onContinue()
                onOpenChange(false)
              }}
            >
              Commit anyway
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
