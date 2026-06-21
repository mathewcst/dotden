/**
 * TrayPoller — the always-on detect+notify watcher (issue 1-12).
 *
 * Driven entirely by injected seams (a fake SHA reader, a recording notifier, and a fake
 * scheduler that lets the test "advance the clock" by running the pending tick), so the
 * whole poll loop is deterministic in plain Node — no Electron, no real network, no real
 * timers. The tests pin the acceptance criteria:
 *
 *   - notifies ONLY when the advertised SHA moved, and fetches (here: the notify side
 *     effect) only then — a quiet Remote raises nothing;
 *   - detect-only — the poller has no Apply/Commit surface to exercise;
 *   - works independently of Auto-sync (it is constructed with no automation level at all);
 *   - cadence backs off when idle and snaps to the floor when the window is focused.
 */
import { describe, expect, it } from 'vitest'
import {
  TrayPoller,
  type IncomingDetected,
  type PollCadence,
  type PollHandle,
  type PollScheduler,
} from '../tray-poller.js'

/**
 * A controllable scheduler: instead of real time, it records the single pending callback
 * and its delay, and `runPending()` fires it. That makes "wait one interval" a synchronous
 * test step and exposes the delay the poller chose (the cadence under test).
 */
class FakeScheduler implements PollScheduler {
  /** The currently-armed callback, or null when none is pending. */
  pending: (() => void) | null = null
  /** The delay the poller requested for the pending callback (the cadence under test). */
  lastDelayMs = 0
  /** Every delay the poller has ever requested, in order (to assert backoff growth). */
  readonly delays: number[] = []

  schedule(fn: () => void, delayMs: number): PollHandle {
    this.pending = fn
    this.lastDelayMs = delayMs
    this.delays.push(delayMs)
    return { id: this.delays.length }
  }

  clear(): void {
    this.pending = null
  }

  /** Fire the pending callback (advance to the next tick) and await its async work. */
  async runPending(): Promise<void> {
    const fn = this.pending
    if (!fn) throw new Error('no pending tick to run')
    fn()
    // The poller's tick is async (an awaited ls-remote read); let microtasks settle so
    // the notify + re-arm have happened before the test inspects state.
    await Promise.resolve()
    await Promise.resolve()
  }
}

/** A SHA reader returning a scripted sequence of advertised SHAs (one per tick). */
function shaSequence(seq: readonly (string | null)[]): () => Promise<string | null> {
  let i = 0
  return () => Promise.resolve(seq[Math.min(i++, seq.length - 1)] ?? null)
}

/** A notifier that records every incoming detection it was told about. */
function recordingNotifier(): {
  notifyIncoming: (info: IncomingDetected) => void
  readonly calls: IncomingDetected[]
} {
  const calls: IncomingDetected[] = []
  return { notifyIncoming: (info) => calls.push(info), calls }
}

const CADENCE: PollCadence = { minIntervalMs: 30_000, maxIntervalMs: 240_000, backoffFactor: 2 }

describe('TrayPoller detect + notify (issue 1-12)', () => {
  it('notifies when the advertised SHA moves past the known SHA', async () => {
    const scheduler = new FakeScheduler()
    const notifier = recordingNotifier()
    const poller = new TrayPoller({
      readLatestSha: shaSequence(['aaa', 'bbb']),
      notifier,
      scheduler,
      cadence: CADENCE,
      // Already seen 'aaa' (e.g. local HEAD) — so the first tick is "nothing new".
      knownSha: 'aaa',
    })
    poller.start()

    await scheduler.runPending() // reads 'aaa' == known → no notify
    expect(notifier.calls).toHaveLength(0)

    await scheduler.runPending() // reads 'bbb' != 'aaa' → incoming!
    expect(notifier.calls).toHaveLength(1)
    expect(notifier.calls[0]).toEqual({ latestSha: 'bbb', previousSha: 'aaa' })
    expect(poller.lastSha).toBe('bbb')
  })

  it('raises nothing while the Remote is quiet (no Provider API, fetch only on move)', async () => {
    const scheduler = new FakeScheduler()
    const notifier = recordingNotifier()
    const poller = new TrayPoller({
      readLatestSha: shaSequence(['same', 'same', 'same']),
      notifier,
      scheduler,
      cadence: CADENCE,
      knownSha: 'same',
    })
    poller.start()
    await scheduler.runPending()
    await scheduler.runPending()
    await scheduler.runPending()
    expect(notifier.calls).toHaveLength(0)
  })

  it('backs off the interval while idle and re-snaps to the floor on activity', async () => {
    const scheduler = new FakeScheduler()
    const poller = new TrayPoller({
      readLatestSha: shaSequence(['x', 'x', 'y']),
      notifier: recordingNotifier(),
      scheduler,
      cadence: CADENCE,
      knownSha: 'x',
    })
    poller.start()
    // First arm is at the idle ceiling (background launch is cheap).
    expect(scheduler.lastDelayMs).toBe(CADENCE.maxIntervalMs)

    // Focus → blur so the interval is at the FLOOR, making the idle backoff observable.
    poller.setWindowFocused(true)
    expect(scheduler.lastDelayMs).toBe(CADENCE.minIntervalMs)
    poller.setWindowFocused(false)

    await scheduler.runPending() // reads index 0 'x' == known → quiet → backs off ×2 from the floor
    expect(scheduler.lastDelayMs).toBe(CADENCE.minIntervalMs * CADENCE.backoffFactor)
    await scheduler.runPending() // index 1 'x' → quiet → backs off again (×2)
    expect(scheduler.lastDelayMs).toBe(CADENCE.minIntervalMs * CADENCE.backoffFactor ** 2)

    await scheduler.runPending() // index 2 'y' → activity snaps the interval back to the floor
    expect(scheduler.lastDelayMs).toBe(CADENCE.minIntervalMs)
  })

  it('speeds up to the floor cadence when the window gains focus', async () => {
    const scheduler = new FakeScheduler()
    const poller = new TrayPoller({
      readLatestSha: shaSequence(['z', 'z']),
      notifier: recordingNotifier(),
      scheduler,
      cadence: CADENCE,
      knownSha: 'z',
    })
    poller.start()
    expect(scheduler.lastDelayMs).toBe(CADENCE.maxIntervalMs) // idle ceiling at launch

    poller.setWindowFocused(true) // user is working → re-arm at the fast floor
    expect(scheduler.lastDelayMs).toBe(CADENCE.minIntervalMs)

    // While focused, a quiet tick HOLDS the floor (never backs off) so changes are prompt.
    await scheduler.runPending()
    expect(scheduler.lastDelayMs).toBe(CADENCE.minIntervalMs)
  })

  it('keeps polling after a read error instead of crashing the watcher', async () => {
    const scheduler = new FakeScheduler()
    const notifier = recordingNotifier()
    const errors: unknown[] = []
    let call = 0
    const poller = new TrayPoller({
      readLatestSha: () => {
        call += 1
        if (call === 1) return Promise.reject(new Error('offline'))
        return Promise.resolve('moved')
      },
      notifier,
      scheduler,
      cadence: CADENCE,
      knownSha: 'orig',
      onError: (e) => errors.push(e),
    })
    poller.start()

    await scheduler.runPending() // read throws → surfaced, NOT fatal, loop re-arms
    expect(errors).toHaveLength(1)
    expect(scheduler.pending).not.toBeNull() // next tick still armed

    await scheduler.runPending() // recovers, sees 'moved' → notifies
    expect(notifier.calls).toHaveLength(1)
    expect(notifier.calls[0]?.latestSha).toBe('moved')
  })

  it('stop() disarms the loop so no further tick runs', async () => {
    const scheduler = new FakeScheduler()
    const poller = new TrayPoller({
      readLatestSha: shaSequence(['a', 'b']),
      notifier: recordingNotifier(),
      scheduler,
      cadence: CADENCE,
      knownSha: 'a',
    })
    poller.start()
    poller.stop()
    expect(scheduler.pending).toBeNull()
  })

  it('onReconnect forces an immediate fresh tick (powerMonitor resume)', async () => {
    const scheduler = new FakeScheduler()
    const notifier = recordingNotifier()
    const poller = new TrayPoller({
      readLatestSha: shaSequence(['old', 'new']),
      notifier,
      scheduler,
      cadence: CADENCE,
      knownSha: 'old',
    })
    poller.start()
    await scheduler.runPending() // 'old' == known → quiet

    // Machine wakes / network reconnects: poll right now rather than waiting out the timer.
    poller.onReconnect()
    await Promise.resolve()
    await Promise.resolve()
    expect(notifier.calls).toHaveLength(1)
    expect(notifier.calls[0]?.latestSha).toBe('new')
  })
})
