/**
 * Disk-backed Command log adapter (PRD4 issue 4-03).
 *
 * The pure foundation {@link CommandLog} owns redact-at-write and bounded
 * retention. This adapter is the environment-local persistence edge: it stores
 * only redacted snapshots under Electron `userData` (a tempdir in tests) and
 * reloads that bounded ring on restart.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  CommandLog,
  type CommandLogOptions,
  type DiagnosticsSink,
} from '../foundation/diagnostics/command-log.js'
import { type CommandRecord, redactCommandRecord } from '../foundation/diagnostics/redactor.js'
import type { WideEvent } from '../foundation/platform/operation-tracer.js'

/** Relative location of the persisted redacted Command log under `userData`. */
export const COMMAND_LOG_RELATIVE_PATH = join('diagnostics', 'command-log.json')

const COMMAND_LOG_FILE_VERSION = 1

interface PersistedCommandLog {
  readonly version: 1
  readonly records: readonly CommandRecord[]
}

/** Construction options for {@link PersistentCommandLog}. */
export interface PersistentCommandLogOptions extends CommandLogOptions {
  /** Override file location for focused tests. Production uses `userData/diagnostics/command-log.json`. */
  readonly filePath?: string
}

/**
 * A diagnostics sink that persists the bounded, redacted Command ring to disk.
 *
 * `record()` stays synchronous because the process seam's sink port is
 * synchronous. The file is small by construction (low hundreds of records), so
 * each append rewrites one bounded JSON snapshot and any write failure surfaces
 * immediately instead of silently disabling Diagnostics.
 */
export class PersistentCommandLog implements DiagnosticsSink {
  /** Absolute path to the persisted redacted Command log file. */
  readonly filePath: string

  private constructor(
    private readonly log: CommandLog,
    filePath: string,
  ) {
    this.filePath = filePath
  }

  /**
   * Load the persisted redacted ring for this environment.
   *
   * @param userDataDir Electron `app.getPath('userData')`; a tempdir in tests.
   * @param options Capacity/redaction options plus an optional file override.
   */
  static async load(
    userDataDir: string,
    options: PersistentCommandLogOptions = {},
  ): Promise<PersistentCommandLog> {
    const filePath = options.filePath ?? commandLogPath(userDataDir)
    const persisted = await readPersisted(filePath, options)
    const log = new CommandLog({ ...options, initialRecords: persisted })
    const sink = new PersistentCommandLog(log, filePath)

    if (!existsSync(filePath)) {
      await mkdir(dirname(filePath), { recursive: true })
      sink.persist()
    } else {
      // Loading always re-redacts hydrated records. Persist that snapshot so a restart after a
      // session-scoped unredacted run returns the on-disk log to protected form.
      sink.persist()
    }

    return sink
  }

  /**
   * Record one completed command, then write the bounded redacted snapshot to disk.
   *
   * @param record Raw completed command from the `runCommand` seam.
   */
  record(record: CommandRecord): void {
    this.log.record(record)
    this.persist()
  }

  /**
   * Fold one finalized Operation wide event into the canonical persisted Diagnostics stream.
   *
   * The renderer intentionally reads only CommandLog records. These synthetic records make the
   * ADR 0007 wide-event ring visible there without adding a second local-capture API.
   */
  recordOperationEvent(event: WideEvent): void {
    this.log.record({
      command: 'dotden-operation',
      args: [event.kind, event.outcome],
      exitCode: event.outcome === 'ok' ? 0 : 1,
      stdout: JSON.stringify(event.attributes, null, 2),
      stderr: '',
      traceId: event.traceId,
      timestamp: event.finishedAt,
    })
    this.persist()
  }

  /** Snapshot retained Command records, oldest first. */
  records(): readonly CommandRecord[] {
    return this.log.records()
  }

  /** Snapshot only records correlated to `traceId`. */
  recordsFor(traceId: string): readonly CommandRecord[] {
    return this.log.recordsFor(traceId)
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(
      this.filePath,
      `${JSON.stringify({ version: COMMAND_LOG_FILE_VERSION, records: this.log.records() } satisfies PersistedCommandLog, null, 2)}\n`,
      'utf8',
    )
  }
}

/** Resolve the diagnostics file path under an environment's `userData` dir. */
export function commandLogPath(userDataDir: string): string {
  return join(userDataDir, COMMAND_LOG_RELATIVE_PATH)
}

async function readPersisted(
  filePath: string,
  options: CommandLogOptions,
): Promise<readonly CommandRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Partial<PersistedCommandLog>
    const records = Array.isArray(parsed.records) ? parsed.records.filter(isCommandRecord) : []
    return records.map((record) =>
      // Persisted records should already be redacted. Re-running the redactor keeps reload
      // tolerant of old files without creating a raw-at-rest path.
      redactCommandRecord(record, options.redaction),
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function isCommandRecord(value: unknown): value is CommandRecord {
  const record = value as Partial<CommandRecord>
  return (
    typeof record.command === 'string' &&
    Array.isArray(record.args) &&
    record.args.every((arg) => typeof arg === 'string') &&
    typeof record.exitCode === 'number' &&
    typeof record.stdout === 'string' &&
    typeof record.stderr === 'string' &&
    typeof record.timestamp === 'number' &&
    (record.traceId === undefined || typeof record.traceId === 'string')
  )
}
