/**
 * CommandLog — bounded redacted Command record buffer (ADR 0030).
 *
 * The class accepts raw completed CLI records, immediately redacts them, then
 * appends to an in-memory ring. There is deliberately no public raw append API:
 * redact-then-append is the privacy contract every later Diagnostics surface reads.
 */
import { type CommandRecord, type RedactionContext, redactCommandRecord } from './redactor.js'

/** Sink port accepted by the process seam. */
export interface DiagnosticsSink {
  /** Capture one completed command. Implementations decide storage/redaction. */
  record(record: CommandRecord): void
}

/** Construction options for {@link CommandLog}. */
export interface CommandLogOptions {
  /** Maximum Command records retained; oldest are evicted first. Defaults to 256. */
  readonly capacity?: number
  /** Local user facts used by the default redactor. */
  readonly redaction?: RedactionContext
}

/**
 * Bounded Command record ring.
 *
 * It is pure and Electron-free: no disk, no clipboard, no IPC. Persistence and
 * surfacing land in later PRD4 slices; this class owns only the memory buffer and
 * the redact-at-write invariant.
 */
export class CommandLog implements DiagnosticsSink {
  private readonly capacity: number
  private readonly redaction: RedactionContext
  private readonly buffer: CommandRecord[] = []

  /** @param options Buffer capacity plus redaction/test seams. */
  constructor(options: CommandLogOptions = {}) {
    this.capacity = options.capacity ?? 256
    this.redaction = options.redaction ?? {}
  }

  /**
   * Add one completed command to the log.
   *
   * @param record Raw completed command record from the `runCommand` seam.
   */
  record(record: CommandRecord): void {
    const redacted = redactCommandRecord(record, this.redaction)
    this.buffer.push(redacted)
    if (this.buffer.length > this.capacity) this.buffer.shift()
  }

  /**
   * Snapshot retained Command records, oldest first.
   *
   * Returns a copy so callers cannot mutate the internal ring.
   */
  records(): readonly CommandRecord[] {
    return [...this.buffer]
  }
}
