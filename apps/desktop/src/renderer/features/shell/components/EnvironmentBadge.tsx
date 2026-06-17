import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Monitor, Pencil } from 'lucide-react'
import type { EnvironmentWithAttribution } from '../../../../main/foundation/environment-registry'

/**
 * EnvironmentBadge — the sidebar footer surface for this environment's IDENTITY
 * (issue 1-05): its friendly, **editable** label plus git-log-derived attribution.
 *
 * Identity is the stable id (never shown — it is plumbing); what the user sees and
 * edits is the `label`, which defaults from the hostname. Renaming writes a one-line
 * registry diff via `window.dotden.environment.rename` and never changes the id, so
 * attribution stays continuous (ADR 0024). The "last active" line is derived from
 * `git log` on read, never persisted, so it can never cause merge churn.
 *
 * Never fail silently: a failed load/rename surfaces inline and leaves the control in
 * a recoverable state rather than stranding the UI.
 */
export function EnvironmentBadge() {
  const [self, setSelf] = useState<EnvironmentWithAttribution | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load THIS environment's registry entry (the one flagged isSelf) + its attribution
  // once on mount. The `active` guard drops a late IPC reply after unmount so we never
  // setState on an unmounted component (and the linter accepts the post-await update).
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const all = await window.dotden.environment.list()
        if (active) setSelf(all.find((e) => e.isSelf) ?? null)
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Could not load this environment.')
        }
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  // Persist the edited label, then re-render from the returned (re-joined) entry.
  const save = useCallback(async () => {
    const label = draft.trim()
    if (!label) return
    setBusy(true)
    setError(null)
    try {
      const updated = await window.dotden.environment.rename(label)
      setSelf(updated)
      setEditing(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Rename failed.')
    } finally {
      setBusy(false)
    }
  }, [draft])

  if (!self) {
    return (
      <footer className="border-border text-muted-foreground border-t px-3 py-2 text-xs">
        {error ?? 'Loading this environment…'}
      </footer>
    )
  }

  return (
    <footer className="border-border text-muted-foreground flex flex-col gap-1 border-t px-3 py-2 text-xs">
      {editing ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <input
            autoFocus
            className="border-input bg-background text-foreground min-w-0 flex-1 rounded border px-2 py-1"
            value={draft}
            disabled={busy}
            aria-label="Environment label"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="submit"
            className="text-foreground hover:text-dd-ember-500 p-1"
            disabled={busy || !draft.trim()}
            aria-label="Save label"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="group hover:text-foreground flex items-center gap-1.5 text-left"
          onClick={() => {
            setDraft(self.label)
            setEditing(true)
          }}
          aria-label="Rename this environment"
        >
          <Monitor className="text-muted-foreground size-3.5" aria-hidden />
          <span className="text-foreground font-medium">{self.label}</span>
          <span className="bg-dd-green-500 size-1.5 rounded-full" aria-hidden />
          <span className="text-muted-foreground">· {self.os}</span>
          <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
        </button>
      )}

      {/* Attribution derived from git log on read — never stored in the registry. */}
      {self.attribution.lastActivityAt ? (
        <span className="text-muted-foreground">
          Last active {new Date(self.attribution.lastActivityAt).toLocaleString()} ·{' '}
          {self.attribution.commitCount} commit{self.attribution.commitCount === 1 ? '' : 's'}
        </span>
      ) : (
        <span className="text-muted-foreground">No activity yet</span>
      )}

      {error ? (
        <span className="text-dd-red-400" role="alert">
          {error}
        </span>
      ) : null}
    </footer>
  )
}
