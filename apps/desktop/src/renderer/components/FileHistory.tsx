import { useCallback, useEffect, useRef, useState } from 'react'
import { PatchDiff } from '@pierre/diffs/react'
import { GripHorizontal, History, Loader2, ShieldCheck } from 'lucide-react'
import { CommitRow } from '@/components/CommitRow'
import type { FileVersion } from '../../main/foundation/file-history'

/**
 * The fraction of the History tab's height the version LIST occupies (the rest is the
 * preview panel). Bounded so neither region can be dragged shut — a long list or a long
 * File preview never crowds the other out (the issue's independent-scroll requirement).
 */
const MIN_LIST_FRACTION = 0.2
const MAX_LIST_FRACTION = 0.8
const DEFAULT_LIST_FRACTION = 0.5

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
 * Restore-forward (the single panel action) is issue 2-02; this slice is read-only preview.
 */
export function FileHistory({ targetPath }: { targetPath: string }) {
  const [versions, setVersions] = useState<readonly FileVersion[]>([])
  const [selectedSha, setSelectedSha] = useState<string | null>(null)
  const [preview, setPreview] = useState<string>('')
  const [loadingList, setLoadingList] = useState(true)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The list/preview split as a fraction of the tab height; dragged via the resize handle.
  const [listFraction, setListFraction] = useState(DEFAULT_LIST_FRACTION)
  const containerRef = useRef<HTMLDivElement>(null)

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

  // Load the version list on mount. The parent keys this component by the selected File
  // (`key={selected}` in Workspace.tsx), so switching Files REMOUNTS it — the initial state
  // (loadingList=true, empty list/preview) is the reset, and this effect never resets state
  // synchronously (which the set-state-in-effect lint rule forbids). The `active` guard drops
  // a late reply after unmount (the codebase convention; accepts post-await setState).
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const list = await window.dotden.den.fileHistory(targetPath)
        if (!active) return
        setVersions(list)
        // Auto-select the newest version so the preview is never blank on open.
        const first = list[0]
        if (first) {
          setSelectedSha(first.sha)
          void loadPreview(first.sha)
        }
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
  }, [targetPath, loadPreview])

  // Drag the resize handle: translate the pointer's Y into a bounded list fraction so the
  // user can re-split list vs preview. Bound so neither region can be dragged shut.
  const onHandlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const container = containerRef.current
    if (!container) return
    const onMove = (move: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      if (rect.height === 0) return
      const fraction = (move.clientY - rect.top) / rect.height
      setListFraction(Math.min(MAX_LIST_FRACTION, Math.max(MIN_LIST_FRACTION, fraction)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  const selectedVersion = versions.find((v) => v.sha === selectedSha) ?? null

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {error ? (
        <div
          className="bg-dd-red-950 text-dd-red-400 m-3 rounded-md px-3 py-2 text-xs"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {/* VERSION LIST — scrollable column of CommitRows on the base background. */}
      <div
        className="min-h-0 overflow-auto"
        style={{ flexBasis: `${listFraction * 100}%`, flexGrow: 0, flexShrink: 0 }}
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
      </div>

      {/* RESIZE HANDLE — a thin divider with a centered grip pill; drag to re-split. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize history list"
        onPointerDown={onHandlePointerDown}
        className="border-border bg-background hover:bg-secondary flex h-2.5 shrink-0 cursor-row-resize items-center justify-center border-y transition-colors"
      >
        <GripHorizontal className="text-muted-foreground size-3.5" aria-hidden />
      </div>

      {/* PREVIEW PANEL — a raised card surface that swaps to the selected version, read-only. */}
      <div className="bg-card flex min-h-0 flex-1 flex-col overflow-hidden">
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
                <PatchDiff patch={preview} disableWorkerPool />
              ) : (
                <p className="text-muted-foreground">
                  This version didn’t change this File — nothing to preview here.
                </p>
              )}
            </div>
            {/* Reassurance line — the feature reads as safe on first use (file-history.md). */}
            <div className="border-border text-muted-foreground flex items-center gap-1.5 border-t px-4 py-2 text-xs">
              <ShieldCheck className="text-dd-green-400 size-3.5 shrink-0" aria-hidden />
              Kept in history — nothing is deleted. Every version you Commit stays here.
            </div>
          </>
        ) : (
          <p className="text-muted-foreground p-4 text-sm">
            {loadingList
              ? ''
              : 'Select a version above to preview it. Nothing is deleted — every version is kept in history.'}
          </p>
        )}
      </div>
    </div>
  )
}
