/**
 * `den-session` store-in-Context — the React seam for the scoped session store (ADR 0034).
 *
 * `DenSessionContext` holds the role-scoped store instance that `<DenSessionProvider>`
 * (`app/providers/`) mounts; `useDenSession(selector)` reads from it. Both live in the den-session
 * *leaf* so any feature can import the reader without reaching up into `app/` (the one-way graph,
 * ADR 0033). There is deliberately NO module-global store — the factory-in-Context pattern gives
 * each environment its own React-lifecycled session (tkdodo "Zustand and React Context").
 */
import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { DenSession, DenSessionStore } from './store'

/** Holds the role-scoped store instance; null outside a provider (a developer error we throw on). */
export const DenSessionContext = createContext<DenSessionStore | null>(null)

/**
 * Read from the den-session store with a selector, bound to the Context's store instance.
 * Throws if used outside `<DenSessionProvider>` — never fail silently on a wiring mistake.
 */
export function useDenSession<T>(selector: (state: DenSession) => T): T {
  const store = useContext(DenSessionContext)
  if (!store) throw new Error('useDenSession must be used within a <DenSessionProvider>')
  return useStore(store, selector)
}
