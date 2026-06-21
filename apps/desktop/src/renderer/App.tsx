import { LaunchProvider } from '@/features/launch/components/LaunchProvider'
import { LaunchRouter } from '@/features/launch/components/LaunchRouter'
import { UpdateDownloadedPrompt } from '@/features/update/components/UpdateDownloadedPrompt'
import { ToastViewport } from '@/ui/toast'
import { TooltipProvider } from './components/ui/tooltip'

/**
 * App — the thin application root (ADR 0027). It mounts the app-scoped {@link LaunchProvider}
 * (boot + routing store) and delegates all screen choice to {@link LaunchRouter}, which wraps the
 * den-session lifecycle for the `app` route.
 */
export function App() {
  return (
    <TooltipProvider delay={100}>
      <LaunchProvider>
        <LaunchRouter />
        <UpdateDownloadedPrompt />
        <ToastViewport />
      </LaunchProvider>
    </TooltipProvider>
  )
}
