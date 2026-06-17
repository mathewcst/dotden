import { LaunchRouter } from '@/features/launch/components/LaunchRouter'
import { applyTheme } from '@/shared/lib/apply-theme'
import { useEffect } from 'react'

/**
 * App — the thin application root (ADR 0027). It applies the one global, app-wide concern (the
 * synced theme) and delegates all routing to {@link LaunchRouter}, which owns the route machine,
 * the launch gate (ADR 0026), and the den-session lifecycle for the `app` route.
 */
export function App() {
  // Apply the user's synced theme (issue 2-10) on launch, so the app opens in their chosen accent
  // rather than always the default ember. The read degrades to the default when there is no Den yet
  // (a fresh first run), so this is safe before onboarding — and never fails silently. `applyTheme`
  // only toggles a class (no React state), so no unmount guard is needed (App is the never-unmounting
  // root anyway).
  useEffect(() => {
    window.dotden.den
      .appearanceSettings()
      .then((settings) => applyTheme(settings.theme))
      .catch(() => {
        // No Den / read failed — keep the default ember base (already applied via index.css).
      })
  }, [])

  return <LaunchRouter />
}
