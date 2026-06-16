import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import type {
  FileTreeRenameEvent,
  FileTreeRowDecorationRenderer,
  GitStatusEntry,
} from '@pierre/trees'
import { PatchDiff } from '@pierre/diffs/react'
import {
  Bell,
  CircleDot,
  Download,
  FilePlus2,
  GitCommitVertical,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusTag, type FileStatus } from '@/components/StatusTag'
import { EnvironmentBadge } from '@/components/EnvironmentBadge'
import { RowContextMenu, type RowVerb } from '@/components/RowContextMenu'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type {
  AffectedEnvironment,
  FileTreeEntry,
  IncomingReviewItem,
} from '../../main/foundation/den-service'

/** Discriminates which environment's role this shell is driving (A vs B copy/actions). */
type Role = 'a' | 'b'

/**
 * Map dotden's local-axis status (the `chezmoi status` letters parsed in the main
 * process) onto `@pierre/trees`' `GitStatus` union, which drives the row's coloured
 * M/A/D/R/U letter via `setGitStatus` (the 1-00 spike recipe). A muted (out-of-OS-Scope)
 * File renders as `ignored` so `@pierre/trees` auto-dims the whole row — the muted
 * rendering this slice owns (the rule that scopes it out is issue 1-15).
 */
function toGitStatus(file: FileTreeEntry): GitStatusEntry | null {
  // Out-of-OS-Scope wins: an ignored row is dimmed regardless of any pending change,
  // because it is not applied on this environment at all (issue 1-07 muted rendering).
  if (file.muted) return { path: file.targetPath, status: 'ignored' }
  if (file.status === null) return null
  return { path: file.targetPath, status: file.status }
}

/**
 * Workspace — the real three-pane workspace (issue 1-07): a `@pierre/trees` File tree
 * with git-status decorations + search + inline rename + drag-reorganize (left), a
 * `@pierre/diffs` diff of the selected File (center), and the inspector (right),
 * modeled on the signature screen.
 *
 * The tree, status axis, and per-File diff are all driven over IPC from the main
 * process (`window.dotden.den.tree` / `den.diff`, each a `_trace`-carrying call), so
 * the view is a faithful read of real chezmoi state — not a fixture. Every verb
 * (Track/Commit/Sync/Apply) refreshes the tree afterwards so the decorations stay
 * live. The A/B role switch is the MVP single-window stand-in for the two-environment
 * thread (issue 1-04): role `a` drives Track/Commit/Sync, role `b` Detect/Apply.
 *
 * Component seams kept clean for the slices that build on this (issue note): the row
 * `renderContextMenu` hook is left for right-click verbs (1-08), the inspector's
 * incoming callout for Review & Apply + the Remote `↓`/`⚠` decoration lane for 1-09,
 * the `WORKSPACES` grouping for 1-14, and the muted/`ignored` rendering for OS Scope
 * (1-15) — all reachable without reshaping this component.
 */
export function Workspace({ role }: { role: Role }) {
  // env A: the managed File tree read from the main process (the real chezmoi view).
  const [files, setFiles] = useState<readonly FileTreeEntry[]>([])
  const [workspaceLabel, setWorkspaceLabel] = useState('Personal')
  // env B: incoming Files for a reviewed Apply (the 1-04 detect→apply half).
  const [incoming, setIncoming] = useState<readonly IncomingReviewItem[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [lastCommitMessage, setLastCommitMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<
    null | 'load' | 'track' | 'commit' | 'push' | 'list' | 'apply' | 'diff' | 'untrack' | 'delete'
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [newPath, setNewPath] = useState('')

  // The pending destructive/lifecycle confirm (issue 1-08): which row verb is awaiting
  // confirmation, on which File, and — for Delete everywhere — the affected environments
  // the confirm must name before proceeding (null while none is open).
  const [confirm, setConfirm] = useState<{
    verb: 'untrack' | 'delete-everywhere'
    path: string
    affected: readonly AffectedEnvironment[]
  } | null>(null)

  // The paths the tree renders: real managed Files on A, incoming Files on B.
  const paths = useMemo(
    () => (role === 'a' ? files.map((f) => f.targetPath) : incoming.map((i) => i.targetPath)),
    [role, files, incoming],
  )

  // The local-axis git status for every File row (env A only; B rows are incoming-clean).
  const gitStatus = useMemo<GitStatusEntry[]>(
    () => (role === 'a' ? files.flatMap((f) => toGitStatus(f) ?? []) : []),
    [role, files],
  )

  // Remote-axis decoration lane (the 1-00 spike's `renderRowDecoration`). The local
  // axis (M/A/D/R/U) is owned by `setGitStatus`; this overlay lane is where the
  // Remote ↓ incoming / ⚠ conflict glyphs land in 1-09. Here it is a no-op so the
  // seam exists and 1-09 only swaps the body, not the wiring.
  const renderRowDecoration = useCallback<FileTreeRowDecorationRenderer>(() => null, [])

  // Inline rename: the user renames a File in place; we move its placement so the
  // tree, the synced `.myenv/`, and chezmoi stay in step. The faithful chezmoi move
  // (re-add under the new name + forget the old) is the 1-08 verb slice; here we keep
  // the optimistic tree edit and surface that persistence is pending so we never
  // silently imply a rename was written.
  const onRename = useCallback((event: FileTreeRenameEvent) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.targetPath === event.sourcePath ? { ...f, targetPath: event.destinationPath } : f,
      ),
    )
    setSelected(event.destinationPath)
    setError(
      `Renamed in the tree. Persisting a rename to chezmoi lands with the row verbs (issue 1-08).`,
    )
  }, [])

  // Build the tree model with all interactions the issue asks for: search, inline
  // rename, drag-reorganize, the git-status axis, and the Remote decoration lane.
  const { model } = useFileTree({
    paths,
    initialExpansion: 'open',
    initialSelectedPaths: selected ? [selected] : [],
    gitStatus,
    renderRowDecoration,
    // Inline rename + drag-reorganize so managing many Files stays fast (issue 1-07).
    renaming: { onRename },
    dragAndDrop: true,
    // Drive selection straight off the model so the center/inspector follow the tree.
    onSelectionChange: (selectedPaths) => void selectFile(selectedPaths[0] ?? null),
  })

  // Keep the live model's git-status axis in sync when the File set/status changes
  // (useFileTree only seeds `gitStatus` at construction; later refreshes go through
  // the model's imperative `setGitStatus`, the 1-00 recipe). This is an
  // external-system sync (the web component), not a setState-in-effect.
  useEffect(() => {
    model.setGitStatus(gitStatus)
  }, [model, gitStatus])

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

  // Select a File AND fetch its real `chezmoi diff` for the center pane (issue 1-07).
  // Done in this event path (not a selection-watching effect) so we never call
  // setState synchronously inside an effect (react-hooks/set-state-in-effect). A
  // monotonic token guards against an out-of-order response when the user clicks
  // through rows faster than the diff resolves (last selection wins). env B rows are
  // incoming-clean (no local copy yet), so they carry no local diff.
  const diffTokenRef = useRef(0)
  const selectFile = useCallback(
    async (path: string | null) => {
      setSelected(path)
      const token = ++diffTokenRef.current
      if (path === null || role !== 'a') {
        setDiff(null)
        return
      }
      setBusy('diff')
      try {
        const patch = await window.dotden.den.diff(path)
        if (token === diffTokenRef.current) setDiff(patch)
      } catch (caught) {
        if (token === diffTokenRef.current) {
          setError(caught instanceof Error ? caught.message : 'Could not load the diff.')
          setDiff(null)
        }
      } finally {
        if (token === diffTokenRef.current) setBusy((b) => (b === 'diff' ? null : b))
      }
    },
    [role],
  )

  // Refresh the managed File tree from the main process (the real chezmoi view).
  const reloadTree = useCallback(
    () =>
      run('load', async () => {
        const view = await window.dotden.den.tree()
        setFiles(view.files)
        setWorkspaceLabel(view.workspaces[0]?.label ?? 'Personal')
      }),
    [run],
  )

  // env A starts by reading its real managed Files (env B waits for an explicit
  // Detect). App.tsx keys this component by role, so switching environments remounts
  // it and resets all state (the React `key` reset pattern). The initial load mirrors
  // the codebase convention: an `active`-guarded async fn that only setState's AFTER
  // the await, so a late reply after unmount is dropped and the no-setState-in-effect
  // rule is satisfied (it accepts post-await updates).
  useEffect(() => {
    if (role !== 'a') return
    let active = true
    async function loadInitial() {
      try {
        const view = await window.dotden.den.tree()
        if (active) {
          setFiles(view.files)
          setWorkspaceLabel(view.workspaces[0]?.label ?? 'Personal')
        }
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Could not read your Files.')
        }
      }
    }
    void loadInitial()
    return () => {
      active = false
    }
  }, [role])

  // ── env A verbs ── (each refreshes the tree so decorations reflect new state)
  const track = () =>
    run('track', async () => {
      const targetPath = newPath.trim()
      if (!targetPath) return
      await window.dotden.den.track(targetPath)
      setNewPath('')
      await reloadTree()
      await selectFile(targetPath)
    })

  const commit = () =>
    run('commit', async () => {
      // Commit every managed File that has a pending local change (the modified/added set).
      const changed = files.filter((f) => !f.muted && f.status !== null).map((f) => f.targetPath)
      if (changed.length === 0) return
      const result = await window.dotden.den.commit(changed)
      setLastCommitMessage(result.message)
      await reloadTree()
    })

  const push = () =>
    run('push', async () => {
      await window.dotden.den.syncPush()
    })

  // ── env B verbs ──
  const list = () =>
    run('list', async () => {
      const items = await window.dotden.den.listIncoming()
      setIncoming(items)
      await selectFile(items[0]?.targetPath ?? null)
    })

  const apply = () =>
    run('apply', async () => {
      const { applied } = await window.dotden.den.apply(incoming.map((i) => i.targetPath))
      setIncoming((prev) => prev.filter((i) => !applied.includes(i.targetPath)))
    })

  // ── Right-click row verbs (issue 1-08) ──
  // The four verbs the row context menu offers, routed by intent:
  // - Commit/Apply: everyday verbs, run immediately on the one right-clicked File.
  // - Untrack/Delete everywhere: destructive/lifecycle verbs — never run on the click.
  //   They OPEN a confirm first (never fail silently); Delete everywhere additionally
  //   fetches the affected environments so the confirm can name the blast radius.
  const onRowVerb = useCallback(
    (path: string, verb: RowVerb) => {
      if (verb === 'commit') {
        void run('commit', async () => {
          const result = await window.dotden.den.commit([path])
          setLastCommitMessage(result.message)
          await reloadTree()
        })
        return
      }
      if (verb === 'apply') {
        void run('apply', async () => {
          await window.dotden.den.apply([path])
          await reloadTree()
        })
        return
      }
      if (verb === 'untrack') {
        // Untrack is non-destructive (the File stays on disk), so it needs no blast radius.
        setConfirm({ verb: 'untrack', path, affected: [] })
        return
      }
      // Delete everywhere: load the affected environments BEFORE opening the confirm so
      // the destructive dialog can name every environment that loses the real path.
      void run('delete', async () => {
        const affected = await window.dotden.den.affectedEnvironments(path)
        setConfirm({ verb: 'delete-everywhere', path, affected })
      })
    },
    [run, reloadTree],
  )

  // Carry out the verb the user CONFIRMED in the dialog. Each maps faithfully onto a
  // chezmoi verb (Untrack→forget, Delete everywhere→destroy) in the main process, then
  // refreshes the tree so the removed File disappears from the decorations.
  const runConfirmedVerb = useCallback(() => {
    if (!confirm) return
    const { verb, path } = confirm
    void run(verb === 'untrack' ? 'untrack' : 'delete', async () => {
      if (verb === 'untrack') await window.dotden.den.untrack(path)
      else await window.dotden.den.deleteEverywhere(path)
      // The File is gone from the Den: clear it from selection and refresh the tree.
      if (selected === path) await selectFile(null)
      await reloadTree()
    })
  }, [confirm, run, reloadTree, selectFile, selected])

  // The header/inspector status pill for the selected File (the honest dotden state).
  const selectedFile = files.find((f) => f.targetPath === selected)
  const selectedIncoming = incoming.find((i) => i.targetPath === selected)
  const headerStatus: FileStatus | null = selectedIncoming
    ? 'incoming'
    : selectedFile && !selectedFile.muted && selectedFile.status !== null
      ? 'tracked'
      : null
  const changedCount = files.filter((f) => !f.muted && f.status !== null).length

  return (
    <div className="bg-background text-foreground grid h-screen grid-rows-[auto_1fr]">
      {/* Title bar — workspace switcher · centered search · sync · bell · settings (signature screen). */}
      <header className="border-border bg-sidebar flex items-center gap-3 border-b px-4 py-2 text-sm">
        <span className="bg-dd-ember-950 text-dd-ember-400 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold">
          {workspaceLabel}
        </span>
        <span className="text-muted-foreground text-xs">
          {role === 'a' ? 'this environment' : 'second environment'}
        </span>
        {/* Centered ⌘K search — opens the tree's built-in search session (issue 1-07). */}
        <button
          type="button"
          className="border-border bg-background text-muted-foreground hover:text-foreground mx-auto flex w-80 items-center gap-2 rounded-md border px-3 py-1 text-xs"
          onClick={() => model.openSearch()}
          disabled={role !== 'a' || paths.length === 0}
        >
          <Search className="size-3.5" />
          <span>Search files &amp; workspaces…</span>
          <kbd className="border-border ml-auto rounded border px-1 text-[10px]">⌘K</kbd>
        </button>
        <div className="text-muted-foreground flex items-center gap-3">
          <CircleDot className="size-4" aria-label="sync status" />
          <Bell className="size-4" aria-label="notifications" />
          <Settings className="size-4" aria-label="settings" />
        </div>
      </header>

      <div className="grid grid-cols-[260px_1fr_300px] overflow-hidden">
        {/* Left pane — Workspace tree. */}
        <aside className="border-border bg-sidebar flex flex-col overflow-hidden border-r">
          <div className="flex items-center justify-between px-3 pt-3 pb-1">
            <span className="text-muted-foreground text-xs font-semibold tracking-wide">
              WORKSPACES
            </span>
            <Plus className="text-muted-foreground size-3.5" aria-label="add workspace" />
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-1">
            {busy === 'load' && paths.length === 0 ? (
              <p className="text-muted-foreground flex items-center gap-2 px-2 py-3 text-xs">
                <Loader2 className="size-3.5 animate-spin" /> Reading your managed Files…
              </p>
            ) : paths.length === 0 ? (
              <p className="text-muted-foreground px-2 py-3 text-xs">
                {role === 'a'
                  ? 'No Files yet. Track a File below to start managing it.'
                  : 'No incoming Files. Detect the Remote, then refresh.'}
              </p>
            ) : (
              // Right-click any row for the verbs (Commit · Apply · Untrack · Delete
              // everywhere); the menu resolves which File from the row's data-item-path.
              <RowContextMenu onVerb={onRowVerb}>
                <FileTree model={model} className="text-sm" />
              </RowContextMenu>
            )}
          </div>
          {/* This environment's editable label + git-log attribution (issue 1-05). */}
          <EnvironmentBadge />
        </aside>

        {/* Center pane — selected File header + tabs + diff. */}
        <main className="flex min-w-0 flex-col overflow-hidden">
          <div className="border-border flex items-center gap-3 border-b px-4 py-2">
            <span className="font-mono text-sm">
              {selected ? `~/${selected}` : 'Select a File'}
            </span>
            {headerStatus ? <StatusTag status={headerStatus} /> : null}
            {selectedFile?.muted ? (
              <span className="text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                Scoped out of this OS
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              {role === 'a' ? (
                <>
                  <Button size="sm" disabled={busy !== null || changedCount === 0} onClick={commit}>
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

          {/* Tabs — Changes is the diff this slice owns; History (2-01) / Scope (1-15) follow. */}
          <div className="border-border text-muted-foreground flex items-center gap-4 border-b px-4 text-xs">
            <span className="text-foreground border-primary border-b-2 py-2 font-medium">
              Changes
            </span>
            <span className="cursor-default py-2 opacity-50">History</span>
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
                  if (event.key === 'Enter') track()
                }}
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
            {selected === null ? (
              <p className="text-muted-foreground">Select a File in the tree to see its changes.</p>
            ) : busy === 'diff' ? (
              <p className="text-muted-foreground flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Loading diff…
              </p>
            ) : role === 'b' ? (
              <p className="text-muted-foreground">
                Incoming Files have no local copy yet — review and Apply to write them.
              </p>
            ) : diff && diff.trim().length > 0 ? (
              <PatchDiff patch={diff} disableWorkerPool />
            ) : (
              <p className="text-muted-foreground">
                No uncommitted changes — this File matches the Den.
              </p>
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

          {/* Incoming-changes callout — the Review & Apply seam (built out in issue 1-09). */}
          {role === 'b' ? (
            <section className="border-border bg-card rounded-md border p-3">
              <h2 className="mb-2 flex items-center justify-between text-xs font-semibold tracking-wide">
                <span className="inline-flex items-center gap-1.5">
                  <Download className="size-3.5" /> INCOMING CHANGES
                </span>
                <span className="text-muted-foreground">{incoming.length}</span>
              </h2>
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
            </section>
          ) : null}

          {/* FILE info — the inspector's per-File details (signature screen). */}
          <section>
            <h2 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide">FILE</h2>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs">
              <dt className="text-muted-foreground">Workspace</dt>
              <dd className="text-right">{selectedIncoming?.workspaceId ?? workspaceLabel}</dd>
              <dt className="text-muted-foreground">Scope</dt>
              <dd className="text-right">
                {selectedFile?.muted ? (
                  <span className="border-border text-muted-foreground rounded border px-1.5 py-0.5">
                    out of OS
                  </span>
                ) : (
                  <span className="text-muted-foreground">This OS</span>
                )}
              </dd>
              <dt className="text-muted-foreground">Path</dt>
              <dd className="text-right font-mono break-all">{selected ?? '—'}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="text-right">
                {selectedFile?.status ?? (selectedIncoming ? 'incoming' : 'unchanged')}
              </dd>
            </dl>
          </section>

          {role === 'a' && lastCommitMessage ? (
            <section className="border-border bg-card rounded-md border p-3">
              <h2 className="mb-1 text-xs font-semibold tracking-wide">LAST COMMIT</h2>
              <p className="font-mono text-xs break-words">{lastCommitMessage}</p>
              <p className="text-dd-blue-400 mt-2 text-xs">
                Committed locally — this stays on this environment until you Sync now.
              </p>
            </section>
          ) : null}
        </aside>
      </div>

      {/* The Untrack / Delete-everywhere confirm (confirm-dialogs screen spec). Untrack
          is Default tone with copy that the File STAYS ON DISK everywhere; Delete
          everywhere is Destructive tone and NAMES every affected environment, so the
          user sees the blast radius before confirming (never fail silently). */}
      {confirm ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setConfirm(null)
          }}
          tone={confirm.verb === 'delete-everywhere' ? 'destructive' : 'default'}
          confirmLabel={confirm.verb === 'untrack' ? 'Untrack' : 'Delete everywhere'}
          confirmDisabled={busy !== null}
          onConfirm={runConfirmedVerb}
          title={
            confirm.verb === 'untrack'
              ? `Untrack ${confirm.path}?`
              : `Delete ${confirm.path} everywhere?`
          }
          body={
            confirm.verb === 'untrack' ? (
              <>
                dotden will stop managing <span className="font-mono">{confirm.path}</span>. The
                real file <strong>stays on disk on every environment</strong> — nothing is deleted,
                and you can Track it again later.
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
    </div>
  )
}
