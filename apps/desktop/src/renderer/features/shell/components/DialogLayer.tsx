import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { SecretPicker } from '@/features/secrets/components/SecretPicker'
import { SecretWarning } from '@/features/secrets/components/SecretWarning'
import { useDenSession } from '@/features/shell/components/DenSessionProvider'

/**
 * DialogLayer — the den window's shared dialog orchestration (ADR 0027: the shell owns dialogs).
 * Renders, off the store, the lifecycle confirm (Untrack / Delete-everywhere / incoming-deletion)
 * and the two-step secret flow (the amber warn step + the password-manager picker). Each dialog is
 * driven entirely by its slice's state; the shell just composes them over the three-pane body.
 */
export function DialogLayer() {
  const confirm = useDenSession((s) => s.confirm)
  const secretWarn = useDenSession((s) => s.secretWarn)
  const secretPicker = useDenSession((s) => s.secretPicker)
  const busy = useDenSession((s) => s.busy)
  const setConfirm = useDenSession((s) => s.setConfirm)
  const runConfirmedVerb = useDenSession((s) => s.runConfirmedVerb)
  const setSecretWarn = useDenSession((s) => s.setSecretWarn)
  const setSecretPicker = useDenSession((s) => s.setSecretPicker)
  const openConvertPicker = useDenSession((s) => s.openConvertPicker)
  const commitAnyway = useDenSession((s) => s.commitAnyway)
  const convertSecret = useDenSession((s) => s.convertSecret)

  return (
    <>
      {/* The Untrack / Delete-everywhere / incoming-deletion confirm (confirm-dialogs screen spec).
          Untrack is Default tone with copy that the File STAYS ON DISK everywhere; Delete everywhere
          is Destructive tone and NAMES every affected environment; an incoming deletion (invariant
          #4) is Destructive tone and states the real file is removed here — so the user always sees
          the consequence before confirming (never fail silently). */}
      {confirm ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setConfirm(null)
          }}
          tone={
            confirm.verb === 'untrack' || confirm.verb === 'move-workspace'
              ? 'default'
              : 'destructive'
          }
          confirmLabel={
            confirm.verb === 'untrack'
              ? 'Untrack'
              : confirm.verb === 'apply-deletion'
                ? 'Delete file'
                : confirm.verb === 'discard'
                  ? 'Discard changes'
                  : confirm.verb === 'move-workspace'
                    ? 'Move File'
                    : 'Delete everywhere'
          }
          confirmDisabled={busy !== null}
          onConfirm={runConfirmedVerb}
          title={
            confirm.verb === 'untrack'
              ? `Untrack ${confirm.path}?`
              : confirm.verb === 'apply-deletion'
                ? `Apply incoming deletion of ${confirm.path}?`
                : confirm.verb === 'discard'
                  ? `Discard local changes to ${confirm.path}?`
                  : confirm.verb === 'move-workspace'
                    ? `Move ${confirm.path} to another Workspace?`
                    : `Delete ${confirm.path} everywhere?`
          }
          body={
            confirm.verb === 'untrack' ? (
              <>
                dotden will stop managing <span className="font-mono">{confirm.path}</span>. The
                real file <strong>stays on disk on every environment</strong> — nothing is deleted,
                and you can Track it again later.
              </>
            ) : confirm.verb === 'apply-deletion' ? (
              <>
                This File was removed from the Den on another environment. Applying the change will{' '}
                <strong>delete the real file</strong>{' '}
                <span className="font-mono">{confirm.path}</span> on this environment.
                <span className="mt-2 block">This can&rsquo;t be undone.</span>
              </>
            ) : confirm.verb === 'discard' ? (
              <>
                dotden will restore <span className="font-mono">{confirm.path}</span> from the Den
                and <strong>throw away this environment&rsquo;s uncommitted local edit</strong>.
                <span className="mt-2 block">Commit first if you want to keep these changes.</span>
              </>
            ) : confirm.verb === 'move-workspace' ? (
              <>
                Moving a File to another Workspace changes which environments can apply it. The
                File&rsquo;s path stays the same, and dotden will reset it to the destination
                Workspace root.
              </>
            ) : (
              <>
                This removes <span className="font-mono">{confirm.path}</span> from your Den
                <strong> and deletes the real file</strong> on every environment where it applies:
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {confirm.affected.map((env) => (
                    <span
                      key={env.id}
                      className="border-border text-foreground rounded border px-1.5 py-0.5 text-xs"
                    >
                      {env.label}
                      {env.isSelf ? ' (this environment)' : ''}
                    </span>
                  ))}
                </span>
                <span className="mt-2 block">This can&rsquo;t be undone.</span>
              </>
            )
          }
        />
      ) : null}

      {/* Commit-time secret warn step (issue 2-03): when the pre-Commit scan flagged a possible
          secret, show the amber warn caution BEFORE the Commit completes. It never blocks (ADR
          0001) — "Commit anyway" proceeds with the exact stashed paths; Cancel closes without
          Committing so the user can go convert/edit the value. */}
      {secretWarn ? (
        <SecretWarning
          // Re-mount per warn session so the modal's choice/checkbox state starts fresh each time
          // (no reset effect — keeps state changes out of effects, react-patterns). The session
          // signature is this scan's exact paths, which differ per Commit attempt.
          key={secretWarn.paths.join('\u001f')}
          open
          onOpenChange={(next) => {
            if (!next) setSecretWarn(null)
          }}
          findings={secretWarn.findings}
          continueDisabled={busy !== null}
          onConvert={() => {
            // Convert → step 2, the password-manager picker (issue 2-05). Detect installed managers
            // + the remembered preference, then open the picker for the flagged File. The warn step
            // closes; nothing is Committed until the user converts.
            openConvertPicker(secretWarn.findings)
          }}
          onCommitAnyway={(dontWarnAgain) => {
            // Commit anyway (issue 2-04): when the user ticked "Don't warn me about this File
            // again", allowlist the shown findings FIRST (synced, per File+match) so they stop
            // warning on future Commits — then record the Commit either way (warn-not-block).
            void commitAnyway(secretWarn.findings, secretWarn.paths, dontWarnAgain)
          }}
        />
      ) : null}

      {/* Secret flow step 2 (issue 2-05): the password-manager picker. Opened from the warn step's
          Convert; converting writes the chezmoi `.tmpl` Secret reference into source state + Commits
          it — only the reference enters the Den, the raw secret stays in the user's vault. */}
      {secretPicker ? (
        <SecretPicker
          // Re-mount per convert session so selection/input state starts fresh (react-patterns).
          key={secretPicker.targetPath}
          open
          onOpenChange={(next) => {
            if (!next) setSecretPicker(null)
          }}
          managers={secretPicker.managers}
          preference={secretPicker.preference}
          targetPath={secretPicker.targetPath}
          convertDisabled={busy !== null}
          onBack={() => {
            // Back → return to step 1 (the warn step is still stashed in secretWarn).
            setSecretPicker(null)
          }}
          onConvert={(request) => {
            convertSecret(request)
          }}
        />
      ) : null}
    </>
  )
}
