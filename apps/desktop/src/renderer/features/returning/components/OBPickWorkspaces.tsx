import { useEffect, useState } from 'react'
import { Layers, Loader2 } from 'lucide-react'
import { Button } from '@/components/den/button'
import type { SubscribableWorkspace } from '@shared/den'

/**
 * OBPickWorkspaces — returning-flow step 3 (design: returning-environment.md
 * `OBContent/PickWorkspaces`).
 *
 * The **subscription pick**: which of the Den's Workspaces this environment subscribes to —
 * **defaulting to all** (ADR 0005), so a work laptop and a personal laptop can carry different
 * subsets from one repo. Each row is a `Checkbox` (design's `SelectRow`); selection is conveyed
 * by the checkbox, not an ember accent. Submitting hands the chosen ids up so the shell can
 * register/claim the env with exactly this subscription BEFORE the reviewed Apply (issue 1-13).
 *
 * It reads the Den's Workspaces from `den.subscriptionState()` (the same read the empty-Den
 * guard uses). Selecting nothing is allowed but warned: an empty subscription materializes an
 * empty Den — surfaced honestly here, never a silent blank (the issue's never-fail-silently bar).
 *
 * @param onContinue Called with the chosen Workspace ids when the user proceeds to Review & Apply.
 */
export function OBPickWorkspaces({
  onContinue,
}: {
  onContinue: (workspaceIds: readonly string[]) => void
}) {
  const [workspaces, setWorkspaces] = useState<readonly SubscribableWorkspace[]>([])
  // The selected Workspace ids. Defaults to ALL once loaded (the issue's "defaulting to all").
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const state = await window.dotden.den.subscriptionState()
        if (!active) return
        setWorkspaces(state.workspaces)
        // Default to ALL Workspaces selected (subscribe-all is the issue's default).
        setSelected(new Set(state.workspaces.map((w) => w.id)))
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Could not read your Workspaces.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Selecting nothing is allowed but materializes an empty Den — warn honestly (never silent).
  const noneSelected = !loading && workspaces.length > 0 && selected.size === 0

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <header className="space-y-2">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">Choose Workspaces</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Pick which Workspaces this environment subscribes to. Only their Files apply here, so a
          work laptop and a personal laptop can carry different subsets of one Den.
        </p>
      </header>

      {loading ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
          <Loader2 className="size-4 animate-spin" /> Reading your Workspaces&hellip;
        </p>
      ) : workspaces.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Your Den has no Workspaces yet — nothing to subscribe to. Continue to finish setup.
        </p>
      ) : (
        <ul className="grid gap-2">
          {workspaces.map((workspace) => (
            <li key={workspace.id}>
              {/* SelectRow: a Checkbox conveys selection (neutral border, not ember). */}
              <label className="border-border bg-card flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm">
                <input
                  type="checkbox"
                  className="accent-dd-ember-500 size-4"
                  checked={selected.has(workspace.id)}
                  onChange={() => toggle(workspace.id)}
                />
                <Layers className="text-muted-foreground size-4" />
                <span className="text-foreground font-medium">{workspace.label}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {noneSelected ? (
        <p className="text-dd-amber-400 text-xs" role="alert">
          With no Workspaces selected, nothing will apply on this environment. Pick at least one to
          materialize your Den here.
        </p>
      ) : null}

      {error ? (
        <p className="text-dd-red-400 text-xs" role="alert">
          {error}
        </p>
      ) : null}

      <div>
        <Button disabled={loading} onClick={() => onContinue([...selected])}>
          Review &amp; Apply
        </Button>
      </div>
    </div>
  )
}
