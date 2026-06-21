import { ArrowDownToLine } from 'lucide-react'
import { Button } from '@/components/den/button'
import { Banner } from '@/components/den/banner'

/**
 * IncomingBanner — the top-level "N incoming from `<environment>` — Review & Apply"
 * entry (issue 1-09), a persistent inline status strip between the titlebar and the
 * body (the `Banner` primitive, `Tone=Incoming`; see
 * [sync-states](../../../docs/design-system/screens/sync-states.md)).
 *
 * It is the user's jump-straight-to-review affordance: when another environment has
 * pushed changes, this strip names how many are incoming and from WHICH environment,
 * and its trailing **Review & Apply** CTA navigates to the Review & Apply surface. Blue
 * is the incoming/sync functional colour; ember stays the action colour (the CTA),
 * never a status (the locked colour discipline in the spec). The strip is only rendered
 * when there is something incoming — an empty incoming state shows no banner.
 */
export function IncomingBanner({
  count,
  fromEnvironmentLabel,
  onReview,
}: {
  /** How many Files are incoming from the Remote (drives the "N incoming" copy). */
  count: number
  /** Label of the environment the changes came from (e.g. `work-laptop`). */
  fromEnvironmentLabel: string
  /** Navigate to the Review & Apply surface (the CTA). */
  onReview: () => void
}) {
  return (
    <Banner tone="incoming">
      <ArrowDownToLine className="text-dd-blue-400 size-4 shrink-0" />
      <span className="font-medium">
        {count} incoming {count === 1 ? 'change' : 'changes'}
      </span>
      <span className="text-dd-blue-300/80">from {fromEnvironmentLabel}</span>
      <Button size="sm" className="ml-auto" onClick={onReview}>
        Review &amp; Apply
      </Button>
    </Banner>
  )
}
