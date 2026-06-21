import { ChangesDiff } from '@/features/commit/components/ChangesDiff'
import { StatusTag, type FileStatus } from '@/shared/components/StatusTag'
import { Button } from '@/ui/button'
import { useDenSession } from '@/features/shell/components/DenSessionProvider'
import {
  Download,
  FilePlus2,
  FolderOpen,
  GitCommitVertical,
  Loader2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import { lazy, Suspense, useState } from 'react'

const FileHistory = lazy(() =>
  import('@/features/file-history/components/FileHistory').then((module) => ({
    default: module.FileHistory,
  })),
)

function HistoryLoading() {
  return <p className="text-muted-foreground p-4 text-sm">Loading history…</p>
}

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
  const selectedFile = useDenSession((s) => s.files.find((f) => f.targetPath === selected))
  const selectedIncoming = useDenSession((s) =>
    s.incoming.find((item) => item.targetPath === selected),
  )
  const changedCount = useDenSession(
    (s) => s.files.filter((f) => !f.muted && f.status !== null).length,
  )
  const incomingCount = useDenSession((s) => s.incoming.length)
  const busy = useDenSession((s) => s.busy)
  const centerTab = useDenSession((s) => s.centerTab)
  const automationLevel = useDenSession((s) => s.automationLevel)
  const setCenterTab = useDenSession((s) => s.setCenterTab)
  const commitChanged = useDenSession((s) => s.commitChanged)
  const push = useDenSession((s) => s.push)
  const list = useDenSession((s) => s.list)
  const setReviewing = useDenSession((s) => s.setReviewing)
  const setConfirm = useDenSession((s) => s.setConfirm)
  const track = useDenSession((s) => s.track)

  // The Track input text — ephemeral UI state, kept local (per ADR 0027).
  const [newPath, setNewPath] = useState('')

  // The header/inspector status pill for the selected File (the honest dotden state).
  const headerStatus: FileStatus | null = selectedIncoming
    ? 'incoming'
    : selectedFile && !selectedFile.muted && selectedFile.status !== null
      ? 'tracked'
      : null
  const autoSyncOn = automationLevel === 'auto-sync'

  // Track the typed path; the store clears the input (via the callback) the instant the Track lands.
  const doTrack = () => void track(newPath, () => setNewPath(''))

  async function setTrackPathFromPicker(targetPath: string | null) {
    if (!targetPath) return
    const suggestion = await window.dotden.discover.inspectPath(targetPath)
    setNewPath(suggestion?.targetPath ?? targetPath)
  }

  function dropTrack(file: File | undefined) {
    if (!file) return
    void setTrackPathFromPicker(window.dotden.discover.pathForFile(file))
  }

  async function browseTrack() {
    await setTrackPathFromPicker(await window.dotden.discover.browse())
  }

  return (
    // `h-full min-h-0` is load-bearing: this pane is a react-resizable-panels Panel child (a flex
    // item that does NOT stretch its child's height the way the old CSS-grid track did). Without it
    // <main> shrinks to content height, and any `flex-1`/`min-h-0` descendant — notably FileHistory's
    // vertical split — resolves against a 0px height and collapses to just its resize handle.
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
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
                disabled={busy !== null || !selectedFile || selectedFile.status === null}
                onClick={() => {
                  if (selectedFile) {
                    setConfirm({ verb: 'discard', path: selectedFile.targetPath, affected: [] })
                  }
                }}
                title="Discard this File's uncommitted local changes and restore it from your Den."
              >
                <RotateCcw className="size-4" />
                Discard
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
                disabled={busy !== null || incomingCount === 0}
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
          read-only preview. Scope editing lives in the inspector, so there is no fake disabled tab.
          History is meaningful for a
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
      </div>

      {/* env A: Track a File by path (a browse-pick stand-in for the MVP shell). */}
      {role === 'a' ? (
        <div
          className="border-border flex items-center gap-2 border-b px-4 py-2"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            dropTrack(event.dataTransfer.files[0])
          }}
        >
          <input
            className="border-input bg-background flex-1 rounded-md border px-3 py-1.5 font-mono text-sm"
            placeholder="~/.zshrc — File path to Track"
            value={newPath}
            onChange={(event) => setNewPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') doTrack()
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void browseTrack()}
          >
            <FolderOpen className="size-4" />
            Browse
          </Button>
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
        <Suspense fallback={<HistoryLoading />}>
          <FileHistory key={selected} targetPath={selectedFile.targetPath} />
        </Suspense>
      ) : (
        <ChangesDiff />
      )}
    </main>
  )
}
