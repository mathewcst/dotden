import { useCallback, useEffect, useMemo, useState } from 'react'
import { UnresolvedFile } from '@pierre/diffs/react'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  GitMerge,
  Loader2,
  XCircle,
} from 'lucide-react'
import { Button } from '@/ui/button'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { WindowTitleBar } from '@/shared/components/WindowControls'
import type { ConflictReviewItem } from '@shared/den'
import type { ResolutionChoice } from '@shared/apply'

/**
 * ConflictResolver — the **Conflict resolution** surface (issue 1-11), modeled on the
 * [conflict-resolver screen spec](../../../docs/design-system/screens/conflict-resolver.md).
 *
 * A **Conflict** is the cross-environment axis: two environments Committed the same File,
 * so their source-state histories diverged in a way git could not auto-merge. The user
 * resolves each true Conflict with **Keep mine** (`current`) / **Take theirs**
 * (`incoming`) / **Open both** (`both`), then **Apply resolution** completes the merge.
 *
 * The load-bearing rule (ADR 0008 invariant #1 — "never auto-resolve a Conflict"): the
 * resolved bytes are **unconstructable without an explicit user choice**. This surface's
 * merge view (`@pierre/diffs` `UnresolvedFile`, the current/incoming/both primitive) is
 * **read-only** — every resolution flows through `window.dotden.den.resolveConflict`,
 * which mints the bytes via `ConflictModel.resolve(choice)` in the main process. We
 * NEVER call `@pierre/diffs`' own `resolveConflict()` (we pass
 * `mergeConflictActionsType: 'none'` so the library renders no resolve affordance), so
 * there is no path that produces resolved bytes the user did not choose.
 *
 * Functional-color discipline (the spec): amber = mine/Current, blue = theirs/Incoming,
 * red = Conflict, green = resolved, ember = the primary Apply action only.
 */
export function ConflictResolver({ onClose }: { onClose: () => void }) {
  // The true Conflicts surfaced by `git fetch` + `git merge` (auto-merge already removed
  // every non-overlapping change). `null` until the first detect resolves.
  const [conflicts, setConflicts] = useState<readonly ConflictReviewItem[] | null>(null)
  const [autoMerged, setAutoMerged] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  // The choice the user committed PER File (the resolved set). A File is resolved once it
  // has an entry here; the merge cannot be applied until every File is resolved.
  const [resolved, setResolved] = useState<ReadonlyMap<string, ResolutionChoice>>(new Map())
  // Starts at `load` because the surface mounts already detecting Conflicts (setting it
  // here, not synchronously inside the effect, keeps the effect side-effect-free).
  const [busy, setBusy] = useState<null | 'load' | 'resolve' | 'apply' | 'abort'>('load')
  const [error, setError] = useState<string | null>(null)
  // Whether the Abort confirm is open (Abort discards the merge — confirm before losing it).
  const [confirmingAbort, setConfirmingAbort] = useState(false)

  const items = useMemo(() => conflicts ?? [], [conflicts])
  const total = items.length
  const resolvedCount = resolved.size
  // The merge is ready to Apply only when EVERY Conflict has an explicit resolution.
  const allResolved = total > 0 && resolvedCount === total

  // Detect Conflicts on mount: fetch + merge in the source repo, surface the overlaps.
  // An `active` guard drops a late reply after unmount (codebase convention; updates only
  // AFTER the await, never synchronously in the effect body → no setState-in-effect).
  useEffect(() => {
    let active = true
    async function detect() {
      try {
        const review = await window.dotden.den.detectConflicts()
        if (!active) return
        setConflicts(review.conflicts)
        setAutoMerged(review.autoMerged)
        // Auto-select the first Conflict so the merge view is never blank.
        if (review.conflicts[0]) setSelected(review.conflicts[0].targetPath)
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Could not check for conflicts.')
        }
      } finally {
        if (active) setBusy((b) => (b === 'load' ? null : b))
      }
    }
    void detect()
    return () => {
      active = false
    }
  }, [])

  // Resolve ONE File with the user's explicit choice. This routes through the main
  // process's `ConflictModel.resolve(choice)` (the sole minter of resolved bytes,
  // invariant #1) — never the diff library's own resolveConflict(). On success the File
  // is marked resolved locally so the progress bar + Apply gate advance.
  const resolveFile = useCallback((targetPath: string, choice: ResolutionChoice) => {
    setBusy('resolve')
    setError(null)
    void (async () => {
      try {
        await window.dotden.den.resolveConflict(targetPath, choice)
        setResolved((prev) => new Map(prev).set(targetPath, choice))
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not resolve this File.')
      } finally {
        setBusy(null)
      }
    })()
  }, [])

  // Apply resolution: complete the in-progress merge (commit it). Only enabled once every
  // File is resolved — git itself also refuses while any `UU` entry remains, so a
  // half-resolved merge can never be committed (the backstop behind the disabled button).
  const applyResolution = useCallback(() => {
    setBusy('apply')
    setError(null)
    void (async () => {
      try {
        await window.dotden.den.completeConflictResolution()
        onClose()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not apply the resolution.')
        setBusy(null)
      }
    })()
  }, [onClose])

  // Abort: discard the half-merged tree (`git merge --abort`). Nothing is resolved — the
  // safe escape hatch. Confirmed first so the user does not lose work by accident.
  const abort = useCallback(() => {
    setConfirmingAbort(false)
    setBusy('abort')
    setError(null)
    void (async () => {
      try {
        await window.dotden.den.abortConflicts()
        onClose()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not abort the merge.')
        setBusy(null)
      }
    })()
  }, [onClose])

  const selectedItem = items.find((i) => i.targetPath === selected)

  return (
    <div className="bg-background text-foreground grid h-screen grid-rows-[40px_1fr] overflow-hidden">
      <WindowTitleBar windowsControlsClassName="-mr-3 h-10" />

      <div className="grid min-h-0 grid-cols-[280px_1fr_320px] overflow-hidden">
        {/* Left — the conflicted Files (AppPane/ConflictFiles). */}
        <aside className="border-border bg-sidebar flex flex-col overflow-hidden border-r">
          <div className="border-border flex items-center justify-between border-b px-4 py-3">
            <div>
              <h1 className="flex items-center gap-1.5 text-sm font-semibold">
                <GitMerge className="size-4" /> Resolve conflicts
              </h1>
              <p className="text-muted-foreground text-xs">
                {total} {total === 1 ? 'file needs' : 'files need'} resolution
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
              title="Back to your Files"
            >
              <ArrowLeft className="size-3.5" /> Back
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto py-2">
            {busy === 'load' ? (
              <p className="text-muted-foreground flex items-center gap-2 px-4 py-3 text-xs">
                <Loader2 className="size-3.5 animate-spin" /> Checking for conflicts…
              </p>
            ) : total === 0 ? (
              // No true Conflict is a first-class state (never a blank pane). When the merge
              // auto-merged, say so explicitly — the non-overlapping edits resolved themselves.
              <div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10 text-center text-xs">
                <CheckCircle2 className="text-dd-green-400 size-6" />
                <p>
                  {autoMerged
                    ? 'No conflicts — every incoming change merged cleanly.'
                    : 'Nothing to resolve.'}
                </p>
              </div>
            ) : (
              <section>
                <h2 className="text-muted-foreground px-4 py-1 text-[11px] font-semibold tracking-wide">
                  CONFLICTS · {total}
                </h2>
                {items.map((item) => (
                  <ConflictRow
                    key={item.targetPath}
                    item={item}
                    selected={selected === item.targetPath}
                    resolvedAs={resolved.get(item.targetPath)}
                    onSelect={() => setSelected(item.targetPath)}
                  />
                ))}
              </section>
            )}
          </div>
        </aside>

        {/* Center — the merge view for the selected File (AppPane/Merge). */}
        <main className="flex min-w-0 flex-col overflow-hidden">
          <div className="border-border flex items-center gap-3 border-b px-4 py-2">
            <span className="font-mono text-sm">
              {selected ? `~/${selected}` : 'Select a file'}
            </span>
            {selectedItem ? (
              resolved.has(selectedItem.targetPath) ? (
                <span className="bg-dd-green-950 text-dd-green-400 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
                  <CheckCircle2 className="size-3" /> Resolved
                </span>
              ) : (
                <span className="bg-dd-red-950 text-dd-red-400 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
                  <AlertTriangle className="size-3" /> Conflict
                </span>
              )
            ) : null}
            {/* The three-way resolution — Keep mine / Take theirs / Open both. Each routes
              through ConflictModel.resolve(choice) in the main process (invariant #1), so
              the user consciously chooses the result; we never auto-pick a side. */}
            {selectedItem ? (
              <div className="ml-auto flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => resolveFile(selectedItem.targetPath, 'current')}
                  title="Keep this environment's version"
                >
                  <span className="bg-dd-amber-400 size-2 rounded-full" /> Keep mine
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => resolveFile(selectedItem.targetPath, 'incoming')}
                  title="Take the incoming (Remote) version"
                >
                  <span className="bg-dd-blue-400 size-2 rounded-full" /> Take theirs
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => resolveFile(selectedItem.targetPath, 'both')}
                  title="Keep both, with conflict markers, to hand-edit"
                >
                  Keep both
                </Button>
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">
            {selectedItem ? (
              // The current/incoming/both merge primitive. It is READ-ONLY here: we pass the
              // marker-bearing union and turn OFF the library's own resolve actions
              // (`mergeConflictActionsType: 'none'`), so resolution can ONLY happen through the
              // buttons above → IPC → ConflictModel.resolve (never resolveConflict() directly).
              <UnresolvedFile
                key={selectedItem.targetPath}
                file={{ name: selectedItem.targetPath, contents: selectedItem.both }}
                options={{ mergeConflictActionsType: 'none' }}
                disableWorkerPool
              />
            ) : (
              <p className="text-muted-foreground">Select a conflicted file to resolve it.</p>
            )}
          </div>
        </main>

        {/* Right — progress + Apply resolution + Abort (AppPane/Resolve). */}
        <aside className="border-border bg-sidebar flex flex-col gap-4 overflow-auto border-l p-4 text-sm">
          {error ? (
            <div
              className="bg-dd-red-950 text-dd-red-400 rounded-md px-3 py-2 text-xs"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          {/* Progress n / m — the bespoke resolve bar (the one allowed bespoke control). */}
          <section className="border-border bg-card rounded-md border p-3">
            <h2 className="mb-2 flex items-center justify-between text-xs font-semibold tracking-wide">
              <span className="inline-flex items-center gap-1.5">
                <GitMerge className="size-3.5" /> RESOLUTION
              </span>
              <span className="text-muted-foreground">
                {resolvedCount} / {total}
              </span>
            </h2>
            <div className="bg-secondary h-1.5 w-full overflow-hidden rounded-full">
              <div
                className="bg-dd-green-400 h-full rounded-full transition-all"
                style={{ width: total === 0 ? '0%' : `${(resolvedCount / total) * 100}%` }}
              />
            </div>
            {/* The keep-mine/take-theirs/keep-both legend (functional-color discipline). */}
            <ul className="text-muted-foreground mt-3 flex flex-col gap-1 text-xs">
              <li className="flex items-center gap-2">
                <span className="bg-dd-amber-400 size-2 rounded-full" /> Keep mine — this
                environment
              </li>
              <li className="flex items-center gap-2">
                <span className="bg-dd-blue-400 size-2 rounded-full" /> Take theirs — the Remote
              </li>
              <li className="flex items-center gap-2">
                <span className="bg-dd-green-400 size-2 rounded-full" /> Keep both — hand-edit
              </li>
            </ul>
          </section>

          {/* Apply resolution — Secondary while unresolved → Primary (ember) when ready, the
            ONE place ember is used (the primary action). Disabled until every File resolves. */}
          <Button
            variant={allResolved ? 'default' : 'secondary'}
            disabled={!allResolved || busy !== null}
            onClick={applyResolution}
            title={
              allResolved
                ? 'Complete the merge with your resolutions'
                : 'Resolve every conflicted file first'
            }
          >
            {busy === 'apply' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Apply resolution
          </Button>

          {/* Abort — destructive-tinted Ghost; discards the merge (resolves nothing). */}
          <Button
            variant="outline"
            className="text-dd-red-400"
            disabled={busy !== null || total === 0}
            onClick={() => setConfirmingAbort(true)}
            title="Discard the merge and return to your last commit"
          >
            {busy === 'abort' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <XCircle className="size-4" />
            )}
            Abort
          </Button>
        </aside>
      </div>

      {/* Abort confirm — discarding a half-merged tree throws away the merge (but not your
          Commits). Destructive tone so the consequence is explicit (never fail silently). */}
      <ConfirmDialog
        open={confirmingAbort}
        onOpenChange={(open) => {
          if (!open) setConfirmingAbort(false)
        }}
        tone="destructive"
        title="Abort this merge?"
        body={
          <>
            This discards the in-progress merge and returns to your last commit.{' '}
            <strong>Nothing is resolved</strong> — your own Commits are untouched, and you can try
            resolving again later.
          </>
        }
        confirmLabel="Abort merge"
        confirmDisabled={busy !== null}
        onConfirm={abort}
      />
    </div>
  )
}

/**
 * One row in the conflict list: the File path with the ⚠ Conflict marker, and — once the
 * user resolves it — a ✓ with which side they chose. Selecting it loads the merge view.
 */
function ConflictRow({
  item,
  selected,
  resolvedAs,
  onSelect,
}: {
  item: ConflictReviewItem
  selected: boolean
  resolvedAs: ResolutionChoice | undefined
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-item-path={item.targetPath}
      className={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm ${
        selected ? 'bg-accent' : 'hover:bg-accent/50'
      } ${resolvedAs ? '' : 'text-dd-red-400'}`}
    >
      {resolvedAs ? (
        <CheckCircle2 className="text-dd-green-400 size-3.5 shrink-0" aria-label="resolved" />
      ) : (
        <AlertTriangle className="text-dd-red-400 size-3.5 shrink-0" aria-label="conflict" />
      )}
      <span className="truncate font-mono text-xs">{item.targetPath}</span>
      {resolvedAs ? (
        <span className="text-muted-foreground ml-auto text-[10px] tracking-wide uppercase">
          {resolvedAs === 'current' ? 'mine' : resolvedAs === 'incoming' ? 'theirs' : 'both'}
        </span>
      ) : null}
    </button>
  )
}
