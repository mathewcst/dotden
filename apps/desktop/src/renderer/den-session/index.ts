/**
 * `@/den-session` — the scoped session-store leaf (ADR 0034). Features and `app/` import the store
 * factory, the `useDenSession` reader, and the shared den-session types/models from here; the
 * provider that *mounts* the store lives in `app/providers/`. The leaf imports only `lib/` + the
 * `@shared` IPC contract — never up into a feature or `app/`.
 */
export { createDenSessionStore } from './store'
export type { DenSession, DenSessionStore, DenSessionGet, DenSessionSet, Role } from './store'
export { DenSessionContext, useDenSession } from './context'
export type { RowVerb } from './row-verb'
export type { Busy, PendingConfirm, SessionSlice } from './slices/session-slice'
export type { CommitOutcome, CommitSlice } from './slices/commit-slice'
export type { SecretWarnState, SecretPickerState, SecretsSlice } from './slices/secrets-slice'
export type { ApplySlice } from './slices/apply-slice'
export * from './tree-node-model'
export * from './remote-axis'
