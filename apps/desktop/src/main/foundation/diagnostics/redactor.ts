/**
 * Diagnostics redactor — structure-preserving masking for Command records (ADR 0030).
 *
 * Unlike the wide-event stream, Diagnostics intentionally carries real command
 * output. This module is the write-side privacy boundary: it masks known
 * credential shapes and omits un-patternable rendered output before a Command
 * record can enter the Command log.
 */
import path from 'node:path'

/** Deliberate marker rendered anywhere sensitive bytes were removed. */
export const REDACTED_TOKEN = '[REDACTED]'

/** Replacement for stdout from commands that may render arbitrary secret values. */
export const OMITTED_RENDERED_OUTPUT = '[rendered output omitted]'

/** One completed CLI invocation before or after redaction. */
export interface CommandRecord {
  /** Executable that was spawned, e.g. git or chezmoi. */
  readonly command: string
  /** Arguments passed without shell parsing. */
  readonly args: readonly string[]
  /** Process exit code; zero means success. */
  readonly exitCode: number
  /** Buffered stdout. Redacted records may omit this for secret-bearing commands. */
  readonly stdout: string
  /** Buffered stderr. */
  readonly stderr: string
  /** Operation correlation id, present only when captured inside an Operation context. */
  readonly traceId?: string
  /** Capture time in ms since epoch. */
  readonly timestamp: number
}

/** Host-local facts needed to collapse personally identifying paths. */
export interface RedactionContext {
  /** User home directory to collapse to `~`, when known. */
  readonly homeDir?: string
  /** Login/user name to collapse to `~`, when known. */
  readonly username?: string
}

const KNOWN_TOKEN_PATTERNS: readonly RegExp[] = [
  /\bgh[opusr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
]

/**
 * Redact a raw Command record into the only form allowed inside the Command log.
 *
 * @param raw Completed command record with raw args/output.
 * @param context Local user facts for home/username collapsing.
 * @returns A structurally similar record with sensitive spans replaced.
 */
export function redactCommandRecord(
  raw: CommandRecord,
  context: RedactionContext = {},
): CommandRecord {
  const args = raw.args.map((arg) => redactText(arg, context))
  const stdout = shouldOmitStdout(raw) ? OMITTED_RENDERED_OUTPUT : redactText(raw.stdout, context)

  return {
    ...raw,
    args,
    stdout,
    stderr: redactText(raw.stderr, context),
  }
}

/** Whether stdout may contain arbitrary rendered secrets with no detectable pattern. */
function shouldOmitStdout(record: CommandRecord): boolean {
  const commandName = path.basename(record.command).toLowerCase()
  const verb = record.args[0]
  return commandName.includes('chezmoi') && (verb === 'diff' || verb === 'apply')
}

/** Redact one string field while preserving diagnostic shape where possible. */
function redactText(value: string, context: RedactionContext): string {
  let redacted = value

  redacted = redactUrlCredentials(redacted)
  redacted = redactAuthorizationHeaders(redacted)
  redacted = redactOpResolvedValues(redacted)
  for (const pattern of KNOWN_TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED_TOKEN)
  }
  redacted = collapseLocalIdentity(redacted, context)

  return redacted
}

/** Keep scheme/user/host visible while replacing URL password/token credentials. */
function redactUrlCredentials(value: string): string {
  return value.replace(
    /(\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@[\w.-]+(?::\d+)?)/gi,
    `$1${REDACTED_TOKEN}$3`,
  )
}

/** Redact common auth header forms without erasing which header failed. */
function redactAuthorizationHeaders(value: string): string {
  return value
    .replace(/\b(Authorization:\s*(?:Bearer|Basic|Token)\s+)([^\s]+)/gi, `$1${REDACTED_TOKEN}`)
    .replace(/\b(Bearer\s+)([A-Za-z0-9._~+/-]+=*)/gi, `$1${REDACTED_TOKEN}`)
}

/**
 * Preserve the password-manager reference but mask a resolved value printed next
 * to it. This handles common `op://vault/item/field value` and `op://...=value`
 * shapes without treating the reference itself as secret.
 */
function redactOpResolvedValues(value: string): string {
  return value.replace(/\b(op:\/\/\S+?)(\s+|=|:)([^\s]+)/g, `$1$2${REDACTED_TOKEN}`)
}

/** Collapse local home paths and usernames so records are shareable by default. */
function collapseLocalIdentity(value: string, context: RedactionContext): string {
  let redacted = value
  if (context.homeDir) {
    redacted = redacted.replaceAll(context.homeDir, '~')
  }
  if (context.username) {
    redacted = redacted
      .replace(new RegExp(`/home/${escapeRegExp(context.username)}\\b`, 'g'), '~')
      .replace(new RegExp(`/Users/${escapeRegExp(context.username)}\\b`, 'g'), '~')
      .replace(new RegExp(`\\b${escapeRegExp(context.username)}\\b`, 'g'), '~')
  }
  return redacted
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
