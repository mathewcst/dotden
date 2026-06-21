import { CommitRow } from '@/features/commit/components/CommitRow'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { Button } from '@/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/ui/resizable'
import { toast } from '@/lib/toast'
import { FILE_HISTORY_PATCH_DIFF_OPTIONS } from '@/features/file-history/lib/dotden-shiki-theme'
import { PatchDiff } from '@pierre/diffs/react'
import { History, Loader2, RotateCcw, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileVersion } from '@shared/history'

/**
 * FileHistory — the Diff pane in **History-tab mode** (issue 2-01), a master-detail layout
 * mirroring the design-system `AppPane/History` (`319:888`, file-history.md).
 *
 * It surfaces a File's per-File version history (every Commit, newest first) read purely
 * from `git log` over IPC (`den.fileHistory`), and a read-only preview of the selected
 * version (`den.fileVersionDiff` → the same `@pierre/diffs` `PatchDiff` role used everywhere
 * — NO resolve/edit affordances). The two zones:
 *
 * - **version list** (top) — a scrollable column of {@link CommitRow}s on the base
 *   background; the newest version is badged **Current**.
 * - **resize handle** (a thin divider with a centered grip) — drag to re-split list vs
 *   preview; the split is bounded so neither collapses.
 * - **preview panel** (bottom) — a raised `card` surface (visually distinct so "the top
 *   scrolls, this stays & reflects my selection" reads), with a header (`shortSha · message`,
 *   "read-only"), the version's read-only patch, and a muted **"Kept in history — nothing is
 *   deleted"** reassurance line so the feature reads as safe on first use.
 *
 * Both regions **scroll independently** (each `overflow-auto`), per the acceptance criteria.
 * The first version is auto-selected so the preview is never blank on open. History is
 * strictly per-File (`targetPath`) — there is no Den-wide timeline.
 *
 * **Restore-forward (issue 2-02).** The preview panel carries exactly ONE Restore action —
 * a filled ember Primary `Restore this version` button on the previewed version (never a
 * per-row button: a row button + panel button would mean two restores for one version). It
 * is **restore-forward**: confirming captures the previewed version's content as a brand-new
 * Commit (`den.restoreVersion`), so the prior current version is never destroyed and stays
 * reachable in the list — which we re-read after a restore to prove it. The confirm uses the
 * **Default (non-danger) tone**, not the destructive red reserved for Delete, with the copy
 * "Saved as a new commit; your current version stays in history" — because nothing is lost.
 */
export function FileHistory({ targetPath }: { targetPath: string }) {
  const [versions, setVersions] = useState<readonly FileVersion[]>([])
  const [selectedSha, setSelectedSha] = useState<string | null>(null)
  const [preview, setPreview] = useState<string>('')
  const [loadingList, setLoadingList] = useState(true)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Restore-forward (issue 2-02): whether the Default-tone confirm is open, and whether a
  // restore is in flight (so the button shows progress + can't be double-fired).
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [restoring, setRestoring] = useState(false)

  // A monotonic token guards the preview against out-of-order responses when the user clicks
  // through versions faster than `git show` resolves (last selection wins) — the same guard
  // the everyday diff uses.
  const previewTokenRef = useRef(0)

  // Fetch the read-only preview (a version's patch) for the selected SHA.
  const loadPreview = useCallback(
    async (sha: string) => {
      const token = ++previewTokenRef.current
      setLoadingPreview(true)
      try {
        const patch = await window.dotden.den.fileVersionDiff(targetPath, sha)
        if (token === previewTokenRef.current) setPreview(patch)
      } catch (caught) {
        if (token === previewTokenRef.current) {
          setError(caught instanceof Error ? caught.message : 'Could not load this version.')
          setPreview('')
        }
      } finally {
        if (token === previewTokenRef.current) setLoadingPreview(false)
      }
    },
    [targetPath],
  )

  // Select a version AND load its preview in the same event path (not a selection-watching
  // effect), so we never setState synchronously inside an effect (react-hooks rule).
  const selectVersion = useCallback(
    (sha: string) => {
      setSelectedSha(sha)
      void loadPreview(sha)
    },
    [loadPreview],
  )

  // Apply a freshly-fetched version list to state + auto-select the newest version so the
  // preview is never blank (on open OR after a restore, where the newest IS the just-restored
  // version). Pure state-writer — its callers run it only AFTER an `await`, so it never trips
  // the set-state-in-effect rule (the linter accepts setState that is unreachable synchronously).
  const applyVersions = useCallback(
    (list: readonly FileVersion[]) => {
      setVersions(list)
      const first = list[0]
      if (first) {
        setSelectedSha(first.sha)
        void loadPreview(first.sha)
      }
    },
    [loadPreview],
  )

  // Load the version list on mount. The parent keys this component by the selected File
  // (`key={selected}` in Workspace.tsx), so switching Files REMOUNTS it — the initial state
  // (loadingList=true, empty list/preview) is the reset, and this effect never resets state
  // synchronously (which the set-state-in-effect lint rule forbids; all setState here is past
  // an `await`). The `active` guard drops a late reply after unmount (the codebase convention).
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const list = await window.dotden.den.fileHistory(targetPath)
        if (active) applyVersions(list)
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Could not read this File’s history.')
        }
      } finally {
        if (active) setLoadingList(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [targetPath, applyVersions])

  // Confirm restore-forward (issue 2-02): capture the previewed version forward as a NEW
  // Commit, then re-read the list so the new version appears on top with the prior current
  // version still reachable below (nothing destroyed). Never rewrites history —
  // `den.restoreVersion` only ever ADDS a commit. Errors surface in the banner (never fail
  // silently). All setState here is past an `await`, so the set-state-in-effect rule is moot.
  const confirmRestore = useCallback(
    async (sha: string) => {
      setRestoring(true)
      setError(null)
      try {
        const result = await window.dotden.den.restoreVersion(targetPath, sha)
        if (result.committed) {
          toast.success(`Restored ${targetPath}.`)
          applyVersions(await window.dotden.den.fileHistory(targetPath))
        } else {
          toast.info('That version is already current.')
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not restore this version.')
      } finally {
        setRestoring(false)
      }
    },
    [targetPath, applyVersions],
  )

  const selectedVersion = versions.find((v) => v.sha === selectedSha) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {error ? (
        <div
          className="bg-dd-red-950 text-dd-red-400 m-3 rounded-md px-3 py-2 text-xs"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <ResizablePanelGroup
        direction="vertical"
        autoSaveId="dotden-file-history-split"
        className="min-h-0 flex-1"
      >
        {/* VERSION LIST — scrollable column of CommitRows on the base background. */}
        <ResizablePanel
          defaultSize={50}
          minSize={20}
          maxSize={80}
          className="min-h-0 overflow-auto"
        >
          <div className="text-muted-foreground flex items-center gap-1.5 px-3 pt-3 pb-1 text-xs font-semibold tracking-wide">
            <History className="size-3.5" /> VERSION HISTORY
          </div>
          {loadingList ? (
            <p className="text-muted-foreground flex items-center gap-2 px-3 py-3 text-xs">
              <Loader2 className="size-3.5 animate-spin" /> Reading this File’s history…
            </p>
          ) : versions.length === 0 ? (
            <p className="text-muted-foreground px-3 py-3 text-xs">
              No versions yet. Once you Commit a change to this File, every version you record shows
              up here — and nothing is ever deleted from history.
            </p>
          ) : (
            <ul className="pb-2">
              {versions.map((version) => (
                <li key={version.sha}>
                  <CommitRow
                    version={version}
                    selected={version.sha === selectedSha}
                    onSelect={selectVersion}
                  />
                </li>
              ))}
            </ul>
          )}
        </ResizablePanel>

        {/* RESIZE HANDLE — shared with shell panes; drag to re-split list vs preview. */}
        <ResizableHandle
          withHandle
          aria-label="Resize history list"
          className="bg-background hover:bg-secondary h-2.5 border-y transition-colors"
        />

        {/* PREVIEW PANEL — a raised card surface that swaps to the selected version, read-only. */}
        <ResizablePanel
          defaultSize={50}
          minSize={20}
          className="bg-card flex min-h-0 flex-col overflow-hidden"
        >
          {selectedVersion ? (
            <>
              <div className="border-border flex items-center gap-2 border-b px-4 py-2 text-xs">
                <span className="text-dd-amber-400 font-mono">{selectedVersion.shortSha}</span>
                <span className="text-muted-foreground" aria-hidden>
                  ·
                </span>
                <span className="text-foreground truncate font-medium">
                  {selectedVersion.message}
                </span>
                {/* Honest, unambiguous: this preview is read-only (no resolve/edit affordances). */}
                <span className="border-border text-muted-foreground ml-auto shrink-0 rounded border px-1.5 py-0.5">
                  read-only
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">
                {loadingPreview ? (
                  <p className="text-muted-foreground flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" /> Loading this version…
                  </p>
                ) : preview.trim().length > 0 ? (
                  // The SAME read-only PatchDiff role used everywhere — no resolve/edit controls.
                  <PatchDiff
                    patch={preview}
                    options={FILE_HISTORY_PATCH_DIFF_OPTIONS}
                    className="dotden-file-history-diff"
                    disableWorkerPool
                  />
                ) : (
                  <p className="text-muted-foreground">
                    This version didn’t change this File — nothing to preview here.
                  </p>
                )}
              </div>
              {/* Footer — reassurance line + the SINGLE Restore action (issue 2-02). The button
                lives only here (never per-row), so the version it restores is unambiguous. */}
              <div className="border-border flex items-center gap-3 border-t px-4 py-2">
                <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <ShieldCheck className="text-dd-green-400 size-3.5 shrink-0" aria-hidden />
                  Kept in history — nothing is deleted. Every version you Commit stays here.
                </span>
                {/* Filled ember Primary — obviously a button at rest (affordance pass). */}
                <Button
                  variant="default"
                  size="sm"
                  className="ml-auto shrink-0"
                  disabled={restoring}
                  onClick={() => setConfirmOpen(true)}
                >
                  {restoring ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <RotateCcw className="size-3.5" aria-hidden />
                  )}
                  Restore this version
                </Button>
              </div>
              {/* Restore confirm — DEFAULT tone (non-danger), never the destructive red:
                restore-forward saves a NEW commit and keeps the current version in history. */}
              <ConfirmDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                tone="default"
                badge={<RotateCcw className="size-5" />}
                title="Restore this version?"
                body={
                  <>
                    Saved as a new commit; your current version stays in history. This rolls{' '}
                    <span className="text-foreground font-mono">{selectedVersion.shortSha}</span>{' '}
                    forward as the latest version of this File — nothing is deleted, and you can
                    restore any other version the same way.
                  </>
                }
                confirmLabel="Restore"
                confirmDisabled={restoring}
                onConfirm={() => void confirmRestore(selectedVersion.sha)}
              />
            </>
          ) : (
            <p className="text-muted-foreground p-4 text-sm">
              {loadingList
                ? ''
                : 'Select a version above to preview it. Nothing is deleted — every version is kept in history.'}
            </p>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
