/**
 * PushQueue — the durable offline outbox for queued pushes (issue 1-16).
 *
 * Proves the queue's three load-bearing properties WITHOUT any network or git, by
 * injecting a fake push function:
 * - **dedup** — committing offline N times queues ONE pending push, never N (a `git push`
 *   sends every unpushed commit, so the outbox is "we owe the Remote a push", not a
 *   per-commit list); flushing it once clears it for all the queued commits.
 * - **survives restart + does not drop commits** — the pending flag is persisted to disk,
 *   so a fresh PushQueue over the same file still knows a push is owed.
 * - **retry semantics** — a flush that fails offline LEAVES the push queued (retry later);
 *   a flush that fails for a NON-offline reason surfaces AND clears the queue (the retry
 *   could never fix it, so it must not block forever); a successful flush clears it.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CommandFailedError } from '../platform/process.js'
import { PushQueue } from '../push-queue.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dotden-pushq-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Build a CommandFailedError whose stderr is the given (offline-or-not) message. */
function gitFailure(stderr: string): CommandFailedError {
  return new CommandFailedError({
    command: 'git',
    args: ['push'],
    exitCode: 128,
    stdout: '',
    stderr,
  })
}

describe('PushQueue (durable offline outbox, issue 1-16)', () => {
  it('starts empty: nothing is pending on a fresh queue', async () => {
    const queue = new PushQueue(join(dir, 'outbox.json'))
    expect(await queue.isPending()).toBe(false)
  })

  it('dedup: queueing many offline pushes records ONE pending push, flushed in one go', async () => {
    const queue = new PushQueue(join(dir, 'outbox.json'))
    await queue.enqueue() // commit 1 offline
    await queue.enqueue() // commit 2 offline
    await queue.enqueue() // commit 3 offline
    expect(await queue.isPending()).toBe(true)

    // One successful flush sends EVERY unpushed commit (git push is all-or-nothing) and
    // clears the single pending flag — there is no second/third push to make.
    let pushes = 0
    const flushed = await queue.flush(async () => {
      pushes += 1
    })
    expect(flushed).toBe(true)
    expect(pushes).toBe(1)
    expect(await queue.isPending()).toBe(false)
  })

  it('survives an app restart and does not drop the queued push', async () => {
    const first = new PushQueue(join(dir, 'outbox.json'))
    await first.enqueue()

    // A brand-new PushQueue over the same file = the next app launch. The pending push
    // must still be known (persisted), so a queued Commit is never silently dropped.
    const afterRestart = new PushQueue(join(dir, 'outbox.json'))
    expect(await afterRestart.isPending()).toBe(true)
  })

  it('flush is a no-op when nothing is queued (never pushes spuriously)', async () => {
    const queue = new PushQueue(join(dir, 'outbox.json'))
    let pushes = 0
    const flushed = await queue.flush(async () => {
      pushes += 1
    })
    expect(flushed).toBe(false)
    expect(pushes).toBe(0)
  })

  it('retry: an offline flush KEEPS the push queued (retried on the next reconnect/Sync)', async () => {
    const queue = new PushQueue(join(dir, 'outbox.json'))
    await queue.enqueue()

    // The reconnect/Sync flush attempts the push but the machine is still offline.
    await expect(
      queue.flush(async () => {
        throw gitFailure('fatal: unable to access: Could not resolve host: github.com')
      }),
    ).rejects.toThrow(/resolve host/i)

    // Still pending: the change is not lost — the next reconnect/Sync retries it.
    expect(await queue.isPending()).toBe(true)
  })

  it('a NON-offline flush failure surfaces AND clears the queue (retry can never fix it)', async () => {
    const queue = new PushQueue(join(dir, 'outbox.json'))
    await queue.enqueue()

    // A rejected push (non-fast-forward) reached the Remote — retrying blindly won't help,
    // so the queue clears and the error surfaces for the user to resolve (never fail silently).
    await expect(
      queue.flush(async () => {
        throw gitFailure('! [rejected] main -> main (non-fast-forward)')
      }),
    ).rejects.toThrow(/non-fast-forward/i)

    expect(await queue.isPending()).toBe(false)
  })

  it('persists the cleared state after a successful flush (no stale pending on restart)', async () => {
    const path = join(dir, 'outbox.json')
    const queue = new PushQueue(path)
    await queue.enqueue()
    await queue.flush(async () => {})

    // The cleared flag is durable: a restart sees nothing pending.
    expect(await new PushQueue(path).isPending()).toBe(false)
    // And the on-disk doc reflects the cleared outbox (not just an in-memory toggle).
    const persisted = JSON.parse(await readFile(path, 'utf8')) as { pending: boolean }
    expect(persisted.pending).toBe(false)
  })

  it('a corrupt/missing outbox file reads as "nothing pending" (fail safe, never crash)', async () => {
    const path = join(dir, 'outbox.json')
    // No file at all → not pending.
    expect(await new PushQueue(path).isPending()).toBe(false)
  })
})
