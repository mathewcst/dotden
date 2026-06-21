import { lazy, Suspense } from 'react'
import { useLaunch } from '@/features/launch/components/LaunchProvider'
import { LandingChooser } from '@/features/launch/components/LandingChooser'
import { DenSessionProvider } from '@/features/shell/components/DenSessionProvider'
// DenWindow is EAGER, not lazy: it is the hot path — a set-up environment boots straight to the
// `app` route (the launch gate returns `ready`), so lazy-splitting it would put a Suspense fallback
// flash on the single most common launch (splash → splash → app). The cold setup/settings shells
// below stay split — a set-up user never loads them — and are warmed on idle by
// `preloadLaunchChunks` so their fallbacks never actually show either.
import { DenWindow } from '@/features/shell/components/DenWindow'

const OnboardingShell = lazy(() =>
  import('@/features/onboarding/components/OnboardingShell').then((module) => ({
    default: module.OnboardingShell,
  })),
)
const ReturningShell = lazy(() =>
  import('@/features/returning/components/ReturningShell').then((module) => ({
    default: module.ReturningShell,
  })),
)
const SettingsShell = lazy(() =>
  import('@/features/settings/components/SettingsShell').then((module) => ({
    default: module.SettingsShell,
  })),
)

/**
 * LaunchRouter — the top-level router between the landing chooser, the two setup flows, and the main
 * app shell (issues 1-06 + 1-13; ADR 0026/0027). Consumes the app-scoped launch store for routing;
 * the `app` route is wrapped in `<DenSessionProvider key={role}>`, which replaces the old
 * `<Workspace key={role}>` remount — the session reset now happens at the store seam.
 *
 * On boot the app does NOT assume the landing chooser: it starts on a `'booting'` splash while
 * {@link LaunchProvider} runs the launch gate (`den.launchState()`, ADR 0026). A `ready` environment
 * routes straight to the app; everything else (`fresh` / `incomplete`) falls to the chooser — so a
 * set-up user never re-sees onboarding on every boot.
 *
 * The chooser itself is the first-run fork: **set up a new Den** (the first-environment onboarding,
 * issue 1-06) or **connect an existing Den** (the second-environment returning flow, issue 1-13).
 * Both finish by flipping to the main three-pane {@link DenWindow}; the returning flow opens it on
 * the second-environment (Review & Apply) role so the user lands on the reviewed Apply of the Den
 * they just connected — the first materialization is deliberate, never auto-applied (ADR 0008 /
 * issue 1-13).
 *
 * The A/B role switch on the den window is the MVP single-window stand-in that lets one running app
 * drive both the first-environment (Track/Commit/Sync) and second-environment (detect/Apply) halves
 * of the end-to-end thread (issue 1-04).
 */
export function LaunchRouter() {
  const route = useLaunch((s) => s.route)
  const role = useLaunch((s) => s.role)
  const openReviewOnAppMount = useLaunch((s) => s.openReviewOnAppMount)
  const goToOnboarding = useLaunch((s) => s.goToOnboarding)
  const goToReturning = useLaunch((s) => s.goToReturning)
  const goToApp = useLaunch((s) => s.goToApp)
  const goToSettings = useLaunch((s) => s.goToSettings)
  const closeSettings = useLaunch((s) => s.closeSettings)
  const clearOpenReviewOnAppMount = useLaunch((s) => s.clearOpenReviewOnAppMount)

  if (route === 'booting') {
    return <BootingSplash />
  }

  if (route === 'landing') {
    return <LandingChooser onNew={() => goToOnboarding()} onConnect={() => goToReturning()} />
  }

  if (route === 'onboarding') {
    return (
      <Suspense fallback={<BootingSplash />}>
        <OnboardingShell
          onComplete={() => goToApp({ role: 'a', openReview: false })}
          onExistingDen={() => goToReturning()}
        />
      </Suspense>
    )
  }

  if (route === 'returning') {
    return (
      <Suspense fallback={<BootingSplash />}>
        <ReturningShell
          onComplete={() => {
            // Open the app on the second-environment (Review & Apply) role: the returning user lands
            // on the reviewed Apply of the Den they just connected (issue 1-13).
            goToApp({ role: 'b', openReview: true })
          }}
          onNewDen={() => goToOnboarding()}
        />
      </Suspense>
    )
  }

  if (route === 'settings') {
    // The Settings surface (issue 2-08) is a full-window route shown OVER the den window, mirroring
    // how onboarding/returning are full-window routes; closing returns to the app on the same role.
    return (
      <Suspense fallback={<BootingSplash />}>
        <SettingsShell onClose={() => closeSettings()} />
      </Suspense>
    )
  }

  return (
    // Key the PROVIDER by role so switching environments remounts the store and resets the whole
    // session (the reset guarantee, ADR 0027), keeping the A/B thread clean.
    <DenSessionProvider key={role} role={role}>
      <div className="relative">
        <DenWindow
          openReviewOnMount={openReviewOnAppMount}
          onReviewOpened={() => clearOpenReviewOnAppMount()}
          onOpenSettings={() => goToSettings()}
        />
      </div>
    </DenSessionProvider>
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
