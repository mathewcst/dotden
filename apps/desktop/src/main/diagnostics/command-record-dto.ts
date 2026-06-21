import type { RedactedCommandRecord } from '../../shared/diagnostics.js'
import {
  type CommandRecord,
  type RedactionContext,
  redactCommandRecord,
} from '../foundation/diagnostics/redactor.js'

/** Map a possibly-unredacted main-process record to the only DTO shape the renderer may receive. */
export function toRedactedCommandRecordDto(
  record: CommandRecord,
  redaction?: RedactionContext,
): RedactedCommandRecord {
  const redacted = redactCommandRecord(record, redaction)
  return {
    command: redacted.command,
    args: redacted.args,
    exitCode: redacted.exitCode,
    redactedStdout: redacted.stdout,
    redactedStderr: redacted.stderr,
    ...(redacted.traceId ? { traceId: redacted.traceId } : {}),
    timestamp: redacted.timestamp,
  }
}
