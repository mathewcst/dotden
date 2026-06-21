/**
 * Lowest-level process primitive for dotden's main process.
 *
 * Every higher layer (the chezmoi and git transports) is built on {@link runCommand}:
 * it spawns a child process WITHOUT a shell, buffers stdout/stderr as utf8, resolves a
 * readonly {@link CommandResult} on success, and throws {@link CommandFailedError} on any
 * non-zero exit. This is the single seam through which dotden shells out to bundled tools.
 */
import { spawn } from 'node:child_process'

/**
 * Grace period between the polite SIGTERM and the unconditional SIGKILL.
 *
 * SIGTERM is only a *request* to exit: it is catchable and ignorable, so a child
 * (or a grandchild credential helper — askpass / 1Password / Git Credential
 * Manager, the very tools ADR 0020 names) can swallow it and keep holding the
 * stdout/stderr pipes open forever. Without a hard follow-up the 'close' event
 * never fires and the promise hangs, defeating the entire point of `timeoutMs`.
 * After this many ms we send SIGKILL, which the OS delivers and cannot be
 * trapped — that is the actual guarantee behind timeout/cancel.
 */
const SIGKILL_GRACE_MS = 2_000

/**
 * Outcome of a finished child process, captured by {@link runCommand}.
 *
 * Returned on success and also carried inside {@link CommandFailedError} on failure, so
 * callers can inspect the same shape regardless of exit status. All fields are readonly:
 * a result is a snapshot of what ran and what it produced.
 */
export interface CommandResult {
  /** The executable that was spawned (e.g. the resolved git/chezmoi binary path). */
  readonly command: string
  /** Arguments passed to the executable, verbatim — never shell-parsed (see {@link runCommand}). */
  readonly args: readonly string[]
  /** Working directory the process ran in, if one was provided. */
  readonly cwd?: string
  /** Process exit code; normalized to 1 when the OS reports null (e.g. killed by signal). */
  readonly exitCode: number
  /** Full stdout buffered as a utf8 string. */
  readonly stdout: string
  /** Full stderr buffered as a utf8 string. */
  readonly stderr: string
}

/**
 * Thrown by {@link runCommand} when a child process exits non-zero.
 *
 * The full {@link CommandResult} is attached as {@link CommandFailedError.result} so callers
 * can recover stdout/stderr/exitCode for diagnostics without re-running the command.
 */
export class CommandFailedError extends Error {
  // The message is built eagerly from the result so logs are self-describing; stderr is
  // trimmed to drop the trailing newline tools typically emit.
  constructor(readonly result: CommandResult) {
    super(
      `${result.command} ${result.args.join(' ')} exited ${result.exitCode}: ${result.stderr.trim()}`,
    )
  }
}

/**
 * Thrown by {@link runCommand} when dotden aborts a still-running child process.
 *
 * This is distinct from {@link CommandFailedError}: the tool did not choose a
 * non-zero exit on its own; dotden killed it because the caller cancelled the
 * operation or a timeout fired. Remote credential checks depend on this shape so
 * missing SSH/PAT credentials can become a clear timeout/cancel diagnostic
 * instead of hanging onboarding forever.
 */
export class CommandAbortedError extends Error {
  /**
   * Create an aborted-process error with the partial process output captured so far.
   *
   * @param reason Whether the abort came from the configured timeout or an AbortSignal.
   * @param result Snapshot of command/args/stdout/stderr at the moment the child closed.
   */
  constructor(
    readonly reason: 'timeout' | 'cancelled',
    readonly result: CommandResult,
  ) {
    super(`${result.command} ${result.args.join(' ')} ${reason}`)
  }
}

/** Optional execution context for {@link runCommand}. */
export interface RunCommandOptions {
  /** Directory to run the process in. Defaults to the parent process's cwd when omitted. */
  readonly cwd?: string
  /**
   * Extra environment variables. Merged over (not replacing) the parent process env, so the
   * child inherits PATH/HOME/etc. and these entries override or extend them.
   */
  readonly env?: NodeJS.ProcessEnv
  /** Kill the process after this many milliseconds to prevent credential prompts from hanging. */
  readonly timeoutMs?: number
  /** Caller cancellation; the child is killed and the promise rejects with CommandAbortedError. */
  readonly signal?: AbortSignal
}

/**
 * Spawn `command` with `args` and resolve its buffered output.
 *
 * The lowest-level shell-out primitive: it does NOT interpret a shell, so `args` are passed
 * to the executable exactly as given (no globbing, quoting, or injection surface). Higher
 * layers (git/chezmoi transports) call this and never invoke a shell themselves.
 *
 * @param command - Executable to run; callers pass the resolved (often bundled) binary path.
 * @param args - Arguments forwarded verbatim to the executable.
 * @param options - Optional cwd and env overrides (see {@link RunCommandOptions}).
 * @returns The {@link CommandResult} on a zero exit.
 * @throws {CommandFailedError} If the process exits non-zero. (A spawn-level failure — e.g.
 *   the binary is missing — rejects with the underlying Node error, not this type.)
 * @example
 * const { stdout } = await runCommand(gitBin, ['rev-parse', 'HEAD'], { cwd: repoDir })
 */
export async function runCommand(
  command: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const result = await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      // Merge over process.env so the child inherits PATH/HOME/etc., with options.env taking precedence.
      env: { ...process.env, ...options.env },
      // shell:false => args are passed straight to the executable: no shell parsing, no injection risk.
      shell: false,
      // windowsHide => never flash a console window when spawning bundled CLIs on Windows.
      windowsHide: true,
      // No stdin; capture stdout/stderr via pipes so we can buffer them below.
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let aborted: 'timeout' | 'cancelled' | undefined
    let timeout: NodeJS.Timeout | undefined
    let killTimer: NodeJS.Timeout | undefined

    // Tear down every timer and listener this promise armed. Shared by the success/close
    // path (finish) and the spawn-error path so neither can leak the timeout timer, the
    // SIGKILL grace timer, or the AbortSignal listener — a leaked timer keeps the Node
    // event loop (and thus the parent process / test runner) alive after we settle.
    const cleanup = () => {
      if (timeout) clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      options.signal?.removeEventListener('abort', abort)
    }

    const finish = (exitCode: number | null) => {
      cleanup()
      const result = { command, args, cwd: options.cwd, exitCode: exitCode ?? 1, stdout, stderr }
      // Preserve a separate error class for caller-driven termination so higher layers can
      // distinguish "git says credentials failed" from "dotden killed a hung credential prompt".
      if (aborted) reject(new CommandAbortedError(aborted, result))
      else resolve(result)
    }

    // Single escalation path for both timeout and cancellation: ask politely with SIGTERM,
    // then arm a SIGKILL fallback. SIGTERM lets git/chezmoi unwind and flush captured output;
    // SIGKILL is the hard guarantee for children that ignore SIGTERM (see SIGKILL_GRACE_MS).
    // If 'close' fires within the grace window, cleanup() cancels killTimer so SIGKILL is moot.
    const terminate = (reason: 'timeout' | 'cancelled') => {
      aborted = reason
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), SIGKILL_GRACE_MS)
    }
    const abort = () => terminate('cancelled')

    // AbortSignal is the explicit user/caller cancellation path (e.g. leaving an onboarding step).
    if (options.signal?.aborted) abort()
    else options.signal?.addEventListener('abort', abort, { once: true })
    if (options.timeoutMs !== undefined) {
      timeout = setTimeout(() => terminate('timeout'), options.timeoutMs)
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (stdout += chunk))
    child.stderr.on('data', (chunk: string) => (stderr += chunk))
    // Spawn-level errors (e.g. ENOENT for a missing binary) reject with the raw Node error,
    // not CommandFailedError. Run the same cleanup first so a failed spawn cannot leak the
    // timeout timer, the SIGKILL grace timer, or the abort listener.
    child.on('error', (error) => {
      cleanup()
      reject(error)
    })
    child.on('close', finish)
  })

  if (result.exitCode !== 0) throw new CommandFailedError(result)
  return result
}
