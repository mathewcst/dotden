/**
 * `launch` store — the app-scoped boot + routing store (ADR 0027; tkdodo "Zustand and React Context").
 *
 * Owns the one-time boot reads (launch gate ADR 0026 + synced theme issue 2-10) and the top-level
 * route machine between the landing chooser, onboarding, returning, Settings, and the den window.
 * It is a **vanilla** store created by {@link createLaunchStore} and handed down through React
 * Context by `<LaunchProvider>` — NEVER a module-global singleton (same posture as den-session).
 *
 * The {@link DotdenApi} and {@link applyTheme} are INJECTED into the factory so `boot()` is
 * node-testable with a fake API and a spy theme fn — no DOM required in tests.
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { ThemeId } from '@shared/appearance-settings'
import type { DotdenApi } from '@shared/ipc-api'
import { applyTheme } from '@/lib/apply-theme'

/** The top-level route between boot splash, setup flows, Settings, and the den window. */
export type LaunchRoute = 'booting' | 'landing' | 'onboarding' | 'returning' | 'app' | 'settings'

/** Which environment half the den window drives when `route === 'app'` (issue 1-04). */
export type LaunchRole = 'a' | 'b'

/** Full launch-store state: routing fields + boot/navigation actions. */
export interface LaunchState {
  route: LaunchRoute
  role: LaunchRole
  openReviewOnAppMount: boolean

  /** One-time boot: parallel launch gate + theme reads (ADR 0026 / issue 2-10). */
  boot: () => Promise<void>
  goToLanding: () => void
  goToOnboarding: () => void
  goToReturning: () => void
  goToApp: (opts: { role: LaunchRole; openReview: boolean }) => void
  goToSettings: () => void
  closeSettings: () => void
  clearOpenReviewOnAppMount: () => void
}

/** The vanilla store instance handed through Context to {@link useLaunch}. */
export type LaunchStore = StoreApi<LaunchState>

/**
 * Create a fresh launch store for one app mount.
 *
 * @param api          The IPC surface `boot()` calls. Defaults to `window.dotden` in the renderer.
 * @param applyThemeFn The renderer theme paint fn. Defaults to {@link applyTheme}; tests pass a spy.
 */
export function createLaunchStore(
  api: DotdenApi = window.dotden,
  applyThemeFn: (id: ThemeId) => void = applyTheme,
): LaunchStore {
  return createStore<LaunchState>()((set) => ({
    route: 'booting',
    role: 'a',
    openReviewOnAppMount: false,

    boot: async () => {
      const [launchResult, appearanceResult] = await Promise.allSettled([
        api.den.launchState(),
        api.den.appearanceSettings(),
      ])

      if (launchResult.status === 'fulfilled') {
        set({ route: launchResult.value.status === 'ready' ? 'app' : 'landing' })
      } else {
        console.error(
          '[dotden] Launch gate failed; falling back to the chooser:',
          launchResult.reason,
        )
        set({ route: 'landing' })
      }

      if (appearanceResult.status === 'fulfilled') {
        applyThemeFn(appearanceResult.value.theme)
      }
      // No Den / read failed — keep the default ember base (already applied via index.css).
    },

    goToLanding: () => set({ route: 'landing' }),
    goToOnboarding: () => set({ route: 'onboarding' }),
    goToReturning: () => set({ route: 'returning' }),
    goToApp: ({ role, openReview }) =>
      set({ route: 'app', role, openReviewOnAppMount: openReview }),
    goToSettings: () => set({ route: 'settings' }),
    closeSettings: () => set({ route: 'app' }),
    clearOpenReviewOnAppMount: () => set({ openReviewOnAppMount: false }),
  }))
}
