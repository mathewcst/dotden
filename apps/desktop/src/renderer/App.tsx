import { OnboardingShell } from '@/components/onboarding/OnboardingShell'
import { ReturningShell } from '@/components/returning/ReturningShell'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { Button } from '@/components/ui/button'
import { Workspace } from '@/components/Workspace'
import { applyTheme } from '@/lib/apply-theme'
import { ArrowRight, MonitorSmartphone, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * The top-level route: a brief boot splash, a landing chooser, the first-run onboarding, the
 * second-environment returning flow, the main three-pane app, or the Settings surface.
 *
 * `'booting'` is the initial route: the app shows a quiet splash while it asks the launch gate
 * (ADR 0026) whether this environment is already set up, so the chooser/onboarding never flashes
 * for a returning user.
 */
type Route = 'booting' | 'landing' | 'onboarding' | 'returning' | 'app' | 'settings'

/**
 * App — the top-level router between the landing chooser, the two setup flows, and the main
 * app shell (issues 1-06 + 1-13).
 *
 * On boot the app does NOT assume the landing chooser: it starts on a `'booting'` splash and
 * asks the launch gate (`den.launchState()`, ADR 0026) whether THIS environment is already set
 * up here. A `ready` environment routes straight to the app; everything else (`fresh` /
 * `incomplete`) falls to the chooser — so a set-up user never re-sees onboarding on every boot.
 *
 * The chooser itself is the first-run fork: **set up a new Den** (the first-environment
 * onboarding, issue 1-06) or **connect an existing Den** (the second-environment returning flow,
 * issue 1-13). Both finish by flipping the route to the main three-pane {@link Workspace}; the
 * returning flow opens it on the second-environment (Review & Apply) role so the user lands on
 * the reviewed Apply of the Den they just connected — the first materialization is deliberate,
 * never auto-applied (ADR 0008 / issue 1-13).
 *
 * The A/B role switch on the Workspace is the MVP single-window stand-in that lets one running
 * app drive both the first-environment (Track/Commit/Sync) and second-environment (detect/Apply)
 * halves of the end-to-end thread (issue 1-04).
 */
export function App() {
  const [route, setRoute] = useState<Route>('booting')
  const [role, setRole] = useState<'a' | 'b'>('a')

  // Launch gate (ADR 0026): ask the main process whether THIS environment is already set up,
  // then route — `ready` → straight to the app, everything else → the landing chooser. This runs
  // once on mount and replaces the old hardcoded `'landing'` start, so a set-up environment no
  // longer re-sees onboarding on every boot. A failed read falls back to `landing` (a usable
  // re-choice) rather than stranding the user on the splash — never fail silently, never dead-end.
  // App is the never-unmounting root, so no unmount guard is needed.
  useEffect(() => {
    window.dotden.den
      .launchState()
      .then(({ status }) => setRoute(status === 'ready' ? 'app' : 'landing'))
      .catch((error) => {
        console.error('[dotden] Launch gate failed; falling back to the chooser:', error)
        setRoute('landing')
      })
  }, [])

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

  if (route === 'booting') {
    return <BootingSplash />
  }

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
      {/* Key by role so switching environments remounts the Workspace and resets all
          of its state (the React `key` reset pattern), keeping the A/B thread clean. */}
      <Workspace key={role} role={role} onOpenSettings={() => setRoute('settings')} />
    </div>
  )
}

/**
 * BootingSplash — the quiet first frame shown while the launch gate (ADR 0026) resolves.
 *
 * It exists only so a returning, set-up environment never flashes the landing chooser before
 * `den.launchState()` answers. Deliberately minimal (just the brand mark on the app background):
 * the gate is a couple of cheap local reads, so this is on screen for a blink, not a load screen.
 */
function BootingSplash() {
  return (
    <div className="bg-background text-foreground grid h-screen place-items-center">
      <span
        className="bg-dd-ember-500 text-dd-ink-990 grid size-10 place-items-center rounded-md text-lg font-bold motion-safe:animate-pulse"
        aria-label="Loading dotden"
      >
        d
      </span>
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
