import { PatchDiff } from '@pierre/diffs/react'
import { Loader2 } from 'lucide-react'
import { useDenSession } from '@/den-session'

/**
 * ChangesDiff — the center pane's everyday "Changes" body (issue 1-07): the real `chezmoi diff`
 * of the selected File, fed into `@pierre/diffs`' {@link PatchDiff}, with honest empty/loading
 * states. The outbound (Commit) view of the change lifecycle (ADR 0006), so it lives in `commit/`.
 *
 * Reads its inputs straight from the scoped den-session store: a cleared selection prompts the
 * user, a loading diff shows the spinner, env B rows are incoming-clean (no local copy yet), an
 * empty diff means the File matches the Den — never a fake patch.
 */
export function ChangesDiff() {
  const selected = useDenSession((s) => s.selected)
  const busy = useDenSession((s) => s.busy)
  const role = useDenSession((s) => s.role)
  const diff = useDenSession((s) => s.diff)

  return (
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
        <p className="text-muted-foreground">No uncommitted changes — this File matches the Den.</p>
      )}
    </div>
  )
}
