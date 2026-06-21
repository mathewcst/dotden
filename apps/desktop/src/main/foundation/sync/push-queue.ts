/**
 * PushQueue — the durable offline outbox for queued pushes (issue 1-16, ADR 0006).
 *
 * dotden's offline contract: a **Commit** is a LOCAL operation (chezmoi re-add + `git
 * commit`) that always succeeds with no network; the **push** that would carry it to the
 * Remote is what needs connectivity. When a push can't go out because the machine is
 * offline, the change must NOT be lost or surfaced as a hard failure — it is **queued**
 * here and **retried** on reconnect or the next Sync (issue 1-16 acceptance).
 *
 * ## Why the outbox is a single boolean, not a per-commit list
 *
 * `git push` is **all-or-nothing on the branch**: it sends EVERY unpushed commit, not one
 * named commit. So "what is owed to the Remote" is not a queue of N push jobs — it is a
 * single fact: *"there are local commits the Remote hasn't seen."* Modeling it as one
 * durable `pending` flag gives the two properties the issue demands for free:
 * - **dedup** — committing offline ten times queues ONE pending push, and one successful
 *   flush clears it for all ten commits (no duplicate pushes);
 * - **never drop a Commit** — the flag persists to disk, so a queued push survives an app
 *   restart; the commits themselves already live safely in the local git repo, and the
 *   flag just remembers they still need to travel.
 *
 * ## Retry discipline (never fail silently, but never block forever)
 *
 * {@link flush} attempts the push and routes on the outcome:
 * - **success** → clear the flag (the commits are now on the Remote);
 * - **offline failure** → KEEP the flag and rethrow, so the caller can surface "still
 *   offline — queued" and the next reconnect/Sync retries the SAME pending push;
 * - **non-offline failure** (a server-reached rejection: non-fast-forward, auth, missing
 *   repo) → CLEAR the flag and rethrow. Retrying that blindly can never succeed, so it
 *   must not wedge the outbox; the error surfaces for the user to resolve.
 *
 * It is Electron-free (ADR 0023): it takes the outbox file path so the whole round-trip is
 * unit-testable in plain Node; `index.ts`/`DenService` pass a path under Electron `userData`
 * (environment-local, never synced — ADR 0024; the outbox is a property of THIS machine's
 * connectivity, not shared Den state).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isOfflineError } from './offline.js'

/** On-disk shape of the offline outbox (environment-local, never synced). */
interface PersistedOutbox {
  /** `true` when there are local Commits the Remote has not seen yet (a push is owed). */
  readonly pending: boolean
}

/** The push function {@link PushQueue.flush} drives — `git push` in production, a fake in tests. */
export type PushFn = () => Promise<void>

/**
 * A durable, deduplicated record of whether a push is owed to the Remote.
 *
 * One instance is bound to a single outbox file. Reads/writes are intentionally tiny JSON
 * round-trips (the state is one boolean), so there is no in-memory cache to drift from
 * disk — every {@link isPending}/{@link enqueue}/{@link flush} reflects the persisted truth,
 * which is what makes "survives restart" hold even within one process.
 */
export class PushQueue {
  /**
   * @param outboxPath Absolute path to the JSON outbox file (under Electron `userData` in
   *   production; a tempdir in tests). Its directory is created on demand.
   */
  constructor(private readonly outboxPath: string) {}

  /**
   * Whether a push is currently owed to the Remote (a queued, not-yet-sent push exists).
   *
   * A missing or corrupt outbox file reads as **not pending** — fail safe: a damaged
   * outbox must never invent a phantom push, only ever forget one (the commits are still
   * safe in git, and the next Commit/Sync re-queues a real push). Never throws.
   *
   * @returns `true` when there are unpushed local Commits waiting to be flushed.
   */
  async isPending(): Promise<boolean> {
    return (await this.read()).pending
  }

  /**
   * **Queue a push** — record that the Remote owes a push for the just-made Commit(s).
   *
   * Idempotent by construction (the state is a single flag): calling it after each offline
   * Commit collapses to one pending push, so a later {@link flush} sends every unpushed
   * commit in a single `git push` (dedup — never N duplicate pushes for N offline Commits).
   */
  async enqueue(): Promise<void> {
    await this.write({ pending: true })
  }

  /**
   * **Clear** the outbox — mark that no push is owed.
   *
   * Used by callers that pushed through a path OTHER than {@link flush} (e.g. a manual
   * `git push` that, being all-or-nothing, already carried every queued commit), so the
   * pending flag does not linger stale after the Remote is up to date. Idempotent.
   */
  async clear(): Promise<void> {
    await this.write({ pending: false })
  }

  /**
   * **Flush** the queued push by running `push`, then update the outbox on its outcome.
   *
   * No-op (returns `false`, never calls `push`) when nothing is queued, so a Sync with an
   * empty outbox never pushes spuriously. When a push IS queued:
   * - on success → clears the flag and returns `true`;
   * - on an **offline** failure → keeps the flag (retry next reconnect/Sync) and rethrows;
   * - on a **non-offline** failure → clears the flag (a blind retry can't fix it) and rethrows.
   *
   * The rethrow lets the caller surface the outcome (never fail silently); the flag update
   * is the durable retry decision.
   *
   * @param push The push to attempt (`GitTransport.push` in production; a fake in tests).
   * @returns `true` when a queued push was flushed successfully; `false` when nothing was queued.
   * @throws The push's own error (offline or otherwise), AFTER the outbox flag is updated.
   */
  async flush(push: PushFn): Promise<boolean> {
    if (!(await this.isPending())) return false
    try {
      await push()
    } catch (error) {
      // Offline → keep the push queued so the next reconnect/Sync retries it (do not lose
      // the change). Non-offline (server reached + rejected) → clear it, since retrying the
      // same push can never succeed and an un-clearable flag would block every future flush.
      if (!isOfflineError(error)) await this.write({ pending: false })
      throw error
    }
    await this.write({ pending: false })
    return true
  }

  /** Read the persisted outbox, defaulting to "not pending" on any read/parse failure. */
  private async read(): Promise<PersistedOutbox> {
    try {
      const parsed = JSON.parse(await readFile(this.outboxPath, 'utf8')) as Partial<PersistedOutbox>
      return { pending: parsed.pending === true }
    } catch {
      // Missing file, unreadable, or malformed JSON ⇒ nothing pending (fail safe).
      return { pending: false }
    }
  }

  /** Persist the outbox state, creating its directory on first write. */
  private async write(outbox: PersistedOutbox): Promise<void> {
    await mkdir(dirname(this.outboxPath), { recursive: true })
    await writeFile(this.outboxPath, `${JSON.stringify(outbox, null, 2)}\n`, 'utf8')
  }
}
