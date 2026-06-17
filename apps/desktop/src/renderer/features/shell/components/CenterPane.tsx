import { ChangesDiff } from '@/features/commit/components/ChangesDiff'
import { FileHistory } from '@/features/file-history/components/FileHistory'
import { StatusTag, type FileStatus } from '@/shared/components/StatusTag'
import { Button } from '@/ui/button'
import { useDenSession } from '@/features/shell/components/DenSessionProvider'
import { Download, FilePlus2, GitCommitVertical, Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'

/**
 * CenterPane — the den window's center column: the selected-File header + verb toolbar (Commit/Sync
 * on env A, Detect/Review on env B), the Changes/History/Scope tabs, the env-A Track input, and the
 * body (the {@link ChangesDiff} diff or the per-File {@link FileHistory}).
 *
 * Shared session state comes from the store; the Track field's text is genuinely ephemeral so it
 * stays in local `useState` (per ADR 0027) — the store's `track` action fires an `onTracked`
 * callback the instant the Track lands, so the input is cleared mid-flow and only on success (a
 * failed Track keeps the typed path for retry).
 */
export function CenterPane() {
  const role = useDenSession((s) => s.role)
  const selected = useDenSession((s) => s.selected)
  const files = useDenSession((s) => s.files)
  const incoming = useDenSession((s) => s.incoming)
  const busy = useDenSession((s) => s.busy)
  const centerTab = useDenSession((s) => s.centerTab)
  const automationLevel = useDenSession((s) => s.automationLevel)
  const setCenterTab = useDenSession((s) => s.setCenterTab)
  const commitChanged = useDenSession((s) => s.commitChanged)
  const push = useDenSession((s) => s.push)
  const list = useDenSession((s) => s.list)
  const setReviewing = useDenSession((s) => s.setReviewing)
  const track = useDenSession((s) => s.track)

  // The Track input text — ephemeral UI state, kept local (per ADR 0027).
  const [newPath, setNewPath] = useState('')

  const selectedFile = files.find((f) => f.targetPath === selected)
  const selectedIncoming = incoming.find((i) => i.targetPath === selected)
  // The header/inspector status pill for the selected File (the honest dotden state).
  const headerStatus: FileStatus | null = selectedIncoming
    ? 'incoming'
    : selectedFile && !selectedFile.muted && selectedFile.status !== null
      ? 'tracked'
      : null
  const changedCount = files.filter((f) => !f.muted && f.status !== null).length
  const autoSyncOn = automationLevel === 'auto-sync'

  // Track the typed path; the store clears the input (via the callback) the instant the Track lands.
  const doTrack = () => void track(newPath, () => setNewPath(''))

  return (
    <main className="flex min-w-0 flex-col overflow-hidden">
      <div className="border-border flex items-center gap-3 border-b px-4 py-2">
        <span className="font-mono text-sm">{selected ? `~/${selected}` : 'Select a File'}</span>
        {headerStatus ? <StatusTag status={headerStatus} /> : null}
        {selectedFile?.muted ? (
          <span className="text-muted-foreground rounded-full px-2 py-0.5 text-xs">
            Scoped out of this OS
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {role === 'a' ? (
            <>
              <Button
                size="sm"
                disabled={busy !== null || changedCount === 0}
                onClick={commitChanged}
                // Commit is never automatic at any level (ADR 0006/0008); the tooltip makes the
                // Auto-sync nuance explicit: Auto-sync only auto-PUSHES the Commit you make here —
                // it never decides WHAT to Commit.
                title={
                  autoSyncOn
                    ? 'Record these changes into your Den. Auto-sync will push them automatically — but Committing is always your call.'
                    : 'Record these changes into your Den. They stay local until you Sync now.'
                }
              >
                {busy === 'commit' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <GitCommitVertical className="size-4" />
                )}
                Commit changes
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={push}
                // Sync-now polish (issue 1-12): the tooltip makes the transport-not-apply distinction
                // transparent. "Sync now" pushes pending Commits and fetches incoming, then PRESENTS
                // incoming for review — it does NOT Apply.
                title="Sync now: push your pending Commits and fetch incoming changes, then review them before Applying. Sync never Applies for you."
              >
                {busy === 'push' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Sync now
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" disabled={busy !== null} onClick={list}>
                {busy === 'list' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Detect incoming
              </Button>
              <Button
                size="sm"
                disabled={busy !== null || incoming.length === 0}
                onClick={() => setReviewing(true)}
              >
                {busy === 'apply' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                Review &amp; Apply
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tabs — Changes is the everyday diff; History (2-01) is the per-File version list +
          read-only preview; Scope (1-15) is surfaced in the inspector. History is meaningful for a
          managed File on env A (incoming-review env B has no committed history to show), so it is
          only selectable there. */}
      <div className="border-border text-muted-foreground flex items-center gap-4 border-b px-4 text-xs">
        <button
          type="button"
          onClick={() => setCenterTab('changes')}
          className={
            centerTab === 'changes'
              ? 'text-foreground border-primary border-b-2 py-2 font-medium'
              : 'hover:text-foreground border-b-2 border-transparent py-2'
          }
        >
          Changes
        </button>
        <button
          type="button"
          onClick={() => setCenterTab('history')}
          disabled={role !== 'a' || !selectedFile}
          className={
            centerTab === 'history'
              ? 'text-foreground border-primary border-b-2 py-2 font-medium'
              : 'hover:text-foreground border-b-2 border-transparent py-2 disabled:cursor-default disabled:opacity-50 disabled:hover:text-current'
          }
        >
          History
        </button>
        <span className="cursor-default py-2 opacity-50">Scope</span>
      </div>

      {/* env A: Track a File by path (a browse-pick stand-in for the MVP shell). */}
      {role === 'a' ? (
        <div className="border-border flex items-center gap-2 border-b px-4 py-2">
          <input
            className="border-input bg-background flex-1 rounded-md border px-3 py-1.5 font-mono text-sm"
            placeholder="~/.zshrc — File path to Track"
            value={newPath}
            onChange={(event) => setNewPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') doTrack()
            }}
          />
          <Button size="sm" disabled={busy !== null || !newPath.trim()} onClick={doTrack}>
            {busy === 'track' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FilePlus2 className="size-4" />
            )}
            Track
          </Button>
        </div>
      ) : null}

      {/* History tab (issue 2-01): the per-File version list + read-only preview, a master-detail
          surface that owns its own independent-scroll regions. Only for a managed File on env A; if
          the active tab is History but the selection no longer qualifies (e.g. the File was
          deselected), fall through to the Changes body. */}
      {centerTab === 'history' && role === 'a' && selectedFile ? (
        <FileHistory key={selected} targetPath={selectedFile.targetPath} />
      ) : (
        <ChangesDiff />
      )}
    </main>
  )
}
