/**
 * `<DenSessionProvider>` — *mounts* the scoped den-session store for the `app` route (ADR 0034).
 *
 * The store-in-Context machinery — the `DenSessionContext` and the `useDenSession(selector)` reader
 * — lives in the `den-session` leaf (`@/den-session`) so any feature can read the store without
 * reaching up into `app/` (the one-way graph, ADR 0033). This provider is the one place in `app/`
 * that creates the store and hands it down; it stays in `app/providers/` because mounting is a
 * composition-root concern.
 *
 * The router mounts `<DenSessionProvider key={role}>` around the `app` route, so switching
 * environment A↔B remounts the provider → a brand-new, empty store (the reset guarantee, ADR 0027).
 * This replaces the old `<Workspace key={role}>` remount: the reset now lives at the store seam.
 */
import { useState, type ReactNode } from 'react'
import { createDenSessionStore, DenSessionContext, type Role } from '@/den-session'

export function DenSessionProvider({ role, children }: { role: Role; children: ReactNode }) {
  // Create the store exactly once for this mount (lazy initializer). `role` is captured here and is
  // stable per mounted instance because the provider is keyed by role — a role change is a remount,
  // which runs this initializer again for a clean store.
  const [store] = useState(() => createDenSessionStore(role))
  return <DenSessionContext value={store}>{children}</DenSessionContext>
}
