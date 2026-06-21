/**
 * `preloadLaunchChunks` — warm the renderer's lazy chunks on idle, right after boot.
 *
 * The cold-path screens (the setup flows, Settings + its tabs, the full-window Apply views, file
 * history) are code-split with `React.lazy` so a set-up user never parses code they will not open.
 * In a packaged Electron app the bundle is read from LOCAL DISK, not the network — so the only thing
 * `lazy` actually buys us here is keeping that cold code out of the boot-path parse. Its cost, a
 * `Suspense` fallback flash the first time the user navigates, is pure downside on desktop.
 *
 * This helper pays that cost down: after boot it fires the same dynamic `import()`s in the
 * background, so by the time the user opens Settings or starts a Review the chunk is already resolved
 * in the module cache and `Suspense` unwraps it in the same render — no fallback ever shows. The
 * module registry dedupes by resolved file, so warming here and the `lazy(() => import(...))` sites
 * elsewhere share one chunk and one cache entry; the specifier strings just have to resolve to the
 * same module (they do — same `@/` alias).
 *
 * Best-effort by design: failures are swallowed (the real navigation will surface any genuine load
 * error through its own `Suspense`/error path — we never want a background warm-up to be the thing
 * that throws). DenWindow is deliberately absent: it is eager (the hot path), so there is nothing to
 * warm.
 */

/**
 * The cold chunks to warm, in rough order of how soon a user is likely to hit them. Each is a thunk
 * so nothing is fetched until we actually schedule it. Specifiers mirror the `lazy()` sites exactly.
 */
const COLD_CHUNKS: ReadonlyArray<() => Promise<unknown>> = [
  // Top-level routes reachable from the landing chooser / title bar.
  () => import('@/features/onboarding/components/OnboardingShell'),
  () => import('@/features/returning/components/ReturningShell'),
  () => import('@/features/settings/components/SettingsShell'),
  // Full-window views swapped in from inside the den window on a user verb.
  () => import('@/features/apply/components/ReviewApply'),
  () => import('@/features/apply/components/ConflictResolver'),
  () => import('@/features/file-history/components/FileHistory'),
  // Settings tabs — each its own chunk, loaded when its tab is selected.
  () => import('@/features/settings/components/SyncTab'),
  () => import('@/features/settings/components/CommitTab'),
  () => import('@/features/settings/components/AppearanceTab'),
  () => import('@/features/settings/components/AutomationTab'),
  () => import('@/features/settings/components/AccountTab'),
  () => import('@/features/settings/components/PrivacyTab'),
  () => import('@/features/settings/components/EnvironmentsTab'),
  () => import('@/features/settings/components/AboutTab'),
]

/** Run a callback when the main thread is idle, falling back to a macrotask where unsupported. */
function onIdle(run: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
  if (ric) ric(run)
  else setTimeout(run, 0)
}

/**
 * Kick off the background warm-up. Idempotent and cheap to call once boot has resolved a route.
 * Scheduled on idle so it never competes with the first paint of whatever screen boot lands on.
 */
export function preloadLaunchChunks(): void {
  onIdle(() => {
    for (const load of COLD_CHUNKS) {
      // Swallow: a warm-up failure must never surface here — the real navigation owns error display.
      void load().catch(() => {})
    }
  })
}
