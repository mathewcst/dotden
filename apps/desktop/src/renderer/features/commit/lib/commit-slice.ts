/**
 * The `commit` slice — the outbound half of the change lifecycle (ADR 0006), in the scoped
 * `den-session` store (ADR 0027, Phase 2).
 *
 * It owns the Commit flow and its outcomes: the "Last commit" callout (message + whether it
 * pushed), the honest "nothing to commit" notice, and the offline push-queue flag the Offline
 * banner reads. The flow itself — Track → scan-for-secrets → warn-or-Commit → record, plus the
 * "Sync now" push and the offline retry — are store actions ported 1:1 from the old `Workspace.tsx`
 * so the transitions are unit-testable in plain Node (the PRD's load-bearing slice for tests).
 *
 * Cross-slice reaches (all via `get()`, it is one store): the changed-File set + `run`/`reloadTree`
 * come from the session slice; opening the secret warn step calls the secrets slice; an auto-pushed
 * Commit refreshes the apply slice's incoming. The IPC surface is injected for node-testability.
 */
import type { DotdenApi } from '@shared/ipc-api'
import type { SecretFinding } from '@shared/secrets'
import type { DenSessionGet, DenSessionSet } from '../../shell/lib/den-session-store'
import { operationError } from '../../shell/lib/operation-error'
import { toast } from '../../../ui/toast-store'

/** The commit-result fields shared by a plain Commit and a Secret conversion's Commit. */
export interface CommitOutcome {
  readonly message: string
  readonly pushed: boolean
  readonly queued: boolean
}

/** The `commit` slice's state + actions (combined into {@link DenSession}). */
export interface CommitSlice {
  /**
   * An honest "nothing to commit" notice (not an error): the chosen Files already matched the
   * Den, so the Commit was a clean no-op. Neutral info, never the red error channel (ADR 0001).
   */
  commitNotice: string | null
  /** The last Commit's resolved message, for the inspector callout (null until one happens). */
  lastCommitMessage: string | null
  /** Whether the last Commit auto-pushed (Auto-sync) vs is local-until-Sync (Manual). */
  lastCommitPushed: boolean
  /**
   * Whether a push is currently QUEUED because this environment is offline (issue 1-16). The
   * main-process truth (`den.pushPending`), not a `navigator.onLine` guess; drives the banner.
   */
  pushQueued: boolean

  /** Reflect a Commit's result into the shared outcome fields (reused by Commit + convert). */
  setCommitOutcome(outcome: CommitOutcome): void
  /** The un-wrapped Commit body — records the Commit + reflects its result (no `run` span). */
  recordCommit(paths: readonly string[]): Promise<void>
  /** The Commit once any secret warn step has cleared (a single `run('commit')` span). */
  performCommit(paths: readonly string[]): Promise<void>
  /** Scan the about-to-be-Committed set FIRST; on findings open the warn step, else Commit. */
  commitWithScan(paths: readonly string[]): Promise<void>
  /** Commit past the warn step (issue 2-04), optionally allowlisting the findings first. */
  commitAnyway(
    findings: readonly SecretFinding[],
    paths: readonly string[],
    dontWarnAgain: boolean,
  ): Promise<void>
  /** Toolbar Commit: Commit every managed File with a pending local change (the changed set). */
  commitChanged(): void
  /** "Sync now" push half (env A): push pending Commits + fetch incoming (issue 1-12/16). */
  push(): void
  /** Re-read whether a push is queued offline (the authoritative durable-outbox state). */
  refreshPushQueued(): Promise<void>
  /** On reconnect: flush the offline push queue, then refresh the banner (issue 1-16). */
  flushQueuedPush(): Promise<void>
}

/** Build the `commit` slice, closing over the injected {@link DotdenApi}. */
export function createCommitSlice(api: DotdenApi) {
  return (set: DenSessionSet, get: DenSessionGet): CommitSlice => ({
    commitNotice: null,
    lastCommitMessage: null,
    lastCommitPushed: false,
    pushQueued: false,

    // Reflect WHERE the change actually is: Auto-sync auto-pushed it (pushed) vs Manual leaves it
    // local until Sync now; an offline Auto-sync push is queued. Deliberately does NOT touch
    // `commitNotice` — a Secret conversion reuses this and must not clear a standing notice.
    setCommitOutcome: (outcome) =>
      set({
        lastCommitMessage: outcome.message,
        lastCommitPushed: outcome.pushed,
        pushQueued: outcome.queued,
      }),

    // The ACTUAL Commit body. Extracted (un-wrapped by `run`) so the plain Commit path AND the
    // Commit-anyway-with-allowlist path both record the Commit identically, the latter sharing a
    // SINGLE `run` span with its allowlist writes.
    recordCommit: async (paths) => {
      if (paths.length === 0) return
      const result = await api.den.commit(paths)
      // A legitimate no-op: the chosen Files already match the Den (stale tree status). Say so
      // honestly and reload so the now-clean status disables Commit — never an error.
      if (result.noop) {
        set({
          commitNotice: 'Nothing to commit — your selected Files already match your Den.',
          lastCommitMessage: null,
        })
        await get().reloadTree()
        return
      }
      set({ commitNotice: null })
      set({ pushQueued: result.queued })
      get().setCommitOutcome({
        message: result.message,
        pushed: result.pushed,
        queued: result.queued,
      })
      toast.success(`Committed ${paths.length} file${paths.length === 1 ? '' : 's'}.`)
      await get().reloadTree()
      // An auto-pushed Commit also fetched incoming as part of the round-trip — refresh the
      // Remote axis + banner so they stay live without the user pressing Sync now.
      if (result.pushed) await get().refreshIncoming()
    },

    performCommit: (paths) => get().run('commit', () => get().recordCommit(paths)),

    // Commit-time secret scan + warn (issue 2-03): scan FIRST. On findings, open the amber warn
    // step instead of Committing — a caution, never a block (ADR 0001), so the user can still
    // proceed via "Commit anyway". On no findings, Commit immediately.
    commitWithScan: (paths) =>
      get().run('commit', async () => {
        if (paths.length === 0) return
        const findings = await api.den.scanCommit(paths)
        if (findings.length > 0) {
          // Stash the findings + the exact paths so "Commit anyway" can proceed with them.
          get().setSecretWarn({ findings, paths })
          return
        }
        await get().performCommit(paths)
      }),

    // Commit-anyway past the warn step (issue 2-04). When `dontWarnAgain` is set, allowlist the
    // shown findings FIRST so this File stops warning on future Commits — staged into the SAME
    // Commit so the decision travels with the next Sync. The allowlist write NEVER prevents the
    // Commit (warn-not-block, ADR 0001), which follows either way.
    commitAnyway: (findings, paths, dontWarnAgain) =>
      get().run('commit', async () => {
        if (dontWarnAgain) {
          for (const finding of findings) {
            await api.den.allowlistSecret(finding)
          }
        }
        await get().recordCommit(paths)
      }),

    commitChanged: () => {
      // Commit every managed File that has a pending local change (the modified/added set).
      const changed = get()
        .files.filter((f) => !f.muted && f.status !== null)
        .map((f) => f.targetPath)
      void get().commitWithScan(changed)
    },

    push: () =>
      void get().run('push', async () => {
        const result = await api.den.syncPush()
        // An offline Sync does NOT throw — the push is queued, so we show the offline banner.
        // A successful Sync clears it; the Commit(s) have now left this environment.
        set({ pushQueued: result.queued, lastCommitPushed: result.pushed })
        if (result.queued) toast.warning('Sync queued until you are back online.')
        else toast.success('Sync complete.')
        // A Sync also checks for incoming, so refresh the Remote axis + banner afterwards.
        await get().refreshIncoming()
      }),

    refreshPushQueued: async () => {
      try {
        set({ pushQueued: await api.den.pushPending() })
      } catch {
        // A failed read leaves the banner unchanged — better than flickering on a transient error.
      }
    },

    flushQueuedPush: async () => {
      try {
        await api.den.flushPushQueue()
      } catch (caught) {
        // A non-offline failure during flush (e.g. a server rejection) surfaces as an error; an
        // offline flush re-queues silently inside the main process (never throws here).
        set({
          error: operationError(caught, 'Could not retry the queued push.', () =>
            get().flushQueuedPush(),
          ),
        })
      } finally {
        await get().refreshPushQueued()
      }
    },
  })
}
