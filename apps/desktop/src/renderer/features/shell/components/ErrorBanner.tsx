import { Button } from '@/ui/button'
import { AlertTriangle, RotateCcw, ScrollText } from 'lucide-react'

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
    <div
      className="bg-dd-red-950 text-dd-red-100 flex min-w-0 items-center gap-2 px-4 py-2 text-sm"
      role="alert"
    >
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
    </div>
  )
}
