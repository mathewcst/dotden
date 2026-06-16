import { useEffect, useState } from 'react'
import { ArrowRight, MonitorSmartphone, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Workspace } from '@/components/Workspace'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'
import { ReturningShell } from '@/components/returning/ReturningShell'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { applyTheme } from '@/lib/apply-theme'

/**
 * The top-level route: a landing chooser, the first-run onboarding, the second-environment
 * returning flow, the main three-pane app, or the Settings surface.
 */
type Route = 'landing' | 'onboarding' | 'returning' | 'app' | 'settings'

/**
 * App — the top-level router between the landing chooser, the two setup flows, and the main
 * app shell (issues 1-06 + 1-13).
 *
 * First launch lands on a chooser: **set up a new Den** (the first-environment onboarding,
 * issue 1-06) or **connect an existing Den** (the second-environment returning flow, issue
 * 1-13). Both finish by flipping the route to the main three-pane {@link Workspace}; the
 * returning flow opens it on the second-environment (Review & Apply) role so the user lands on
 * the reviewed Apply of the Den they just connected — the first materialization is deliberate,
 * never auto-applied (ADR 0008 / issue 1-13).
 *
 * The A/B role switch on the Workspace is the MVP single-window stand-in that lets one running
 * app drive both the first-environment (Track/Commit/Sync) and second-environment (detect/Apply)
 * halves of the end-to-end thread (issue 1-04).
 */
export function App() {
  const [route, setRoute] = useState<Route>('landing')
  const [role, setRole] = useState<'a' | 'b'>('a')

  // Apply the user's synced theme (issue 2-10) on launch, so the app opens in their chosen accent
  // rather than always the default ember. The read degrades to the default when there is no Den
  // yet (a fresh first run), so this is safe before onboarding — and never fails silently.
  // `applyTheme` only toggles a class (no React state), so no unmount guard is needed (App is the
  // never-unmounting root anyway).
  useEffect(() => {
    window.dotden.den
      .appearanceSettings()
      .then((settings) => applyTheme(settings.theme))
      .catch(() => {
        // No Den / read failed — keep the default ember base (already applied via index.css).
      })
  }, [])

  if (route === 'landing') {
    return (
      <LandingChooser
        onNew={() => setRoute('onboarding')}
        onConnect={() => setRoute('returning')}
      />
    )
  }

  if (route === 'onboarding') {
    return (
      <OnboardingShell
        onComplete={() => {
          setRole('a')
          setRoute('app')
        }}
      />
    )
  }

  if (route === 'returning') {
    return (
      <ReturningShell
        onComplete={() => {
          // Open the app on the second-environment (Review & Apply) role: the returning user
          // lands on the reviewed Apply of the Den they just connected (issue 1-13).
          setRole('b')
          setRoute('app')
        }}
      />
    )
  }

  if (route === 'settings') {
    // The Settings surface (issue 2-08) is a full-window route shown OVER the Workspace, mirroring
    // how onboarding/returning are full-window routes; closing returns to the app on the same role.
    return <SettingsShell onClose={() => setRoute('app')} />
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
      <Workspace key={role} role={role} onOpenSettings={() => setRoute('settings')} />
    </div>
  )
}

/**
 * LandingChooser — the first-launch fork between setting up a NEW Den and CONNECTING an
 * existing one (issue 1-13).
 *
 * Both paths share the identical paste+preflight Connect seam after this point (ADR 0020);
 * this chooser only routes the user to the right wizard copy — first-run Discover for a new
 * Den, or the returning new-or-returning + subscription flow for an existing one.
 */
function LandingChooser({ onNew, onConnect }: { onNew: () => void; onConnect: () => void }) {
  return (
    <div className="bg-background text-foreground grid h-screen place-items-center px-6">
      <div className="flex w-full max-w-lg flex-col gap-8">
        <header className="space-y-3 text-center">
          <div className="text-foreground mx-auto flex w-fit items-center gap-2 text-xl font-semibold tracking-tight">
            <span className="bg-dd-ember-500 text-dd-ink-990 grid size-8 place-items-center rounded-md text-base font-bold">
              d
            </span>
            dotden
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Manage your Den — your whole configuration — and keep it in sync across every computer
            you work on, through a private git repo you own.
          </p>
        </header>

        <div className="grid gap-3">
          {/* New Den — the first-environment onboarding (issue 1-06). */}
          <button
            type="button"
            className="border-border bg-card hover:border-dd-ember-500 flex items-start gap-3 rounded-lg border p-4 text-left transition-colors"
            onClick={onNew}
          >
            <Sparkles className="text-dd-ember-400 mt-0.5 size-5 shrink-0" />
            <span className="flex-1">
              <span className="text-foreground block font-medium">Set up a new Den</span>
              <span className="text-muted-foreground block text-xs">
                This is your first computer. Create a repo, Track your configs, and Sync them.
              </span>
            </span>
            <ArrowRight className="text-muted-foreground mt-1 size-4" />
          </button>

          {/* Existing Den — the second-environment returning flow (issue 1-13). */}
          <button
            type="button"
            className="border-border bg-card hover:border-dd-ember-500 flex items-start gap-3 rounded-lg border p-4 text-left transition-colors"
            onClick={onConnect}
          >
            <MonitorSmartphone className="text-dd-ember-400 mt-0.5 size-5 shrink-0" />
            <span className="flex-1">
              <span className="text-foreground block font-medium">Connect an existing Den</span>
              <span className="text-muted-foreground block text-xs">
                You already set up dotden elsewhere. Connect the same repo, pick your Workspaces,
                and Apply your Den here.
              </span>
            </span>
            <ArrowRight className="text-muted-foreground mt-1 size-4" />
          </button>
        </div>

        <Button variant="outline" className="mx-auto" onClick={onNew}>
          Not sure? Start a new Den <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
