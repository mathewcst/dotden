/**
 * Shared Diagnostics DTOs (ADR 0031).
 *
 * The renderer receives this redacted shape only. It deliberately does not import
 * the main-process `CommandRecord`, whose stdout/stderr names describe raw
 * process output at the capture seam.
 */

/** One completed CLI invocation after main-process redaction. */
export interface RedactedCommandRecord {
  /** Executable that was spawned, e.g. git or chezmoi. */
  readonly command: string
  /** Arguments after write-side redaction. */
  readonly args: readonly string[]
  /** Process exit code; zero means success. */
  readonly exitCode: number
  /** Redacted stdout, or `[rendered output omitted]` for secret-bearing commands. */
  readonly redactedStdout: string
  /** Redacted stderr. */
  readonly redactedStderr: string
  /** Operation correlation id, when captured inside an Operation context. */
  readonly traceId?: string
  /** Capture time in ms since epoch. */
  readonly timestamp: number
}

/** Result returned after main writes a redacted diagnostics bundle to the clipboard. */
export interface CopyDiagnosticsResult {
  /** Number of Command records included in the copied bundle. */
  readonly recordCount: number
}

/** Session-scoped unredacted capture state. Never persisted. */
export interface UnredactedModeState {
  /** Whether new Command records bypass redaction before entering the local log. */
  readonly enabled: boolean
}
