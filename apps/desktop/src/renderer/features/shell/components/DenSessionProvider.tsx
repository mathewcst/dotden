/**
 * `<DenSessionProvider>` + `useDenSession` — store-in-Context for the scoped den-session store
 * (tkdodo "Zustand and React Context"; ADR 0027, Phase 2).
 *
 * The provider creates ONE store per mount via the {@link createDenSessionStore} factory and hands
 * it down through Context; consumers read with the `useDenSession(selector)` hook. There is
 * deliberately NO module-global store instance — the factory-in-Context pattern is what gives each
 * environment its own React-lifecycled session.
 *
 * The router mounts `<DenSessionProvider key={role}>` around the `app` route, so switching
 * environment A↔B remounts the provider → a brand-new, empty store (the reset guarantee, ADR 0027).
 * This replaces the old `<Workspace key={role}>` remount: the reset now lives at the store seam.
 */
import { createContext, useContext, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import {
  createDenSessionStore,
  type DenSession,
  type DenSessionStore,
  type Role,
} from '../lib/den-session-store'

/** Holds the role-scoped store instance; null outside a provider (a developer error we throw on). */
const DenSessionContext = createContext<DenSessionStore | null>(null)

/**
 * Provide a fresh den-session store to the `app` route. Key this by role in the router so a role
 * change remounts it and wipes the session (no A/B state leak).
 */
export function DenSessionProvider({ role, children }: { role: Role; children: ReactNode }) {
  // Create the store exactly once for this mount (lazy initializer). `role` is captured here and is
  // stable per mounted instance because the provider is keyed by role — a role change is a remount,
  // which runs this initializer again for a clean store.
  const [store] = useState(() => createDenSessionStore(role))
  return <DenSessionContext value={store}>{children}</DenSessionContext>
}

/**
 * Read from the den-session store with a selector, bound to the Context's store instance.
 * Throws if used outside `<DenSessionProvider>` — never fail silently on a wiring mistake.
 */
export function useDenSession<T>(selector: (state: DenSession) => T): T {
  const store = useContext(DenSessionContext)
  if (!store) throw new Error('useDenSession must be used within a <DenSessionProvider>')
  return useStore(store, selector)
}
