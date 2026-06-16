/**
 * OperationTracer — the pure, zero-I/O observability core (ADR 0007).
 *
 * dotden emits **one wide, canonical structured event per Operation** (a Commit,
 * Sync now, Apply, onboarding step, or poll) rather than scattered log lines. This
 * module is the MVP slice of that model: it accumulates a wide event per Operation
 * and appends it to a **bounded local ring buffer** — the only always-on sink. It
 * holds NO transport and reaches NO network: nothing here egresses (ADR 0007 says
 * egress only happens later, behind `TelemetrySink`'s consent gate; that lands in
 * a PRD 3 slice).
 *
 * Privacy is **structural, not hoped-for**. A wide event can only carry an
 * {@link AllowlistedAttributeKey} — a compile-time-restricted set of counts and
 * enums. Paths, file contents, secrets, `op://` references, repo URLs, and
 * hostnames are **not representable by construction** (you cannot put them on a
 * wide event because the type forbids the keys), so the privacy invariant lives in
 * the type system, exactly like ADR 0007 requires.
 */

/**
 * The compile-time-restricted set of attribute keys permitted on a wide event.
 *
 * This is the structural privacy boundary (ADR 0007 / CONTEXT.md "Allowlisted
 * attribute key"): only counts and enums are representable. There is deliberately
 * NO key for a path, file content, secret, `op://` reference, repo URL, or
 * hostname — so none of those can ever be attached to a wide event, because the
 * type of {@link WideEvent.attributes} forbids the key.
 */
export type AllowlistedAttributeKey =
  | 'fileCount'
  | 'workspaceCount'
  | 'environmentCount'
  | 'outcome'
  | 'errorClass'
  | 'chezmoiExitCode'
  | 'durationMs'
  | 'automationLevel'
  | 'queued'
  // The COUNT of commit-time secret findings (issue 2-03) — a number only. The findings'
  // file/kind/line/value are NEVER attributes (no such key exists), so the wide event can
  // record "the scan flagged N things" without ever carrying a secret or a path.
  | 'secretFindingCount'

/**
 * The value an allowlisted attribute may hold: a count, an enum string, or a flag.
 *
 * Strings are used only for closed enums (`outcome`, `errorClass`,
 * `automationLevel`) — they are NOT a back door for free-form text such as a path:
 * the allowlist of *keys* is what makes a leak unrepresentable, and reviewers keep
 * the string values closed. Booleans cover flags like `queued`.
 */
export type AllowlistedAttributeValue = number | string | boolean

/**
 * The named Operations dotden traces. One wide event is emitted per completed
 * Operation of one of these kinds (CONTEXT.md "Operation trace").
 */
export type OperationKind =
  | 'commit'
  | 'sync'
  | 'apply'
  | 'track'
  // The destructive/lifecycle verbs (issue 1-08): Untrack (`forget`) and
  // Delete everywhere (`destroy`), each a real Operation that mutates the Den.
  | 'untrack'
  | 'delete-everywhere'
  // The user-authored organization edits (issue 1-14): create a Workspace/Group or
  // re-file a File between Groups/Workspaces. Each mutates only the synced `.myenv/`
  // metadata, never chezmoi source state or any file on disk.
  | 'organize'
  | 'onboarding'
  | 'poll'

/** Terminal disposition of an Operation, recorded on its wide event. */
export type OperationOutcome = 'ok' | 'error'

/**
 * One wide, canonical structured event — the single record emitted per Operation.
 *
 * Carries the correlation id (so the event lines up with the IPC `_trace`
 * envelope), the operation kind, the outcome, a duration, and ONLY allowlisted
 * attributes. `attributes` is a `Partial` over the allowlisted keys precisely so
 * the unrepresentable-by-construction guarantee holds: there is no index signature
 * that would let an arbitrary key slip in.
 */
export interface WideEvent {
  /** Correlation id shared with the IPC `_trace` envelope, so one Operation lines up end-to-end. */
  readonly traceId: string
  /** Which Operation this event summarizes. */
  readonly kind: OperationKind
  /** Terminal disposition: `ok` or `error`. */
  readonly outcome: OperationOutcome
  /** Wall-clock duration of the Operation in milliseconds. */
  readonly durationMs: number
  /** When the event was finalized (ms since epoch), used for ordering within the ring buffer. */
  readonly finishedAt: number
  /**
   * Allowlisted business attributes — counts and enums ONLY. The key set is
   * {@link AllowlistedAttributeKey}; no path/content/URL key exists, so none can
   * be attached. This is the structural privacy invariant (ADR 0007).
   */
  readonly attributes: Partial<Record<AllowlistedAttributeKey, AllowlistedAttributeValue>>
}

/**
 * An open Operation span: the caller starts it, optionally annotates allowlisted
 * attributes, then ends it. Ending finalizes a {@link WideEvent} into the buffer.
 */
export interface OperationSpan {
  /** Correlation id minted for this Operation (mirrors the IPC `_trace.traceId`). */
  readonly traceId: string
  /**
   * Attach an allowlisted attribute. The `key` is constrained to
   * {@link AllowlistedAttributeKey}, so a path/URL/secret key is a COMPILE error —
   * the privacy boundary is enforced here, not by runtime validation.
   */
  setAttribute(key: AllowlistedAttributeKey, value: AllowlistedAttributeValue): void
  /**
   * Finalize the Operation and append exactly one wide event to the ring buffer.
   *
   * @param outcome Terminal disposition of the Operation.
   * @returns The finalized wide event (also retained in the buffer).
   */
  end(outcome: OperationOutcome): WideEvent
}

/** A monotonic-ish clock seam so tests can drive deterministic durations. */
export type Clock = () => number

/** Construction options for {@link OperationTracer}. */
export interface OperationTracerOptions {
  /** Maximum wide events retained; oldest are evicted first. Defaults to 256. */
  readonly capacity?: number
  /** Clock used for span timing; defaults to `Date.now`. Injectable for tests. */
  readonly now?: Clock
}

/**
 * The pure observability core: starts Operation spans and retains their wide
 * events in a bounded ring buffer.
 *
 * It is intentionally synchronous and side-effect-free beyond its own in-memory
 * buffer — no file writes, no network, no Electron. That purity is what lets the
 * privacy guarantee be a type-system fact rather than a runtime hope, and what
 * keeps it inside the Electron-free foundation (ADR 0023).
 */
export class OperationTracer {
  private readonly capacity: number
  private readonly now: Clock
  /** Bounded ring buffer of finalized wide events; oldest evicted when full. */
  private readonly buffer: WideEvent[] = []

  /**
   * @param options Buffer capacity and clock seam (see {@link OperationTracerOptions}).
   */
  constructor(options: OperationTracerOptions = {}) {
    this.capacity = options.capacity ?? 256
    this.now = options.now ?? Date.now
  }

  /**
   * Open a new Operation span correlated to `traceId`.
   *
   * @param kind The Operation being traced.
   * @param traceId Correlation id, normally the IPC `_trace.traceId` so the wide
   *   event lines up with the call that crossed the renderer↔main boundary.
   * @returns An {@link OperationSpan}; call {@link OperationSpan.end} to emit the event.
   */
  startOperation(kind: OperationKind, traceId: string): OperationSpan {
    const startedAt = this.now()
    const attributes: Partial<Record<AllowlistedAttributeKey, AllowlistedAttributeValue>> = {}
    const append = (event: WideEvent) => this.append(event)
    const clock = this.now
    return {
      traceId,
      setAttribute(key, value) {
        attributes[key] = value
      },
      end(outcome) {
        const finishedAt = clock()
        const durationMs = finishedAt - startedAt
        const event: WideEvent = {
          traceId,
          kind,
          outcome,
          durationMs,
          finishedAt,
          // durationMs is also surfaced as an allowlisted attribute so a consumer
          // that only reads `attributes` still sees it (ADR 0007 lists it as one).
          attributes: { ...attributes, durationMs },
        }
        append(event)
        return event
      },
    }
  }

  /**
   * Snapshot the retained wide events, oldest first.
   *
   * Returns a copy so callers cannot mutate the internal ring buffer — this is the
   * read side that a later feedback/scrubbed-log slice (ADR 0007) consumes.
   */
  events(): readonly WideEvent[] {
    return [...this.buffer]
  }

  /** Append one event, evicting the oldest when the bounded buffer is full. */
  private append(event: WideEvent): void {
    this.buffer.push(event)
    if (this.buffer.length > this.capacity) this.buffer.shift()
  }
}
