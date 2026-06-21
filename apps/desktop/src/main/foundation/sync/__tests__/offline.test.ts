/**
 * isOfflineError — distinguishes a network-offline transport failure (queue + retry) from
 * a server-reached rejection (surface) or a non-transport error (rethrow), issue 1-16.
 *
 * The offline-queue contract hinges on this classification: an offline push is queued and
 * retried, while a real rejection (non-fast-forward, auth denied, missing repo) must NOT
 * be hidden behind "we'll retry when you reconnect" (the retry could never fix it). These
 * are the real git stderr signatures verified against the bundled git.
 */
import { describe, expect, it } from 'vitest'
import { CommandAbortedError, CommandFailedError } from '../../platform/process.js'
import { isOfflineError } from '../offline.js'

/** A git failure carrying the given stderr (the only thing the classifier inspects). */
function gitFailure(stderr: string): CommandFailedError {
  return new CommandFailedError({
    command: 'git',
    args: ['push'],
    exitCode: 128,
    stdout: '',
    stderr,
  })
}

describe('isOfflineError (issue 1-16)', () => {
  it.each([
    [
      'DNS failure',
      "fatal: unable to access 'https://github.com/u/d.git/': Could not resolve host: github.com",
    ],
    [
      'TCP connect failure',
      "fatal: unable to access 'https://192.0.2.1/d.git/': Failed to connect to 192.0.2.1 port 443 after 133488 ms: Couldn't connect to server",
    ],
    ['connection timed out', 'ssh: connect to host github.com port 22: Connection timed out'],
    ['connection refused', 'ssh: connect to host github.com port 22: Connection refused'],
    [
      'network unreachable',
      "fatal: unable to access 'https://github.com/u/d.git/': Network is unreachable",
    ],
    [
      'name resolution',
      'ssh: Could not resolve hostname github.com: Temporary failure in name resolution',
    ],
  ])('classifies %s as offline (queue + retry)', (_label, stderr) => {
    expect(isOfflineError(gitFailure(stderr))).toBe(true)
  })

  it.each([
    ['non-fast-forward rejection', '! [rejected]        main -> main (non-fast-forward)'],
    ['authentication failure', 'fatal: Authentication failed for https://github.com/u/d.git/'],
    ['missing repository', 'remote: Repository not found.\nfatal: repository not found'],
    ['permission denied', 'git@github.com: Permission denied (publickey).'],
  ])('classifies %s as NOT offline (server reached → surface)', (_label, stderr) => {
    expect(isOfflineError(gitFailure(stderr))).toBe(false)
  })

  it('a timeout/cancel (CommandAbortedError) is NOT offline (a hung prompt is not no-network)', () => {
    const aborted = new CommandAbortedError('timeout', {
      command: 'git',
      args: ['push'],
      exitCode: 1,
      stdout: '',
      stderr: '',
    })
    expect(isOfflineError(aborted)).toBe(false)
  })

  it('a spawn-level error (missing git binary) is NOT offline', () => {
    const enoent = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
    expect(isOfflineError(enoent)).toBe(false)
  })

  it('a plain Error / non-error value is NOT offline', () => {
    expect(isOfflineError(new Error('boom'))).toBe(false)
    expect(isOfflineError(undefined)).toBe(false)
    expect(isOfflineError('Could not resolve host')).toBe(false)
  })
})
