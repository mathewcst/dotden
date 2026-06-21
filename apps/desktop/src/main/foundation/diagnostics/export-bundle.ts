/**
 * Diagnostics export bundle — support handoff text built inside trusted main core.
 *
 * The Command log is already redacted at write/load, but export is the highest-probability leak
 * route, so this assembler re-runs the redactor unconditionally before serializing.
 */
import {
  type CommandRecord,
  type RedactionContext,
  redactCommandRecord,
} from './redactor.js'

/** Inputs for {@link buildDiagnosticsBundle}. */
export interface DiagnosticsBundleInput {
  readonly appVersion: string
  readonly platform: string
  readonly records: readonly CommandRecord[]
  readonly redaction?: RedactionContext
  readonly generatedAt?: string
}

interface DiagnosticsBundleRecord {
  readonly command: string
  readonly args: readonly string[]
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly traceId?: string
  readonly timestamp: string
}

/** Build a shareable, redacted diagnostics bundle for clipboard/export. */
export function buildDiagnosticsBundle(input: DiagnosticsBundleInput): string {
  const records = input.records.map((record) => toBundleRecord(record, input.redaction))
  return `${JSON.stringify(
    {
      dotdenDiagnosticsVersion: 1,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      appVersion: input.appVersion,
      platform: input.platform,
      recordCount: records.length,
      records,
    },
    null,
    2,
  )}\n`
}

function toBundleRecord(
  record: CommandRecord,
  redaction?: RedactionContext,
): DiagnosticsBundleRecord {
  const redacted = redactCommandRecord(record, redaction)
  return {
    command: redacted.command,
    args: redacted.args,
    exitCode: redacted.exitCode,
    stdout: redacted.stdout,
    stderr: redacted.stderr,
    ...(redacted.traceId ? { traceId: redacted.traceId } : {}),
    timestamp: new Date(redacted.timestamp).toISOString(),
  }
}
