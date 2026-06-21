import { Button } from '@/components/den/button'
import { useDenSession } from '@/den-session'
import { AlertTriangle, GitMerge } from 'lucide-react'

/**
 * ConflictCallout — the inspector's Conflict callout (issue 1-11). When the Remote axis shows ⚠
 * Conflicts, the same File changed here and on the Remote; the user must resolve the
 * cross-environment merge — dotden never picks a side. Shown on env A's everyday view; its CTA
 * opens the dedicated Conflict resolution surface (the `resolving` flag in the apply slice).
 */
export function ConflictCallout() {
  const role = useDenSession((s) => s.role)
  const remoteAxis = useDenSession((s) => s.remoteAxis)
  const busy = useDenSession((s) => s.busy)
  const setResolving = useDenSession((s) => s.setResolving)

  // Whether any incoming File is in ⚠ Conflict (issue 1-11): if so, the user must resolve the
  // cross-environment merge before those Files can be applied.
  const conflictCount = [...remoteAxis.values()].filter((m) => m === 'conflict').length

  if (!(role === 'a' && conflictCount > 0)) return null

  return (
    <section className="border-dd-red-900 bg-dd-red-950/40 rounded-md border p-3">
      <h2 className="text-dd-red-400 mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide">
        <AlertTriangle className="size-3.5" /> {conflictCount}{' '}
        {conflictCount === 1 ? 'CONFLICT' : 'CONFLICTS'}
      </h2>
      <p className="text-muted-foreground text-xs">
        The same File changed here and on the Remote. Resolve the merge — dotden never picks a side
        for you.
      </p>
      <Button
        size="sm"
        variant="secondary"
        className="mt-3 w-full"
        disabled={busy !== null}
        onClick={() => setResolving(true)}
      >
        <GitMerge className="size-4" /> Resolve conflicts
      </Button>
    </section>
  )
}
