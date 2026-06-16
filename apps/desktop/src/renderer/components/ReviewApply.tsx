import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PatchDiff } from '@pierre/diffs/react'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { StatusTag } from '@/components/StatusTag'
import type {
  ApplyFileResult,
  IncomingReviewItem,
  IncomingSummary,
} from '../../main/foundation/den-service'

/**
 * ReviewApply — the **Review & Apply** surface (issue 1-09), modeled on the
 * `Returning · Review & Apply` screen ([sync-states](../../../docs/design-system/screens/sync-states.md)
 * → [returning-environment](../../../docs/design-system/screens/returning-environment.md)).
 *
 * It is the place a user **reviews incoming changes before applying them**: the left
 * pane lists the incoming Files grouped into CONFLICTS (⚠, not applied here — owned by
 * issue 1-11) and APPLIES CLEANLY (↓), the center shows the selected File's incoming
 * **diff** (so nothing is applied unreviewed), and the actions are **Apply one** (the
 * selected File) or **Apply all**.
 *
 * The contract this surface enforces (issue 1-09 acceptance criteria):
 * - **per-file atomicity** — Apply routes through `den.apply`, which applies each File
 *   in its own `chezmoi apply`, so one failure never blocks the rest;
 * - **failures are reported with a reason** beside the row, and
 * - a **Retry** re-runs ONLY the failures (the previously-failed paths), never the
 *   whole batch.
 *
 * Conflicts are surfaced but NOT applied here — the incoming-clean path this slice owns
 * never writes a Conflict (it is deferred to the ConflictModel owner, issue 1-11). The
 * row is shown with the ⚠ tone so the user sees it, with Apply disabled for it.
 */
export function ReviewApply({ onClose }: { onClose: () => void }) {
  // The incoming summary (Files + their Remote-axis markers + the source environment
  // label), fetched from the main process. `null` until the first load resolves.
  const [summary, setSummary] = useState<IncomingSummary | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  // Starts at `load` because the surface mounts already fetching the incoming summary —
  // setting it here (not synchronously inside the effect) keeps the effect side-effect-free.
  const [busy, setBusy] = useState<null | 'load' | 'diff' | 'apply'>('load')
  const [error, setError] = useState<string | null>(null)
  // The per-File outcomes of the LAST Apply, keyed by path, so a failed row can show its
  // reason and offer a retry. Cleared for a path the moment it is re-applied.
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, ApplyFileResult>>(new Map())
  // The paths an Apply is BLOCKED on pending the user's explicit deletion confirmation
  // (invariant #4, ADR 0008). Non-null while the confirm dialog is open; it holds the full
  // requested batch AND the subset that are incoming deletions, so confirming applies the
  // whole batch with exactly those paths passed as `confirmedDeletions`. `null` = no dialog.
  const [pendingDeletion, setPendingDeletion] = useState<{
    readonly paths: readonly string[]
    readonly deletions: readonly string[]
  } | null>(null)

  // Memoized so the by-marker splits below have a stable dependency (the summary object
  // only changes when a fetch/apply replaces it).
  const items = useMemo(() => summary?.items ?? [], [summary])
  // Split the incoming Files by their Remote axis: ⚠ Conflicts (not applied here) vs ↓
  // applies-cleanly. This mirrors the design's two left-pane sections.
  const conflicts = useMemo(() => items.filter((i) => i.marker === 'conflict'), [items])
  const clean = useMemo(() => items.filter((i) => i.marker === 'incoming'), [items])

  // Select a File AND fetch its incoming diff for the center pane. A monotonic token
  // guards against an out-of-order response when the user clicks rows fast (last wins).
  // Declared before the mount effect so the effect can auto-select the first File.
  const diffTokenRef = useRef(0)
  const selectFile = useCallback(async (path: string | null) => {
    setSelected(path)
    const token = ++diffTokenRef.current
    if (path === null) {
      setDiff(null)
      return
    }
    setBusy('diff')
    try {
      const patch = await window.dotden.den.incomingDiff(path)
      if (token === diffTokenRef.current) setDiff(patch)
    } catch (caught) {
      if (token === diffTokenRef.current) {
        setError(caught instanceof Error ? caught.message : 'Could not load the incoming diff.')
        setDiff(null)
      }
    } finally {
      if (token === diffTokenRef.current) setBusy((b) => (b === 'diff' ? null : b))
    }
  }, [])

  // Fetch the incoming summary on mount. An `active` guard drops a late reply after
  // unmount (the codebase convention; satisfies no-setState-in-effect by only updating
  // AFTER the await, never synchronously in the effect body).
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const next = await window.dotden.den.incomingSummary()
        if (!active) return
        setSummary(next)
        // Auto-select the first applies-cleanly File so the diff pane is never blank.
        const first = next.items.find((i) => i.marker === 'incoming') ?? next.items[0]
        if (first) void selectFile(first.targetPath)
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not read incoming.')
      } finally {
        if (active) setBusy((b) => (b === 'load' ? null : b))
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [selectFile])

  // Run the actual Apply for a set of paths (with the deletion paths the user has already
  // confirmed), then fold the per-File outcomes into state so each row shows its result and
  // the applied Files drop out of the incoming list. The per-file atomicity + retry +
  // invariant enforcement all live in the main process; the UI only chooses WHICH paths to
  // (re)apply and which deletions it has explicitly confirmed (invariant #4).
  const runApply = useCallback(
    async (paths: readonly string[], confirmedDeletions: readonly string[]) => {
      if (paths.length === 0) return
      setBusy('apply')
      setError(null)
      try {
        const result = await window.dotden.den.apply(paths, confirmedDeletions)
        // Record every File's outcome (ok or error-with-reason) so failed rows can retry.
        setOutcomes((prev) => {
          const next = new Map(prev)
          for (const r of result.results) next.set(r.targetPath, r)
          return next
        })
        // Drop the successfully-applied Files from the incoming list — they are now applied
        // (written, or removed for a confirmed deletion).
        const applied = new Set(result.applied)
        setSummary((prev) =>
          prev ? { ...prev, items: prev.items.filter((i) => !applied.has(i.targetPath)) } : prev,
        )
        // Keep selection sensible: if the selected File applied, move to the next one.
        if (selected && applied.has(selected)) {
          const remaining = (summary?.items ?? []).filter(
            (i) => !applied.has(i.targetPath) && i.marker === 'incoming',
          )
          void selectFile(remaining[0]?.targetPath ?? null)
        }
      } catch (caught) {
        // A thrown error here is a whole-Operation failure (e.g. the model could not be
        // read), distinct from a per-File failure (which comes back in `results`).
        setError(caught instanceof Error ? caught.message : 'Apply failed.')
      } finally {
        setBusy(null)
      }
    },
    [selected, summary, selectFile],
  )

  // Request an Apply for a set of paths. If any path is an incoming **deletion**
  // (`requiresConfirmation`, invariant #4), the Apply is GATED behind an explicit confirm
  // dialog first — dotden never deletes a File without the user confirming it. A batch with
  // no deletions applies straight through (no dialog). Shared by Apply one, Apply all, and
  // Retry — each just passes a different set of paths.
  const applyPaths = useCallback(
    (paths: readonly string[]) => {
      if (paths.length === 0) return
      // Which requested paths are incoming deletions the planner says must be confirmed.
      const deletions = paths.filter(
        (path) => items.find((i) => i.targetPath === path)?.requiresConfirmation,
      )
      if (deletions.length > 0) {
        // Hold the batch + its deletions and open the confirm; the apply runs on confirm.
        setPendingDeletion({ paths, deletions })
        return
      }
      void runApply(paths, [])
    },
    [items, runApply],
  )

  // The user CONFIRMED the pending incoming deletion(s): run the held batch, passing exactly
  // the confirmed deletion paths so the main process applies them (invariant #4 satisfied).
  const confirmPendingDeletion = useCallback(() => {
    if (!pendingDeletion) return
    const { paths, deletions } = pendingDeletion
    setPendingDeletion(null)
    void runApply(paths, deletions)
  }, [pendingDeletion, runApply])

  // Apply all = every applies-cleanly File (Conflicts are never applied here).
  const applyAll = () => applyPaths(clean.map((i) => i.targetPath))
  // Apply one = the selected File (only when it is an applies-cleanly incoming File).
  const applyOne = () => {
    if (selected) applyPaths([selected])
  }
  // Retry = re-run ONLY the Files that failed (and are retryable), never the whole batch.
  const retryable = [...outcomes.values()].filter((r) => r.outcome === 'error' && r.retryable)
  const retryFailures = () => applyPaths(retryable.map((r) => r.targetPath))

  const selectedItem = items.find((i) => i.targetPath === selected)
  const failures = [...outcomes.values()].filter((r) => r.outcome === 'error')
  const fromLabel = summary?.fromEnvironmentLabel ?? 'another environment'
  const totalCount = items.length

  return (
    <div className="bg-background text-foreground grid h-screen grid-cols-[280px_1fr_320px] overflow-hidden">
      {/* Left pane — the incoming list, grouped CONFLICTS / APPLIES CLEANLY. */}
      <aside className="border-border bg-sidebar flex flex-col overflow-hidden border-r">
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <div>
            <h1 className="text-sm font-semibold">Review &amp; Apply</h1>
            <p className="text-muted-foreground text-xs">
              {totalCount} {totalCount === 1 ? 'file' : 'files'} · from {fromLabel}
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
              <Loader2 className="size-3.5 animate-spin" /> Reading incoming changes…
            </p>
          ) : totalCount === 0 ? (
            // Empty incoming review is a first-class state (never a blank pane).
            <div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10 text-center text-xs">
              <CheckCircle2 className="text-dd-green-400 size-6" />
              <p>Nothing incoming to review. You are up to date with {fromLabel}.</p>
            </div>
          ) : (
            <>
              {/* CONFLICTS — surfaced but not applied here (ConflictModel owns them, 1-11). */}
              {conflicts.length > 0 ? (
                <section className="mb-2">
                  <h2 className="text-muted-foreground px-4 py-1 text-[11px] font-semibold tracking-wide">
                    CONFLICTS · {conflicts.length}
                  </h2>
                  {conflicts.map((item) => (
                    <ReviewRow
                      key={item.targetPath}
                      item={item}
                      selected={selected === item.targetPath}
                      outcome={outcomes.get(item.targetPath)}
                      onSelect={() => void selectFile(item.targetPath)}
                    />
                  ))}
                </section>
              ) : null}

              {/* APPLIES CLEANLY — the ↓ incoming Files this slice can Apply. */}
              {clean.length > 0 ? (
                <section>
                  <h2 className="text-muted-foreground px-4 py-1 text-[11px] font-semibold tracking-wide">
                    APPLIES CLEANLY · {clean.length}
                  </h2>
                  {clean.map((item) => (
                    <ReviewRow
                      key={item.targetPath}
                      item={item}
                      selected={selected === item.targetPath}
                      outcome={outcomes.get(item.targetPath)}
                      onSelect={() => void selectFile(item.targetPath)}
                    />
                  ))}
                </section>
              ) : null}
            </>
          )}
        </div>

        <div className="border-border text-muted-foreground flex items-center gap-2 border-t px-4 py-2 text-xs">
          <Download className="size-3.5" /> from {fromLabel}
        </div>
      </aside>

      {/* Center pane — selected File header + incoming diff (review before Apply). */}
      <main className="flex min-w-0 flex-col overflow-hidden">
        <div className="border-border flex items-center gap-3 border-b px-4 py-2">
          <span className="font-mono text-sm">{selected ? `~/${selected}` : 'Select a File'}</span>
          {selectedItem ? <StatusTag status="incoming" /> : null}
          {selectedItem?.marker === 'conflict' ? (
            <span className="bg-dd-red-950 text-dd-red-400 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
              <AlertTriangle className="size-3" /> Conflict
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {/* Apply one — the selected applies-cleanly File only. */}
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null || !selectedItem || selectedItem.marker !== 'incoming'}
              onClick={applyOne}
              title="Apply just this File"
            >
              {busy === 'apply' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowDownToLine className="size-4" />
              )}
              Apply
            </Button>
            {/* Apply all — every applies-cleanly File. */}
            <Button
              size="sm"
              disabled={busy !== null || clean.length === 0}
              onClick={applyAll}
              title="Apply every File that applies cleanly"
            >
              <Download className="size-4" />
              Apply all
            </Button>
          </div>
        </div>

        <div className="border-border text-muted-foreground flex items-center gap-4 border-b px-4 text-xs">
          <span className="text-foreground border-primary border-b-2 py-2 font-medium">
            Changes
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">
          {selected === null ? (
            <p className="text-muted-foreground">Select an incoming File to review its changes.</p>
          ) : busy === 'diff' ? (
            <p className="text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Loading incoming diff…
            </p>
          ) : diff && diff.trim().length > 0 ? (
            <PatchDiff patch={diff} disableWorkerPool />
          ) : (
            <p className="text-muted-foreground">
              No changes to apply for this File — it already matches the Den.
            </p>
          )}
        </div>
      </main>

      {/* Right inspector — the incoming card + the failures/retry surface. */}
      <aside className="border-border bg-sidebar flex flex-col gap-4 overflow-auto border-l p-4 text-sm">
        {error ? (
          <div className="bg-dd-red-950 text-dd-red-400 rounded-md px-3 py-2 text-xs" role="alert">
            {error}
          </div>
        ) : null}

        {/* The incoming card — "N incoming changes · from <env>" (sync-states spec). */}
        <section className="border-border bg-card rounded-md border p-3">
          <h2 className="mb-1 flex items-center justify-between text-xs font-semibold tracking-wide">
            <span className="text-dd-blue-400 inline-flex items-center gap-1.5">
              <ArrowDownToLine className="size-3.5" /> {totalCount} incoming{' '}
              {totalCount === 1 ? 'change' : 'changes'}
            </span>
            <span className="text-muted-foreground">{totalCount}</span>
          </h2>
          <p className="text-muted-foreground text-xs">
            from {fromLabel}
            {conflicts.length > 0
              ? ` · ${clean.length} clean, ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}`
              : ''}
          </p>
        </section>

        {/* Failures + Retry — failed Applies are reported with a reason and a retry that
            re-runs ONLY the failures (issue 1-09 acceptance criteria). */}
        {failures.length > 0 ? (
          <section className="border-dd-red-900 bg-dd-red-950/40 rounded-md border p-3">
            <h2 className="text-dd-red-400 mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide">
              <AlertTriangle className="size-3.5" /> {failures.length} FAILED
            </h2>
            <ul className="flex flex-col gap-2">
              {failures.map((f) => (
                <li key={f.targetPath} className="text-xs">
                  <span className="font-mono break-all">{f.targetPath}</span>
                  <p className="text-muted-foreground mt-0.5">{f.reason}</p>
                </li>
              ))}
            </ul>
            {retryable.length > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                className="mt-3 w-full"
                disabled={busy !== null}
                onClick={retryFailures}
                title="Retry only the failed Files"
              >
                {busy === 'apply' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Retry {retryable.length} {retryable.length === 1 ? 'file' : 'files'}
              </Button>
            ) : (
              <p className="text-muted-foreground mt-3 text-xs">
                These Files do not apply to this environment, so they can&rsquo;t be retried here.
              </p>
            )}
          </section>
        ) : null}

        {/* FILE info for the selected incoming File. */}
        {selectedItem ? (
          <section>
            <h2 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide">FILE</h2>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs">
              <dt className="text-muted-foreground">Workspace</dt>
              <dd className="text-right">{selectedItem.workspaceId || '—'}</dd>
              <dt className="text-muted-foreground">Remote</dt>
              <dd className="text-right">
                {selectedItem.marker === 'conflict' ? 'Conflict' : 'Incoming'}
              </dd>
              <dt className="text-muted-foreground">Path</dt>
              <dd className="text-right font-mono break-all">{selectedItem.targetPath}</dd>
              <dt className="text-muted-foreground">Result</dt>
              <dd className="text-right">
                {outcomes.get(selectedItem.targetPath)?.outcome === 'ok'
                  ? 'Applied'
                  : outcomes.get(selectedItem.targetPath)?.outcome === 'error'
                    ? 'Failed'
                    : 'Pending'}
              </dd>
            </dl>
          </section>
        ) : null}
      </aside>

      {/* Incoming-deletion confirm (invariant #4, ADR 0008): an incoming change that
          REMOVES a File is never applied until the user explicitly confirms it. Destructive
          tone + the named paths so the user sees exactly what disappears (never fail
          silently). Confirming applies the held batch with these paths as confirmedDeletions. */}
      <ConfirmDialog
        open={pendingDeletion !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeletion(null)
        }}
        tone="destructive"
        title={
          (pendingDeletion?.deletions.length ?? 0) === 1
            ? 'Apply this incoming deletion?'
            : `Apply ${pendingDeletion?.deletions.length ?? 0} incoming deletions?`
        }
        body={
          <>
            These Files were removed from the Den on {fromLabel}. Applying will{' '}
            <strong>delete the real file</strong> on this environment:
            <ul className="mt-2 flex flex-col gap-1">
              {(pendingDeletion?.deletions ?? []).map((path) => (
                <li key={path} className="text-dd-red-400 inline-flex items-center gap-1.5">
                  <Trash2 className="size-3.5 shrink-0" /> <span className="font-mono">{path}</span>
                </li>
              ))}
            </ul>
          </>
        }
        confirmLabel={
          (pendingDeletion?.deletions.length ?? 0) === 1 ? 'Delete file' : 'Delete files'
        }
        confirmDisabled={busy === 'apply'}
        onConfirm={confirmPendingDeletion}
      />
    </div>
  )
}

/**
 * One row in the Review & Apply list: the File path with its Remote-axis marker (↓/⚠)
 * and, after an Apply, a per-File result glyph (✓ applied / ⚠ failed). Selecting it
 * loads the incoming diff in the center pane.
 */
function ReviewRow({
  item,
  selected,
  outcome,
  onSelect,
}: {
  item: IncomingReviewItem
  selected: boolean
  outcome: ApplyFileResult | undefined
  onSelect: () => void
}) {
  const isConflict = item.marker === 'conflict'
  return (
    <button
      type="button"
      onClick={onSelect}
      data-item-path={item.targetPath}
      className={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm ${
        selected ? 'bg-accent' : 'hover:bg-accent/50'
      } ${isConflict ? 'text-dd-red-400' : ''}`}
    >
      {/* The Remote-axis marker (↓ incoming / ⚠ conflict) — the second status axis. */}
      {isConflict ? (
        <AlertTriangle className="text-dd-red-400 size-3.5 shrink-0" aria-label="conflict" />
      ) : (
        <ArrowDownToLine className="text-dd-blue-400 size-3.5 shrink-0" aria-label="incoming" />
      )}
      <span className="truncate font-mono text-xs">{item.targetPath}</span>
      {/* The per-File Apply result (after an Apply attempt). */}
      {outcome?.outcome === 'ok' ? (
        <CheckCircle2
          className="text-dd-green-400 ml-auto size-3.5 shrink-0"
          aria-label="applied"
        />
      ) : outcome?.outcome === 'error' ? (
        <AlertTriangle className="text-dd-red-400 ml-auto size-3.5 shrink-0" aria-label="failed" />
      ) : null}
    </button>
  )
}
