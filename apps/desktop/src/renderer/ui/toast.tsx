import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'
import { Button } from './button'
import { cn } from '../shared/lib/utils'
import {
  clearToasts,
  dismissToast,
  getToasts,
  subscribeToasts,
  type ToastTone,
} from './toast-store'

export { clearToasts, dismissToast, getToasts, showToast, toast } from './toast-store'

function useToasts() {
  return useSyncExternalStore(subscribeToasts, getToasts, getToasts)
}

const toneClass: Record<ToastTone, string> = {
  success: 'border-dd-green-500/40 bg-dd-green-950 text-dd-green-400',
  info: 'border-border bg-card text-foreground',
  warning: 'border-dd-amber-500/40 bg-dd-amber-950 text-dd-amber-400',
  error: 'border-dd-red-500/40 bg-dd-red-950 text-dd-red-400',
}

const toneIcon = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: OctagonAlert,
} satisfies Record<ToastTone, typeof Info>

export function ToastViewport() {
  const visibleToasts = useToasts()

  useEffect(() => {
    return () => clearToasts()
  }, [])

  if (visibleToasts.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {visibleToasts.map((toastMessage) => {
        const Icon = toneIcon[toastMessage.tone]
        return (
          <div
            key={toastMessage.id}
            className={cn(
              'pointer-events-auto flex min-h-12 items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-lg',
              toneClass[toastMessage.tone],
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p className="min-w-0 flex-1 leading-5 break-words">{toastMessage.message}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="size-7 shrink-0 border-transparent bg-transparent p-0 shadow-none"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(toastMessage.id)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
