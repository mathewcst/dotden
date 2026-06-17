import { useDenSession } from '@/features/shell/components/DenSessionProvider'

/**
 * LastCommitSection — the inspector's outbound-status block (env A): the honest "nothing to commit"
 * notice and the "Last commit" callout. The notice is neutral info (a clean no-op, never the red
 * error channel — ADR 0001); the callout is honest about WHERE the change is (Auto-sync pushed it
 * to the Remote vs Manual leaves it local until Sync now — never imply a sync that did not happen).
 */
export function LastCommitSection() {
  const role = useDenSession((s) => s.role)
  const commitNotice = useDenSession((s) => s.commitNotice)
  const lastCommitMessage = useDenSession((s) => s.lastCommitMessage)
  const lastCommitPushed = useDenSession((s) => s.lastCommitPushed)

  return (
    <>
      {role === 'a' && commitNotice ? (
        <p className="text-dd-blue-400 text-xs" role="status">
          {commitNotice}
        </p>
      ) : null}

      {role === 'a' && lastCommitMessage ? (
        <section className="border-border bg-card rounded-md border p-3">
          <h2 className="mb-1 text-xs font-semibold tracking-wide">LAST COMMIT</h2>
          <p className="font-mono text-xs wrap-break-word">{lastCommitMessage}</p>
          {/* Honest about where the change actually is: Auto-sync auto-pushed it to the Remote;
              Manual leaves it local until Sync now (never imply a sync that did not happen). */}
          {lastCommitPushed ? (
            <p className="text-dd-green-400 mt-2 text-xs">
              Committed and synced — Auto-sync pushed this to your repo.
            </p>
          ) : (
            <p className="text-dd-blue-400 mt-2 text-xs">
              Committed locally — this stays on this environment until you Sync now.
            </p>
          )}
        </section>
      ) : null}
    </>
  )
}
