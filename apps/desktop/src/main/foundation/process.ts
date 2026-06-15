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

/** Optional execution context for {@link runCommand}. */
export interface RunCommandOptions {
  /** Directory to run the process in. Defaults to the parent process's cwd when omitted. */
  readonly cwd?: string
  /**
   * Extra environment variables. Merged over (not replacing) the parent process env, so the
   * child inherits PATH/HOME/etc. and these entries override or extend them.
   */
  readonly env?: NodeJS.ProcessEnv
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

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (stdout += chunk))
    child.stderr.on('data', (chunk: string) => (stderr += chunk))
    // Spawn-level errors (e.g. ENOENT for a missing binary) reject the promise directly.
    child.on('error', reject)
    child.on('close', (exitCode) => {
      // exitCode is null when the process was terminated by a signal; treat that as a failure (1).
      resolve({ command, args, cwd: options.cwd, exitCode: exitCode ?? 1, stdout, stderr })
    })
  })

  if (result.exitCode !== 0) throw new CommandFailedError(result)
  return result
}
