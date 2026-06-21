/**
 * runCommand safety-valve tests.
 *
 * These exercise the lowest-level shell-out primitive's *termination* guarantees —
 * the contract every higher layer (git/chezmoi transports) leans on so a hung
 * credential helper (askpass / 1Password / Git Credential Manager, per ADR 0020)
 * can never wedge onboarding forever. We spawn the very Node binary running these
 * tests (`process.execPath`) as a portable, dependency-free long-running child and
 * prove: timeout and AbortSignal both reject with {@link CommandAbortedError} carrying
 * the right reason, a child that *traps* SIGTERM is still force-killed via SIGKILL,
 * and a clean zero-exit command resolves with the expected {@link CommandResult}.
 */
import { describe, expect, it } from 'vitest'
import { CommandLog } from '../../diagnostics/command-log.js'
import { REDACTED_TOKEN } from '../../diagnostics/redactor.js'
import {
  CommandAbortedError,
  CommandFailedError,
  type CommandResult,
  runCommand,
} from '../process.js'

// The Node interpreter running this test suite — a long-running, cross-platform child
// with no external deps. `-e <script>` runs an inline program so we control its lifetime.
const node = process.execPath

describe('runCommand termination guarantees', () => {
  it('rejects with CommandAbortedError(timeout) when timeoutMs elapses', async () => {
    // A child that sleeps far longer than the timeout, so the timeout — not the child —
    // decides when it dies.
    const promise = runCommand(node, ['-e', 'setTimeout(() => {}, 10_000)'], { timeoutMs: 200 })

    await expect(promise).rejects.toBeInstanceOf(CommandAbortedError)
    await expect(promise).rejects.toMatchObject({ reason: 'timeout' })
  })

  it('rejects with CommandAbortedError(cancelled) when the AbortSignal aborts', async () => {
    const controller = new AbortController()
    // spawn() is synchronous, so by the time runCommand returns the promise the child is
    // spawned and the 'abort' listener is wired — aborting now reliably hits the abort path.
    const promise = runCommand(node, ['-e', 'setTimeout(() => {}, 10_000)'], {
      signal: controller.signal,
    })
    controller.abort()

    await expect(promise).rejects.toBeInstanceOf(CommandAbortedError)
    await expect(promise).rejects.toMatchObject({ reason: 'cancelled' })
  })

  it('escalates to SIGKILL when the child traps SIGTERM and keeps running', async () => {
    // This child swallows SIGTERM and would otherwise run for 10s. Only the SIGKILL
    // escalation can end it — so a successful rejection here proves SIGTERM→SIGKILL works.
    // Allow for the ~2s SIGKILL grace window (vitest testTimeout is 30000).
    const promise = runCommand(
      node,
      ['-e', 'process.on("SIGTERM", () => {}); setTimeout(() => {}, 10_000)'],
      { timeoutMs: 200 },
    )

    await expect(promise).rejects.toBeInstanceOf(CommandAbortedError)
    await expect(promise).rejects.toMatchObject({ reason: 'timeout' })
  })

  it('resolves with the CommandResult on a clean zero exit', async () => {
    const result = await runCommand(node, ['-e', 'process.stdout.write("ok")'])

    expect(result).toMatchObject<Partial<CommandResult>>({
      command: node,
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    })
  })

  it('writes exactly one redacted diagnostics record for a clean zero exit', async () => {
    const log = new CommandLog()

    await runCommand(
      node,
      ['-e', 'process.stdout.write("ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD")'],
      {
        diagnosticsSink: log,
      },
    )

    const records = log.records()
    expect(records).toHaveLength(1)
    expect(records[0]?.exitCode).toBe(0)
    expect(records[0]?.stdout).toBe(REDACTED_TOKEN)
  })

  it('writes exactly one redacted diagnostics record for a non-zero exit', async () => {
    const log = new CommandLog()
    const secret = 'ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD'

    const promise = runCommand(node, ['-e', `process.stderr.write("${secret}"); process.exit(7)`], {
      diagnosticsSink: log,
    })

    await expect(promise).rejects.toBeInstanceOf(CommandFailedError)
    const records = log.records()
    expect(records).toHaveLength(1)
    expect(records[0]?.exitCode).toBe(7)
    expect(records[0]?.stderr).toBe(REDACTED_TOKEN)
    expect(JSON.stringify(records)).not.toContain(secret)
  })
})
