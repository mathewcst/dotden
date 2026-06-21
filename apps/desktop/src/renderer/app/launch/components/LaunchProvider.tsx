/**
 * `<LaunchProvider>` + `useLaunch` — store-in-Context for the app-scoped launch store
 * (tkdodo "Zustand and React Context"; ADR 0027).
 *
 * The provider creates ONE store per app mount via the {@link createLaunchStore} factory and hands
 * it down through Context; consumers read with the `useLaunch(selector)` hook. There is
 * deliberately NO module-global store instance — the factory-in-Context pattern keeps boot state
 * on a real React lifecycle and makes tests render an isolated store per tree.
 *
 * `App.tsx` mounts this at the root; {@link LaunchRouter} consumes it for routing. The den-session
 * store remains a separate, role-keyed provider on the `app` route only.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { createLaunchStore, type LaunchState, type LaunchStore } from '../lib/launch-store'
import { preloadLaunchChunks } from '../lib/preload-chunks'

/** Holds the app-scoped store instance; null outside a provider (a developer error we throw on). */
const LaunchContext = createContext<LaunchStore | null>(null)

/**
 * Provide a fresh launch store for the app root. Runs {@link LaunchState.boot} once on mount — the
 * sole mount effect for app-level boot (launch gate + theme).
 */
export function LaunchProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createLaunchStore())
  useEffect(() => {
    // Boot first (launch gate + theme), then warm the cold chunks on idle so their Suspense
    // fallbacks never show on first navigation (no-op flashes on a local-disk Electron bundle).
    void store.getState().boot().finally(preloadLaunchChunks)
  }, [store])
  return <LaunchContext value={store}>{children}</LaunchContext>
}

/**
 * Read from the launch store with a selector, bound to the Context's store instance.
 * Throws if used outside `<LaunchProvider>` — never fail silently on a wiring mistake.
 */
export function useLaunch<T>(selector: (state: LaunchState) => T): T {
  const store = useContext(LaunchContext)
  if (!store) throw new Error('useLaunch must be used within a <LaunchProvider>')
  return useStore(store, selector)
}
