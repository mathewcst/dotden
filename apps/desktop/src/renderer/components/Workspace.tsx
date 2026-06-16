import { useCallback, useMemo, useState } from 'react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { PatchDiff } from '@pierre/diffs/react'
import {
  Bell,
  CircleDot,
  Download,
  FilePlus2,
  GitCommitVertical,
  Loader2,
  RefreshCw,
  Settings,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusTag, type FileStatus } from '@/components/StatusTag'
import type { CommitResult, IncomingReviewItem } from '../../main/foundation/den-service'

/**
 * One File in the local Workspace view, with the dotden status the inspector shows.
 * Status moves Tracked → Committed·local → Pushed as the user drives the thread.
 */
interface LocalFile {
  readonly targetPath: string
  readonly status: FileStatus
}

/** Discriminates which environment's role this shell is driving (A vs B copy/actions). */
type Role = 'a' | 'b'

/** A throwaway unified-diff so the center pane exercises @pierre/diffs `PatchDiff`. */
function placeholderPatch(targetPath: string): string {
  // Minimal valid unified diff: the File being added. The real diff comes from
  // `chezmoi diff` in a later slice (1-07); here it proves the diff pane renders.
  return [
    `diff --git a/${targetPath} b/${targetPath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${targetPath}`,
    '@@ -0,0 +1 @@',
    '+# managed by dotden',
    '',
  ].join('\n')
}

/**
 * Workspace — the minimal three-pane shell (tree / diff / inspector) that drives the
 * end-to-end thread (issue 1-04), modeled on the signature screen.
 *
 * Left pane: a `@pierre/trees` FileTree of the environment's Files. Center: the
 * selected File's diff via `@pierre/diffs` PatchDiff + the verb buttons. Right: the
 * inspector — File status (incl. the honest "Committed · local until pushed" state,
 * ADR 0006), the resolved Commit message and which template produced it, and env B's
 * incoming-Apply review. Every action calls the `_trace`-carrying `window.dotden.den`
 * IPC, so each is one correlatable Operation.
 */
export function Workspace({ role }: { role: Role }) {
  const [files, setFiles] = useState<LocalFile[]>([])
  const [incoming, setIncoming] = useState<readonly IncomingReviewItem[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [lastCommit, setLastCommit] = useState<CommitResult | null>(null)
  const [busy, setBusy] = useState<null | 'track' | 'commit' | 'push' | 'list' | 'apply'>(null)
  const [error, setError] = useState<string | null>(null)
  const [newPath, setNewPath] = useState('')

  // Build the tree model from the current File set (local Files on A, incoming on B).
  const paths = useMemo(
    () => (role === 'a' ? files.map((f) => f.targetPath) : incoming.map((i) => i.targetPath)),
    [role, files, incoming],
  )
  const { model } = useFileTree({
    paths,
    initialExpansion: 'open',
    initialSelectedPaths: selected ? [selected] : [],
  })

  // Run an IPC action with consistent busy/error handling — never fail silently.
  const run = useCallback(async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind)
    setError(null)
    try {
      await fn()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Operation failed.')
    } finally {
      setBusy(null)
    }
  }, [])

  // ── env A verbs ──
  const track = () =>
    run('track', async () => {
      const targetPath = newPath.trim()
      if (!targetPath) return
      await window.dotden.den.track(targetPath)
      setFiles((prev) =>
        prev.some((f) => f.targetPath === targetPath)
          ? prev
          : [...prev, { targetPath, status: 'tracked' }],
      )
      setSelected(targetPath)
      setNewPath('')
    })

  const commit = () =>
    run('commit', async () => {
      const tracked = files.filter((f) => f.status === 'tracked').map((f) => f.targetPath)
      if (tracked.length === 0) return
      const result = await window.dotden.den.commit(tracked)
      setLastCommit(result)
      // A Commit is LOCAL until pushed (ADR 0006) — reflect that in every row.
      setFiles((prev) =>
        prev.map((f) => (tracked.includes(f.targetPath) ? { ...f, status: 'committed-local' } : f)),
      )
    })

  const push = () =>
    run('push', async () => {
      await window.dotden.den.syncPush()
      setFiles((prev) =>
        prev.map((f) => (f.status === 'committed-local' ? { ...f, status: 'pushed' } : f)),
      )
    })

  // ── env B verbs ──
  const list = () =>
    run('list', async () => {
      const items = await window.dotden.den.listIncoming()
      setIncoming(items)
      if (items[0]) setSelected(items[0].targetPath)
    })

  const apply = () =>
    run('apply', async () => {
      const { applied } = await window.dotden.den.apply(incoming.map((i) => i.targetPath))
      // Applied Files are now real on disk; clear them from the incoming review.
      setIncoming((prev) => prev.filter((i) => !applied.includes(i.targetPath)))
    })

  const selectedFile = files.find((f) => f.targetPath === selected)
  const selectedIncoming = incoming.find((i) => i.targetPath === selected)

  return (
    <div className="bg-background text-foreground grid h-screen grid-rows-[auto_1fr]">
      {/* Title bar — workspace switcher · sync status · bell · settings (signature screen). */}
      <header className="border-border bg-sidebar flex items-center gap-3 border-b px-4 py-2 text-sm">
        <span className="bg-dd-ember-500 text-dd-ink-990 rounded px-2 py-0.5 text-xs font-semibold">
          Personal
        </span>
        <span className="text-muted-foreground">
          {role === 'a' ? 'this environment' : 'second environment'}
        </span>
        <div className="text-muted-foreground ml-auto flex items-center gap-3">
          <CircleDot className="size-4" aria-label="sync status" />
          <Bell className="size-4" aria-label="notifications" />
          <Settings className="size-4" aria-label="settings" />
        </div>
      </header>

      <div className="grid grid-cols-[260px_1fr_300px] overflow-hidden">
        {/* Left pane — Workspace tree. */}
        <aside className="border-border bg-sidebar flex flex-col overflow-hidden border-r">
          <div className="text-muted-foreground px-3 pt-3 pb-1 text-xs font-semibold tracking-wide">
            WORKSPACES
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-1">
            {paths.length === 0 ? (
              <p className="text-muted-foreground px-2 py-3 text-xs">
                {role === 'a'
                  ? 'No Files yet. Browse-pick a File and Track it.'
                  : 'No incoming Files. Detect the Remote, then refresh.'}
              </p>
            ) : (
              <FileTree
                model={model}
                className="text-sm"
                onClick={(event) => {
                  // The FileTree is a web component; read the clicked path off the row.
                  const row = (event.target as HTMLElement).closest('[data-path]')
                  const path = row?.getAttribute('data-path')
                  if (path) setSelected(path)
                }}
              />
            )}
          </div>
          <footer className="border-border text-muted-foreground border-t px-3 py-2 text-xs">
            {role === 'a' ? 'env A · this-mac' : 'env B · work-laptop'}
          </footer>
        </aside>

        {/* Center pane — selected File header + diff + verbs. */}
        <main className="flex min-w-0 flex-col overflow-hidden">
          <div className="border-border flex items-center gap-3 border-b px-4 py-2">
            <span className="font-mono text-sm">{selected ?? 'Select a File'}</span>
            {selectedFile ? <StatusTag status={selectedFile.status} /> : null}
            {selectedIncoming ? <StatusTag status="incoming" /> : null}
            <div className="ml-auto flex items-center gap-2">
              {role === 'a' ? (
                <>
                  <Button size="sm" disabled={busy !== null} onClick={commit}>
                    {busy === 'commit' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <GitCommitVertical className="size-4" />
                    )}
                    Commit changes
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy !== null} onClick={push}>
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
                    onClick={apply}
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

          {/* env A: Track a File by path (a browse-pick stand-in for the MVP shell). */}
          {role === 'a' ? (
            <div className="border-border flex items-center gap-2 border-b px-4 py-2">
              <input
                className="border-input bg-background flex-1 rounded-md border px-3 py-1.5 font-mono text-sm"
                placeholder="~/.zshrc — File path to Track"
                value={newPath}
                onChange={(event) => setNewPath(event.target.value)}
              />
              <Button size="sm" disabled={busy !== null || !newPath.trim()} onClick={track}>
                {busy === 'track' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FilePlus2 className="size-4" />
                )}
                Track
              </Button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">
            {selected ? (
              <PatchDiff patch={placeholderPatch(selected)} disableWorkerPool />
            ) : (
              <p className="text-muted-foreground">Select a File in the tree to see its changes.</p>
            )}
          </div>
        </main>

        {/* Right pane — inspector. */}
        <aside className="border-border bg-sidebar flex flex-col gap-4 overflow-auto border-l p-4 text-sm">
          {error ? (
            <div
              className="bg-dd-red-950 text-dd-red-400 rounded-md px-3 py-2 text-xs"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          {role === 'a' && lastCommit ? (
            <section className="border-border bg-card rounded-md border p-3">
              <h2 className="mb-1 text-xs font-semibold tracking-wide">LAST COMMIT</h2>
              <p className="font-mono text-xs break-words">{lastCommit.message}</p>
              <p className="text-muted-foreground mt-2 text-xs">
                Template: <span className="text-foreground">{lastCommit.templateLabel}</span> (
                {lastCommit.templateId})
              </p>
              {!lastCommit.pushed ? (
                <p className="text-dd-blue-400 mt-2 text-xs">
                  Committed locally — this stays on this environment until you Sync now.
                </p>
              ) : null}
            </section>
          ) : null}

          {role === 'b' ? (
            <section className="border-border bg-card rounded-md border p-3">
              <h2 className="mb-2 text-xs font-semibold tracking-wide">INCOMING CHANGES</h2>
              {incoming.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  Nothing incoming. Detect the Remote to pull the Den, then refresh.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {incoming.map((item) => (
                    <li key={item.targetPath} className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs">{item.targetPath}</span>
                      <StatusTag status="incoming" />
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-muted-foreground mt-2 text-xs">
                Only incoming-clean Files in a subscribed Workspace appear here.
              </p>
            </section>
          ) : null}

          <section className="border-border bg-card rounded-md border p-3">
            <h2 className="mb-2 text-xs font-semibold tracking-wide">FILE INFO</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Workspace</dt>
              <dd>{selectedIncoming?.workspaceId ?? 'Personal'}</dd>
              <dt className="text-muted-foreground">Path</dt>
              <dd className="font-mono break-all">{selected ?? '—'}</dd>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  )
}
