import { useState } from 'react'
import { Workspace } from '@/components/Workspace'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'

/** The top-level route: the guided first-run, or the main three-pane app. */
type Route = 'onboarding' | 'app'

/**
 * App — the top-level router between the onboarding gate and the main app shell
 * (issue 1-06).
 *
 * First run lands in {@link OnboardingShell} (Welcome → Create your repo → Connect →
 * Discover → First commit → Auto-sync → Done). When onboarding completes, the route
 * flips to the main three-pane {@link Workspace} — the everyday app.
 *
 * The A/B role switch on the Workspace is the MVP single-window stand-in that lets
 * one running app drive both the first-environment (Track/Commit/Sync) and
 * second-environment (detect/Apply) halves of the end-to-end thread (issue 1-04).
 */
export function App() {
  const [route, setRoute] = useState<Route>('onboarding')
  const [role, setRole] = useState<'a' | 'b'>('a')

  if (route === 'onboarding') {
    return <OnboardingShell onComplete={() => setRoute('app')} />
  }

  return (
    <div className="relative">
      <div className="bg-card border-border absolute top-1 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border px-1 py-1 text-xs shadow-sm">
        <button
          className={`rounded-full px-3 py-0.5 ${role === 'a' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          onClick={() => setRole('a')}
        >
          Environment A
        </button>
        <button
          className={`rounded-full px-3 py-0.5 ${role === 'b' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          onClick={() => setRole('b')}
        >
          Environment B
        </button>
      </div>
      {/* Key by role so switching environments remounts the Workspace and resets all
          of its state (the React `key` reset pattern), keeping the A/B thread clean. */}
      <Workspace key={role} role={role} />
    </div>
  )
}
