import { Button } from '@/components/den/button'
import { FolderOpen, Loader2, Plus, ScanSearch } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DiscoverySuggestion } from '@shared/environments'
import { withIpcTimeout } from '@/lib/ipc-timeout'
import { ListRow } from './ListRow'
import { warnedPathsFromFindings } from '../lib/secret-warn'

/** Human-friendly size for a row's meta slot, or "Folder" for a directory. */
function metaFor(suggestion: DiscoverySuggestion): string {
  if (suggestion.isFolder) return 'Folder'
  if (suggestion.sizeBytes < 1024) return `${suggestion.sizeBytes} B`
  return `${Math.round(suggestion.sizeBytes / 1024)} KB`
}

/**
 * OBDiscover — onboarding step 4 (design: onboarding.md `OBContent/Discover`).
 *
 * Runs the **tool-catalog discovery scan** (`window.dotden.discover.scan`) and offers
 * the found config Files for Tracking, **grouped by the tool** they belong to so the
 * suggestions read as relevant (grounded, not a blind sweep — ADR 0022). The user
 * checks the ones to manage; advancing Tracks each pick through the 1-04 path
 * (`window.dotden.den.track` → `chezmoi add` + a `.dotden/` placement), which also
 * seeds the **default Workspace automatically** (no organization asked up front).
 *
 * Files the scan missed are still manageable: a **drag-in / browse** affordance lets
 * the user add any home-relative path (`window.dotden.discover.inspectPath`), which
 * appends to the list and Tracks identically — the "manage anything" criterion.
 *
 * @param onTracked Called with the Tracked paths once advancing succeeds, so the
 *   shell can carry them into the First-commit step.
 */
export function OBDiscover({
  onTracked,
}: {
  onTracked: (trackedPaths: readonly string[]) => void
}) {
  const [scanning, setScanning] = useState(true)
  const [suggestions, setSuggestions] = useState<readonly DiscoverySuggestion[]>([])
  // Default selection = all found configs checked (the common "yes, sync these" case);
  // the user unchecks anything they want to skip.
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  // The set of discovered Files the SecretScanner flagged as secret-bearing (issue 2-07).
  // A flagged File still shows as a normal *selectable* row (warn-not-block, ADR 0001) — its
  // ListRow renders the amber "Secret · review at commit" state; the secret is handled at
  // Commit time by the warn step. We mark, never exclude, and never auto-deselect.
  const [warnedPaths, setWarnedPaths] = useState<ReadonlySet<string>>(new Set())
  const [customPath, setCustomPath] = useState('')
  const [tracking, setTracking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  // Run the scan once on mount. A failed scan surfaces inline and leaves an empty
  // (but recoverable) list — discovery is best-effort, the user can still drag in.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const found = await window.dotden.discover.scan()
        if (cancelled) return
        setSuggestions(found.suggestions)
        setPicked(new Set(found.suggestions.map((s) => s.targetPath)))
        // Reconcile the SecretScanner into Discover (issue 2-07): run the SAME commit-time
        // scanner (`den.scanCommit`, issue 2-03 — no parallel detector) over the discovered
        // Files and flag the secret-bearing ones for the amber `Warn` row. Best-effort: a
        // failed secret scan must never block discovery (the Files stay neutral, still
        // Trackable, and the commit-time warn step still catches secrets later).
        await refreshWarnings(
          found.suggestions.map((s) => s.targetPath),
          () => cancelled,
        )
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Scan failed.')
      } finally {
        if (!cancelled) setScanning(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Run the commit-time SecretScanner over a set of discovered paths and update the warned
   * set (issue 2-07). Reuses `window.dotden.den.scanCommit` — the exact detector the Commit
   * step uses — so onboarding and Commit agree on what looks secret-bearing (no fork).
   *
   * Best-effort + non-blocking: a scan failure leaves the previous warnings untouched and is
   * swallowed (the row simply stays neutral). The secret is never *missed* by this — the
   * commit-time warn step re-scans at Commit and catches it regardless (ADR 0001).
   *
   * @param paths Destination-relative discovered paths to scan for secrets.
   * @param isCancelled Guard so a stale async result after unmount is dropped.
   */
  async function refreshWarnings(
    paths: readonly string[],
    isCancelled: () => boolean,
  ): Promise<void> {
    if (paths.length === 0) return
    try {
      const findings = await window.dotden.den.scanCommit(paths)
      if (isCancelled()) return
      // Per-File warn (a File with many findings is one warned row) — derived by the pure
      // helper so the mapping is unit-tested independent of this component.
      const found = warnedPathsFromFindings(findings)
      setWarnedPaths((prev) => new Set([...prev, ...found]))
    } catch {
      // Advisory only — never surface a discovery error for a failed secret pre-scan; the
      // Commit step's warn flow is the real guard. Leave existing warnings as-is.
    }
  }

  // Group suggestions by tool so the list shows "Zsh / Git / Neovim …" headers.
  const groups = useMemo(() => {
    const byTool = new Map<string, { label: string; rows: DiscoverySuggestion[] }>()
    for (const suggestion of suggestions) {
      const group = byTool.get(suggestion.toolId) ?? { label: suggestion.toolLabel, rows: [] }
      group.rows.push(suggestion)
      byTool.set(suggestion.toolId, group)
    }
    return [...byTool.values()]
  }, [suggestions])

  function toggle(targetPath: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(targetPath)) next.delete(targetPath)
      else next.add(targetPath)
      return next
    })
  }

  // Add a home-relative path the scan missed (drag-in or the browse input).
  async function addCustom(targetPath: string) {
    const trimmed = targetPath.trim()
    if (!trimmed) return
    setError(null)
    try {
      const suggestion = await window.dotden.discover.inspectPath(trimmed)
      if (!suggestion) {
        // Never fail silently — say exactly why it could not be added.
        setError(
          `Couldn’t add “${trimmed}” — it must be an existing file under your home directory.`,
        )
        return
      }
      setSuggestions((prev) =>
        prev.some((s) => s.targetPath === suggestion.targetPath) ? prev : [...prev, suggestion],
      )
      setPicked((prev) => new Set(prev).add(suggestion.targetPath))
      setCustomPath('')
      // Scan the just-added File for secrets too (issue 2-07) so a dragged-in secret-bearing
      // File gets the same amber Warn row as a catalog hit — best-effort, never blocking.
      await refreshWarnings([suggestion.targetPath], () => false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Adding that file failed.')
    }
  }

  async function browseCustom() {
    setError(null)
    try {
      const targetPath = await window.dotden.discover.browse()
      if (targetPath) await addCustom(targetPath)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Browsing for a file failed.')
    }
  }

  function dropCustom(file: File | undefined) {
    if (!file) return
    const targetPath = window.dotden.discover.pathForFile(file)
    if (!targetPath) {
      setError('Couldn’t read the dropped file path. Browse or type the path instead.')
      return
    }
    void addCustom(targetPath)
  }

  // Track every picked File through the 1-04 path, then hand the paths to the shell.
  async function advance() {
    const paths = suggestions.map((s) => s.targetPath).filter((p) => picked.has(p))
    setTracking(true)
    setError(null)
    try {
      // Track sequentially so each `chezmoi add` + placement is recorded deterministically.
      for (const targetPath of paths) {
        await withIpcTimeout(
          window.dotden.den.track(targetPath),
          `Tracking ${targetPath} did not respond. Retry or skip for now.`,
        )
      }
      onTracked(paths)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Tracking your Files failed.')
    } finally {
      setTracking(false)
    }
  }

  return (
    <div className="flex max-h-full max-w-2xl flex-col gap-5">
      <header className="space-y-2">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">
          Discover your configs
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          dotden scanned for config files from tools you already use. Pick the ones to manage — or
          drag in anything the scan missed. They go into a default Workspace; you can reorganize
          later. Secrets are flagged so you store them safely, never synced raw.
        </p>
      </header>

      {scanning ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
          <Loader2 className="size-4 animate-spin" />
          Scanning your home directory…
        </div>
      ) : (
        <div
          ref={dropRef}
          aria-label="Add config files"
          className="border-border min-h-0 flex-1 space-y-4 overflow-auto rounded-md border border-dashed p-3"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            dropCustom(event.dataTransfer.files[0])
          }}
        >
          {groups.length === 0 ? (
            <p className="text-muted-foreground px-1 py-6 text-center text-sm">
              <ScanSearch className="text-muted-foreground mx-auto mb-2 size-6" />
              No known configs found. Drag a file here or browse below to manage anything.
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.label} className="space-y-1.5">
                <h2 className="text-muted-foreground px-1 text-xs font-semibold tracking-wide uppercase">
                  {group.label}
                </h2>
                {group.rows.map((row) => (
                  <ListRow
                    key={row.targetPath}
                    title={row.targetPath.split('/').pop() ?? row.targetPath}
                    path={`~/${row.targetPath}`}
                    meta={metaFor(row)}
                    isFolder={row.isFolder}
                    checked={picked.has(row.targetPath)}
                    onToggle={() => toggle(row.targetPath)}
                    // Amber Warn row when the SecretScanner flagged this File (issue 2-07) —
                    // still selectable; the secret is resolved at Commit time, not excluded.
                    warn={warnedPaths.has(row.targetPath)}
                  />
                ))}
              </section>
            ))
          )}
        </div>
      )}

      {/* Browse / type-in for Files the catalog missed (the "manage anything" path). */}
      <div className="flex items-center gap-2">
        <input
          className="border-input bg-background placeholder:text-muted-foreground flex-1 rounded-md border px-3 py-1.5 font-mono text-xs"
          placeholder=".config/something — add a file the scan missed"
          value={customPath}
          onChange={(event) => setCustomPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void addCustom(customPath)
          }}
        />
        <Button size="sm" variant="secondary" onClick={() => void addCustom(customPath)}>
          <Plus className="size-4" /> Add
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void browseCustom()}>
          <FolderOpen className="size-4" /> Browse
        </Button>
      </div>

      {error ? (
        <p className="text-dd-red-400 text-xs" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button disabled={tracking} onClick={() => void advance()}>
          {tracking ? <Loader2 className="size-4 animate-spin" /> : null}
          {picked.size > 0 ? `Track ${picked.size} selected` : 'Skip for now'}
        </Button>
        <span className="text-muted-foreground text-xs">
          {picked.size} of {suggestions.length} selected
        </span>
      </div>
    </div>
  )
}
