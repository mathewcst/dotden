/**
 * `den-session` store — the scoped, per-environment session store (ADR 0027, Phase 2).
 *
 * One Zustand store composed from four per-feature slices (tkdodo "Working with Zustand"):
 * - {@link createSessionSlice} (shell) — the tree, selection, diff, busy/error, lifecycle verbs.
 * - {@link createCommitSlice} (commit) — the Commit flow + outcomes + offline queue.
 * - {@link createSecretsSlice} (secrets) — the commit-time warn + convert flow.
 * - {@link createApplySlice} (apply) — incoming, the Remote axis, the review/resolve surfaces.
 *
 * It is a **vanilla** store created by {@link createDenSessionStore} and handed down through React
 * Context by `<DenSessionProvider>` — NEVER a module-global singleton. Keying the provider by role
 * means switching environment A↔B remounts it → a fresh, empty session, so A's pending changes can
 * never leak into B (the reset guarantee — there is deliberately no `reset()` action to forget a
 * field in; ADR 0027). Because slices are one combined store, a slice reaches any other through
 * `get()` (e.g. a row-verb Commit calls `get().commitWithScan`); cross-slice reads like "every
 * slice needs `selected`" are trivial.
 *
 * The {@link DotdenApi} is INJECTED into the factory (defaulting to `window.dotden`) so the slices
 * are pure, node-testable decisions — the slice tests build a store with a fake API, no DOM.
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { DotdenApi } from '@shared/ipc-api'
// The slices live beside this store in `den-session/slices/` (ADR 0034) — one shared-state leaf,
// no longer scattered across feature folders. Imports stay relative within the den-session leaf so
// the node-env slice tests run without renderer alias wiring (see docs/conventions.md).
import { createSessionSlice, type Role, type SessionSlice } from './slices/session-slice'
import { createCommitSlice, type CommitSlice } from './slices/commit-slice'
import { createSecretsSlice, type SecretsSlice } from './slices/secrets-slice'
import { createApplySlice, type ApplySlice } from './slices/apply-slice'

export type { Role } from './slices/session-slice'

/** The full den-session state: the intersection of every feature slice. */
export type DenSession = SessionSlice & CommitSlice & SecretsSlice & ApplySlice

/** The vanilla store instance handed through Context to {@link useDenSession}. */
export type DenSessionStore = StoreApi<DenSession>

/** The `set` handed to each slice creator (typed over the whole {@link DenSession}). */
export type DenSessionSet = StoreApi<DenSession>['setState']
/** The `get` handed to each slice creator — reaches every slice's state + actions. */
export type DenSessionGet = StoreApi<DenSession>['getState']

/**
 * Create a fresh den-session store for one environment role.
 *
 * @param role  Which environment this session drives (A vs B). Fixed for the store's life — the
 *   provider is keyed by role, so a role change remounts and calls this again for a clean session.
 * @param api   The IPC surface the slices call. Defaults to `window.dotden` in the renderer; the
 *   slice tests pass a fake so the actions run in Node with no DOM.
 */
export function createDenSessionStore(role: Role, api: DotdenApi = window.dotden): DenSessionStore {
  return createStore<DenSession>()((set, get) => ({
    ...createSessionSlice(role, api)(set, get),
    ...createCommitSlice(api)(set, get),
    ...createSecretsSlice(api)(set, get),
    ...createApplySlice(api)(set, get),
  }))
}
