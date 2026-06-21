import { Button } from '@/ui/button'
import { AlertTriangle, RotateCcw, ScrollText } from 'lucide-react'
import { Banner } from '@/features/sync/components/Banner'

/** Red failed-Operation strip with the load-bearing Details + Retry actions. */
export function ErrorBanner({
  message,
  onViewDetails,
  onRetry,
}: {
  message: string
  onViewDetails?: () => void
  onRetry?: () => void
}) {
  return (
    <Banner tone="error" className="min-w-0">
      <AlertTriangle className="text-dd-red-400 size-4 shrink-0" />
      <span className="min-w-0 truncate font-medium">{message}</span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="border-dd-red-700 text-dd-red-100 hover:bg-dd-red-900 ml-auto"
        disabled={!onViewDetails}
        onClick={onViewDetails}
      >
        <ScrollText className="size-3.5" />
        View details
      </Button>
      <Button type="button" size="sm" variant="destructive" disabled={!onRetry} onClick={onRetry}>
        <RotateCcw className="size-3.5" />
        Retry
      </Button>
    </Banner>
  )
}
