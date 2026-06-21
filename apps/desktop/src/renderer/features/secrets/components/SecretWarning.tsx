import { AlertDialog } from '@base-ui/react/alert-dialog'
import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import type { SecretFinding } from '@shared/secrets'
import { Button } from '@/components/den/button'

/** The two deliberate paths Step 1 of the secret flow offers (secret-and-errors screen spec). */
export type SecretChoice = 'convert' | 'commit-anyway'

/** Props for {@link SecretWarning}. */
export interface SecretWarningProps {
  /** Whether the warn step is shown (controlled — the caller owns open state). */
  readonly open: boolean
  /** Called when the modal requests to close (scrim click, Esc, Cancel). */
  readonly onOpenChange: (open: boolean) => void
  /** The commit-time scan findings to warn about (one card each). Never empty when open. */
  readonly findings: readonly SecretFinding[]
  /**
   * Proceed with **Commit the secret anyway** (issue 2-04). `dontWarnAgain` carries the
   * per-File "Don't warn me about this File again" checkbox: when `true`, the caller allowlists
   * the shown findings (synced, scoped per File+match) BEFORE Committing so they stop warning.
   */
  readonly onCommitAnyway: (dontWarnAgain: boolean) => void
  /**
   * Choose **Convert to a Secret reference** (the recommended/default path) → step 2, the
   * password-manager picker (issue 2-05). Optional while step 2 is not yet built: when omitted,
   * the Convert option is still presented and selectable (acceptance criterion 1) but Continue
   * under it is a no-op rather than a faked conversion — the user can switch to Commit anyway.
   */
  readonly onConvert?: () => void
  /** Disable the footer action while the Commit it triggers is in flight. */
  readonly continueDisabled?: boolean
}

/**
 * SecretWarning — Step 1 of the secret flow: the commit-time **warn step** with the deliberate
 * two-option choice (issues 2-03 + 2-04, secret-and-errors screen spec).
 *
 * The PURE {@link import('@shared/secrets').scanForSecrets} detector
 * runs on the about-to-be-Committed Files; when it finds anything NOT already on the synced
 * allowlist, the renderer shows THIS modal before the Commit completes. It is a **caution**,
 * not a hard block — the Commit can always proceed (warn-never-block, ADR 0001) — so it is
 * styled **warn-amber**, never destructive-red (functional-colour discipline reserves red for
 * failure/delete; catching a secret is non-destructive and the remedy is safe).
 *
 * Per finding it shows the **File** (mono), an amber `SECRET` pill + the **kind** and **line**
 * ("AWS Access Key ID · line 3"), and the **masked value** preview (`AKIA••••••••••••N7QX`) so
 * the user sees exactly what was flagged without re-exposing it (the masking is the scanner's
 * security invariant — the full value never reaches the UI).
 *
 * **The deliberate two-option choice (issue 2-04).** A single `SelectRow`-style radio group with
 * exactly two mutually-exclusive options — **Convert to a Secret reference** (selected by
 * default, the recommended remedy) and **Commit the secret anyway** — so the decision is one the
 * user makes *consciously*, not a checkbox-next-to-a-button contradiction. Under "Commit anyway"
 * a per-File **"Don't warn me about this File again"** checkbox appears: ticking it allowlists
 * the shown findings so a File the user has judged safe stops nagging on future Commits. That
 * allowlist is SYNCED (ADR 0024), scoped per File+match — it never silently re-enables a real
 * leak (a new/different secret in the same File still warns). The footer's Continue routes to
 * step 2 (the password-manager picker, issue 2-05) when Convert is chosen, or records the Commit
 * (with optional allowlisting) when Commit anyway is chosen.
 *
 * Built on `@base-ui/react/alert-dialog` (like {@link import('./ConfirmDialog.js').ConfirmDialog})
 * so it is a real focus-trapped, Esc/scrim-dismissible alert dialog rendered over the
 * scrim-dimmed home — the modal-over-app precedent.
 */
export function SecretWarning({
  open,
  onOpenChange,
  findings,
  onCommitAnyway,
  onConvert,
  continueDisabled = false,
}: SecretWarningProps) {
  // The selected path — Convert is the recommended default (acceptance criterion 1). The parent
  // re-mounts this modal per warn session (via a `key`), so these initializers run fresh each
  // time and a prior session's selection never bleeds in — no reset effect needed (which would
  // trip react-hooks/set-state-in-effect; the codebase keeps state changes in event paths).
  const [choice, setChoice] = useState<SecretChoice>('convert')
  // The per-File "Don't warn me about this File again" decision — only meaningful under
  // Commit-anyway (the checkbox only renders there).
  const [dontWarnAgain, setDontWarnAgain] = useState(false)

  // How many distinct Files the findings touch — the "don't warn again" copy is per-File, so it
  // reads honestly whether one or several Files are involved.
  const fileCount = new Set(findings.map((f) => f.file)).size

  const handleContinue = () => {
    if (choice === 'commit-anyway') {
      onCommitAnyway(dontWarnAgain)
      onOpenChange(false)
      return
    }
    // Convert → step 2 (the password-manager picker, issue 2-05). While that step is not yet
    // wired, Convert is presented + selectable but Continue is a no-op rather than a faked
    // conversion — never proceed to a Commit the user did not choose (never fail silently).
    if (onConvert) {
      onConvert()
      onOpenChange(false)
    }
  }

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
            Review below, then choose what to do.
          </AlertDialog.Description>

          {/* One detected card per finding — File (mono) + amber SECRET pill + kind·line + the
              masked value, so the user sees exactly what was flagged without re-exposure. */}
          <div className="mt-4 flex max-h-56 flex-col gap-2 overflow-y-auto">
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

          {/* The deliberate two-option choice (issue 2-04): Convert (default) vs Commit anyway.
              A radio group makes them mutually exclusive — one decision, made consciously. */}
          <fieldset className="mt-4 grid gap-2">
            <label className="border-border bg-card flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
              <input
                type="radio"
                name="secret-choice"
                className="accent-dd-ember-500 mt-0.5 size-4"
                checked={choice === 'convert'}
                onChange={() => setChoice('convert')}
              />
              <span>
                <span className="text-foreground font-medium">Convert to a Secret reference</span>
                <span className="text-muted-foreground block text-xs">
                  Recommended — store the value in your password manager and sync only a reference,
                  never the raw secret.
                </span>
              </span>
            </label>

            <label className="border-border bg-card flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
              <input
                type="radio"
                name="secret-choice"
                className="accent-dd-ember-500 mt-0.5 size-4"
                checked={choice === 'commit-anyway'}
                onChange={() => setChoice('commit-anyway')}
              />
              <span className="flex-1">
                <span className="text-foreground font-medium">Commit the secret anyway</span>
                <span className="text-muted-foreground block text-xs">
                  The value syncs raw to every environment. Only do this if it&rsquo;s safe to share
                  across your computers.
                </span>

                {/* Per-File "don't warn" checkbox — appears ONLY under Commit anyway. Ticking it
                    allowlists these findings (synced, scoped per File+match) so this File stops
                    warning on future Commits, without muting a NEW secret in it. */}
                {choice === 'commit-anyway' ? (
                  <label className="mt-3 flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      className="accent-dd-ember-500 mt-0.5 size-3.5"
                      checked={dontWarnAgain}
                      onChange={() => setDontWarnAgain((v) => !v)}
                    />
                    <span className="text-muted-foreground text-xs">
                      Don&rsquo;t warn me about{' '}
                      {fileCount === 1 ? 'this File' : `these ${fileCount} Files`} again. This
                      decision syncs to all your environments; a new or different secret here will
                      still be flagged.
                    </span>
                  </label>
                ) : null}
              </span>
            </label>
          </fieldset>

          {/* Footer — Cancel (don't Commit yet) / Continue (route by the chosen path). */}
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
              disabled={continueDisabled || (choice === 'convert' && !onConvert)}
              onClick={handleContinue}
            >
              {choice === 'commit-anyway' ? 'Commit anyway' : 'Continue'}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
