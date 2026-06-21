import { LaunchProvider } from '@/app/launch/components/LaunchProvider'
import { LaunchRouter } from '@/app/launch/components/LaunchRouter'
import { UpdateDownloadedPrompt } from '@/app/update/components/UpdateDownloadedPrompt'
import { ToastViewport } from '@/components/den/toast'
import { AppProviders } from '@/app/providers/AppProviders'

/**
 * App — the thin application root and composition seam (ADR 0033's `app/` layer). It mounts the
 * root plumbing ({@link AppProviders}) and the app-scoped {@link LaunchProvider} (boot + routing
 * store), then delegates all screen choice to {@link LaunchRouter}, which wraps the den-session
 * lifecycle for the `app` route. App itself touches only `app/`, `providers/`, and `den/` — never
 * `components/ui/` directly (ADR 0036); the lone `ui/` mount lives in {@link AppProviders}.
 */
export function App() {
  return (
    <AppProviders>
      <LaunchProvider>
        <LaunchRouter />
        <UpdateDownloadedPrompt />
        <ToastViewport />
      </LaunchProvider>
    </AppProviders>
  )
}
