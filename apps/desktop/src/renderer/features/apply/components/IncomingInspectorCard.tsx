import { StatusTag } from '@/components/den/status-tag'
import { Button } from '@/components/den/button'
import { useDenSession } from '@/den-session'
import { Download } from 'lucide-react'

/**
 * IncomingInspectorCard — the env-B inspector's "INCOMING CHANGES" card (issue 1-09): the Review &
 * Apply seam. Lists the incoming Files with their status and a jump-to-review CTA, or an honest
 * empty state. Its CTA opens the dedicated Review & Apply surface (the `reviewing` flag).
 */
export function IncomingInspectorCard() {
  const role = useDenSession((s) => s.role)
  const incoming = useDenSession((s) => s.incoming)
  const busy = useDenSession((s) => s.busy)
  const setReviewing = useDenSession((s) => s.setReviewing)

  if (role !== 'b') return null

  return (
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
        <>
          <ul className="flex flex-col gap-1">
            {incoming.map((item) => (
              <li key={item.targetPath} className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs">{item.targetPath}</span>
                <StatusTag status="incoming" />
              </li>
            ))}
          </ul>
          {/* The inspector card's own jump-to-review CTA (issue 1-09), mirroring the design's
              "N incoming changes · Review & Apply" card button. */}
          <Button
            size="sm"
            className="mt-3 w-full"
            disabled={busy !== null}
            onClick={() => setReviewing(true)}
          >
            <Download className="size-4" /> Review &amp; Apply
          </Button>
        </>
      )}
    </section>
  )
}
