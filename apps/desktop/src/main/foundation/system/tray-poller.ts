/**
 * TrayPoller — the always-on background watcher that detects + notifies when another
 * environment changed Files (issue 1-12).
 *
 * This is the watcher that keeps an eye on the Remote **even when the window is closed**,
 * so the user learns about incoming changes without opening dotden. Its discipline is
 * narrow on purpose:
 *
 * - **Detect + notify ONLY.** It never Commits, never Applies, never auto-resolves
 *   anything. When it sees the Remote moved, it fires an OS notification (and lets the
 *   app fetch); landing the change is still the user's reviewed Apply (ADR 0006/0008).
 *   It is therefore **independent of Auto-sync** — even a `manual` environment polls,
 *   because notify-on-incoming is not automation, it is awareness.
 * - **Cheap by construction.** Each tick is a single `git ls-remote` advertised-SHA read
 *   (the `latestRemoteSha` primitive, issue 1-03) — a provider-agnostic git command, no
 *   Provider API, no clone, no rate-limit cost. It **fetches only when the SHA moved**,
 *   so a quiet Remote costs one tiny network round-trip per tick and nothing else.
 * - **Adaptive cadence.** The interval **backs off when idle** (nothing changed for a
 *   while) and **speeds up when the window is focused** (the user is actively working, so
 *   freshness matters), so it never costs battery while idle yet feels live when in use.
 *
 * It is Electron-free (ADR 0023): the real `git ls-remote`, the OS `Notification`, the
 * `setTimeout` scheduler, and `powerMonitor` reconnect are all **injected seams**, so the
 * whole poll loop — including the SHA-moved decision and the backoff math — is driven by
 * fakes in fast, deterministic unit tests. `index.ts` wires the real Electron pieces in.
 */

/** Reads the Remote's latest advertised commit SHA without fetching (issue 1-03). */
export type LatestShaReader = (signal?: AbortSignal) => Promise<string | null>

/** Fires the side effects when the poller detects another environment changed the Remote. */
export interface IncomingNotifier {
  /**
   * Notify the user that incoming changes are waiting (an OS notification when the window
   * is closed; the app may also refresh its in-window banner). Detect-only: this never
   * applies anything.
   *
   * @param info What moved — the new SHA and the previously-seen one (for copy/diffing).
   */
  notifyIncoming(info: IncomingDetected): void
}

/** What the poller observed when the Remote's latest SHA moved. */
export interface IncomingDetected {
  /** The new latest SHA now advertised by the Remote branch. */
  readonly latestSha: string
  /** The SHA the poller had previously recorded (null on the very first observed move). */
  readonly previousSha: string | null
}

/** The scheduler seam: a one-shot timer (real `setTimeout` in production; a fake in tests). */
export interface PollScheduler {
  /** Schedule `fn` to run after `delayMs`; returns a handle {@link clear} can cancel. */
  schedule(fn: () => void, delayMs: number): PollHandle
  /** Cancel a scheduled run. */
  clear(handle: PollHandle): void
}

/** Opaque handle to a scheduled poll (a `NodeJS.Timeout` in production). */
export type PollHandle = unknown

/**
 * Cadence configuration — the adaptive interval bounds (issue 1-12 acceptance).
 *
 * The interval lives between {@link minIntervalMs} (used while the window is focused —
 * fast) and {@link maxIntervalMs} (the idle ceiling — slow). After each quiet tick the
 * interval multiplies by {@link backoffFactor} up to the ceiling; activity (the SHA
 * moved, or the window gains focus) snaps it back to the floor.
 */
export interface PollCadence {
  /** Floor interval, used while the window is focused (the fastest cadence). */
  readonly minIntervalMs: number
  /** Ceiling interval, the slowest cadence reached after backing off while idle. */
  readonly maxIntervalMs: number
  /** Multiplier applied to the interval after each quiet (no-change) tick. */
  readonly backoffFactor: number
}

/** dotden's default cadence: 30s focused floor, 5min idle ceiling, doubling backoff. */
export const DEFAULT_POLL_CADENCE: PollCadence = {
  minIntervalMs: 30_000,
  maxIntervalMs: 300_000,
  backoffFactor: 2,
}

/** Construction wiring for a {@link TrayPoller} (every Electron/IO piece is a seam). */
export interface TrayPollerOptions {
  /** Reads the Remote's latest advertised SHA each tick (`git ls-remote`, issue 1-03). */
  readonly readLatestSha: LatestShaReader
  /** Fires the OS notification + lets the app refresh when the SHA moved. */
  readonly notifier: IncomingNotifier
  /** Timer seam (`setTimeout`/`clearTimeout` in production; fake clock in tests). */
  readonly scheduler: PollScheduler
  /** Adaptive cadence bounds; defaults to {@link DEFAULT_POLL_CADENCE}. */
  readonly cadence?: PollCadence
  /**
   * The SHA this environment has already seen (e.g. its local `HEAD` after the last
   * Sync), so the FIRST observed Remote SHA equal to it is correctly treated as
   * "nothing new" rather than a spurious first-tick notification. Omitted ⇒ null (the
   * first non-null Remote SHA counts as incoming, which is correct for a fresh clone).
   */
  readonly knownSha?: string | null
  /**
   * Optional hook to surface a poll error WITHOUT killing the loop (never fail silently):
   * a transient `git ls-remote` failure (offline, flaky network) is logged/surfaced and
   * the loop keeps going on the next tick. Omitted ⇒ errors are swallowed silently AND
   * the loop still continues (the poller must never crash the app from the background).
   */
  readonly onError?: (error: unknown) => void
}

/**
 * The always-on Remote watcher. Detect + notify only; independent of Auto-sync.
 *
 * Lifecycle: {@link start} arms the first tick, {@link stop} cancels any pending tick,
 * {@link setWindowFocused} re-paces the cadence (focus = fast), and {@link onReconnect}
 * forces an immediate fresh tick after the machine wakes/reconnects (wired to Electron's
 * `powerMonitor` in production). All scheduling goes through the injected
 * {@link PollScheduler}, so tests advance a fake clock deterministically.
 */
export class TrayPoller {
  private readonly readLatestSha: LatestShaReader
  private readonly notifier: IncomingNotifier
  private readonly scheduler: PollScheduler
  private readonly cadence: PollCadence
  private readonly onError?: (error: unknown) => void

  /** The last SHA the poller has accounted for; a move past it is "incoming". */
  private lastSeenSha: string | null
  /** The current adaptive interval (between cadence.min and cadence.max). */
  private currentIntervalMs: number
  /** Whether the app window is focused (focused ⇒ poll at the floor cadence). */
  private windowFocused = false
  /** The pending scheduled tick, or null when stopped. */
  private handle: PollHandle | null = null
  /** Guard so an in-flight tick is never run concurrently with itself. */
  private ticking = false

  /**
   * @param options Injected SHA reader + notifier + scheduler + cadence (see {@link TrayPollerOptions}).
   */
  constructor(options: TrayPollerOptions) {
    this.readLatestSha = options.readLatestSha
    this.notifier = options.notifier
    this.scheduler = options.scheduler
    this.cadence = options.cadence ?? DEFAULT_POLL_CADENCE
    this.onError = options.onError
    this.lastSeenSha = options.knownSha ?? null
    // Start at the idle ceiling when the window is not yet known to be focused; focusing
    // the window snaps it down to the floor. This keeps a background launch cheap.
    this.currentIntervalMs = this.cadence.maxIntervalMs
  }

  /**
   * Arm the watcher: schedule the first tick at the current cadence.
   *
   * Idempotent — calling `start` while already running does not stack timers (it clears
   * any pending tick first), so re-arming after a focus/reconnect event is safe.
   */
  start(): void {
    this.armNextTick()
  }

  /**
   * Disarm the watcher: cancel any pending tick so nothing more runs until {@link start}.
   *
   * Used when the app quits (or a future "pause syncing" control). An in-flight tick is
   * not aborted mid-`ls-remote` — its timeout is the guarantee against a hung read — but
   * no FURTHER tick is scheduled once stopped.
   */
  stop(): void {
    if (this.handle !== null) {
      this.scheduler.clear(this.handle)
      this.handle = null
    }
  }

  /**
   * Tell the poller whether the app window is focused, re-pacing the cadence.
   *
   * Focusing the window snaps the interval to the floor (the user is working, so
   * freshness matters) and re-arms immediately at the faster cadence; blurring lets the
   * idle backoff resume from the floor. This is the "speeds up when the window is
   * focused" half of the adaptive cadence.
   *
   * @param focused Whether the app window currently has focus.
   */
  setWindowFocused(focused: boolean): void {
    const changed = focused !== this.windowFocused
    this.windowFocused = focused
    if (focused) {
      // Snap to the fast floor and re-arm at it immediately.
      this.currentIntervalMs = this.cadence.minIntervalMs
      if (this.handle !== null) this.armNextTick()
    } else if (changed) {
      // Leaving focus: keep watching, but let the idle backoff grow the interval again.
      this.currentIntervalMs = this.cadence.minIntervalMs
    }
  }

  /**
   * Force an immediate fresh poll after the machine wakes from sleep or the network
   * reconnects (wired to Electron `powerMonitor`'s `resume`/`on-ac`/`unlock` in
   * production). A timer scheduled before sleep may be badly delayed or stale, so on
   * reconnect we cancel it and tick right away to re-check the Remote promptly.
   */
  onReconnect(): void {
    if (this.handle === null) return // not running; nothing to refresh
    // Snap to the floor and run a tick now rather than waiting out a (possibly stale) timer.
    this.currentIntervalMs = this.windowFocused
      ? this.cadence.minIntervalMs
      : this.cadence.minIntervalMs
    void this.tick()
  }

  /** The SHA the poller currently treats as "already seen" (for tests/diagnostics). */
  get lastSha(): string | null {
    return this.lastSeenSha
  }

  /** The current adaptive interval in ms (for tests/diagnostics). */
  get intervalMs(): number {
    return this.currentIntervalMs
  }

  /**
   * One poll tick: read the Remote SHA, notify iff it moved, then re-pace + re-arm.
   *
   * The SHA-moved decision is the cheap detection: a single `git ls-remote`. On a move we
   * record the new SHA, snap the cadence to the floor (something is happening — poll
   * faster), and fire the detect-only notification. On no change we back the interval off
   * toward the idle ceiling. A read error never kills the loop: it is surfaced via
   * `onError` (if provided) and the next tick is still armed (never fail silently, but
   * never crash the background watcher either).
   */
  private async tick(): Promise<void> {
    // Re-entrancy guard: if a previous tick's read is still in flight (a slow network),
    // skip launching a second concurrent read; the in-flight one will re-arm on finish.
    if (this.ticking) return
    this.ticking = true
    try {
      const latest = await this.readLatestSha()
      if (latest !== null && latest !== this.lastSeenSha) {
        const previousSha = this.lastSeenSha
        this.lastSeenSha = latest
        // Activity ⇒ poll faster (snap to the floor) so follow-up changes are seen quickly.
        this.currentIntervalMs = this.cadence.minIntervalMs
        // Detect-only: notify the user; the app fetches + presents for review elsewhere.
        this.notifier.notifyIncoming({ latestSha: latest, previousSha })
      } else {
        // Quiet tick: back off toward the idle ceiling UNLESS the window is focused, where
        // we hold the fast floor so an actively-working user always sees changes promptly.
        this.currentIntervalMs = this.windowFocused
          ? this.cadence.minIntervalMs
          : Math.min(
              Math.round(this.currentIntervalMs * this.cadence.backoffFactor),
              this.cadence.maxIntervalMs,
            )
      }
    } catch (error) {
      // A transient ls-remote failure (offline, flaky DNS) must not crash the background
      // watcher. Surface it (never fail silently) and keep polling on the next tick.
      this.onError?.(error)
    } finally {
      this.ticking = false
      // Always re-arm so the loop is self-sustaining, even after an error or a skip.
      if (this.handle !== null) this.armNextTick()
    }
  }

  /** Clear any pending tick and schedule the next one at the current adaptive interval. */
  private armNextTick(): void {
    if (this.handle !== null) this.scheduler.clear(this.handle)
    this.handle = this.scheduler.schedule(() => void this.tick(), this.currentIntervalMs)
  }
}
