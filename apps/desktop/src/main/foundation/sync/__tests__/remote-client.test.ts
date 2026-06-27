/**
 * RemoteClient behavior tests.
 *
 * These tests stay at the public RemoteClient boundary and assert the load-bearing
 * V1-Lean guarantees: preflight uses chezmoi's effective git command, preserves
 * the user's credential environment, reports sanitized Provider-agnostic auth
 * diagnostics, gates `chezmoi init` behind a successful preflight, and reads the
 * poller SHA with `git ls-remote` instead of a Provider API or full fetch.
 */
import { describe, expect, it } from 'vitest'
import { access, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  CommandFailedError,
  type CommandResult,
  type RunCommandOptions,
} from '../../platform/process.js'
import {
  RemoteClient,
  RemoteConnectError,
  RemotePollError,
  RemotePreflightError,
} from '../remote-client.js'

const trace = { traceId: 'trace-remote-client-test' }

function result(command: string, args: readonly string[], stdout = '', stderr = ''): CommandResult {
  return { command, args, exitCode: 0, stdout, stderr }
}

function createClient(
  run: (
    command: string,
    args: readonly string[],
    options?: RunCommandOptions,
  ) => Promise<CommandResult>,
  sourceDir = '/tmp/source',
) {
  return new RemoteClient({
    chezmoiBin: '/bin/chezmoi',
    gitBin: '/bin/git',
    sourceDir,
    destinationDir: '/tmp/home',
    timeoutMs: 123,
    run,
  })
}

describe('RemoteClient', () => {
  it('preflights a pasted Remote URL with chezmoi effective git.command and preserves credential environment', async () => {
    const calls: Array<{ command: string; args: readonly string[]; options?: RunCommandOptions }> =
      []
    const client = createClient(async (command, args, options) => {
      calls.push({ command, args, options })
      if (command === '/bin/chezmoi') return result(command, args, '/custom/git\n')
      return result(command, args)
    })

    await expect(
      client.preflightRemote('git@github.com:owner/private.git', { _trace: trace }),
    ).resolves.toMatchObject({ reachable: true, gitCommand: '/custom/git' })

    expect(calls[1]).toMatchObject({
      command: '/custom/git',
      args: ['ls-remote', '--end-of-options', 'git@github.com:owner/private.git'],
    })
    expect(calls[1]?.options?.env).toBeUndefined()
    expect(calls[1]?.options?.timeoutMs).toBe(123)
  })

  it('returns provider-agnostic sanitized credential diagnostics for private-repo failures', async () => {
    const client = createClient(async (command, args) => {
      if (command === '/bin/chezmoi') return result(command, args, '')
      throw new CommandFailedError({
        command,
        args,
        exitCode: 128,
        stdout: '',
        stderr:
          'remote: Repository not found. token ghp_1234567890SECRET https://user:pass@example.com/private.git\n',
      })
    })

    await expect(
      client.preflightRemote('https://github.com/owner/private.git', { _trace: trace }),
    ).resolves.toEqual({
      reachable: false,
      gitCommand: '/bin/git',
      diagnostics: {
        host: 'github.com',
        scheme: 'https',
        exitCode: 128,
        stderr:
          'remote: Repository not found. token <redacted-token> https://<redacted>@example.com/private.git\n',
        help: 'Set up your git credentials (SSH key or token) for github.com, then try again. If this is a private repo and the Provider says “Repository not found”, your credentials may not have access.',
      },
    })
  })

  it('runs chezmoi init only after a successful preflight', async () => {
    const calls: Array<{ command: string; args: readonly string[]; options?: RunCommandOptions }> =
      []
    const client = createClient(async (command, args, options) => {
      calls.push({ command, args, options })
      if (command === '/bin/chezmoi' && args.includes('execute-template'))
        return result(command, args, '')
      return result(command, args)
    })

    await expect(
      client.connectExistingRemote('ssh://git@example.com/dotden.git', { _trace: trace }),
    ).resolves.toEqual({
      gitCommand: '/bin/git',
      sourceDir: '/tmp/source',
      repositoryKind: 'greenfield',
    })

    expect(calls.map((call) => [call.command, call.args])).toEqual([
      ['/bin/chezmoi', ['--no-tty', 'execute-template', '{{ .chezmoi.config.git.command }}']],
      ['/bin/git', ['ls-remote', '--end-of-options', 'ssh://git@example.com/dotden.git']],
      [
        '/bin/chezmoi',
        [
          '--source',
          '/tmp/source',
          '--destination',
          '/tmp/home',
          '--no-tty',
          '--force',
          'init',
          'ssh://git@example.com/dotden.git',
        ],
      ],
    ])
    expect(calls[2]?.options?.env).toBeUndefined()
  })

  it('classifies an existing dotden Den after clone', async () => {
    const source = await mkdtemp(join(tmpdir(), 'dotden-remote-client-'))
    try {
      const client = createClient(async (command, args) => {
        if (command === '/bin/chezmoi' && args.includes('execute-template'))
          return result(command, args, '')
        if (command === '/bin/chezmoi' && args.includes('init')) {
          await mkdir(join(source, '.dotden'), { recursive: true })
        }
        return result(command, args)
      }, source)

      await expect(
        client.connectExistingRemote('ssh://git@example.com/dotden.git', { _trace: trace }),
      ).resolves.toMatchObject({ repositoryKind: 'dotden' })
    } finally {
      await rm(source, { recursive: true, force: true })
    }
  })

  it('classifies a foreign chezmoi source after clone', async () => {
    const source = await mkdtemp(join(tmpdir(), 'dotden-remote-client-'))
    try {
      const client = createClient(async (command, args) => {
        if (command === '/bin/chezmoi' && args.includes('execute-template'))
          return result(command, args, '')
        if (command === '/bin/chezmoi' && args.includes('init')) {
          await writeFile(join(source, 'dot_zshrc'), '# shell\n')
        }
        return result(command, args)
      }, source)

      await expect(
        client.connectExistingRemote('ssh://git@example.com/chezmoi.git', { _trace: trace }),
      ).resolves.toMatchObject({ repositoryKind: 'foreign-chezmoi' })
    } finally {
      await rm(source, { recursive: true, force: true })
    }
  })

  it('cleans a refused foreign chezmoi clone so the next boot sees no abandoned source', async () => {
    const source = await mkdtemp(join(tmpdir(), 'dotden-remote-client-'))
    try {
      const client = createClient(async (command, args) => {
        if (command === '/bin/chezmoi' && args.includes('execute-template'))
          return result(command, args, '')
        if (command === '/bin/chezmoi' && args.includes('init')) {
          await mkdir(join(source, '.git'), { recursive: true })
          await writeFile(join(source, 'dot_zshrc'), '# foreign\n')
        }
        return result(command, args)
      }, source)

      await expect(
        client.connectExistingRemote('ssh://git@example.com/chezmoi.git', { _trace: trace }),
      ).resolves.toMatchObject({ repositoryKind: 'foreign-chezmoi' })
      await expect(access(join(source, '.git'))).rejects.toThrow()
      await expect(readdir(source)).resolves.toEqual([])
    } finally {
      await rm(source, { recursive: true, force: true })
    }
  })

  it('cleans a stale populated source before retrying init', async () => {
    const source = await mkdtemp(join(tmpdir(), 'dotden-remote-client-'))
    try {
      await mkdir(join(source, '.git'), { recursive: true })
      await writeFile(join(source, 'stale'), 'left by an earlier failed connect\n')
      const client = createClient(async (command, args) => {
        if (command === '/bin/chezmoi' && args.includes('execute-template'))
          return result(command, args, '')
        if (command === '/bin/chezmoi' && args.includes('init')) {
          await expect(access(join(source, 'stale'))).rejects.toThrow()
          await mkdir(join(source, '.dotden'), { recursive: true })
        }
        return result(command, args)
      }, source)

      await expect(
        client.connectExistingRemote('ssh://git@example.com/dotden.git', { _trace: trace }),
      ).resolves.toMatchObject({ repositoryKind: 'dotden' })
    } finally {
      await rm(source, { recursive: true, force: true })
    }
  })

  it('does not run chezmoi init after failed preflight', async () => {
    const calls: string[] = []
    const client = createClient(async (command, args) => {
      calls.push(`${command} ${args.join(' ')}`)
      if (command === '/bin/chezmoi') return result(command, args, '')
      throw new CommandFailedError({ command, args, exitCode: 128, stdout: '', stderr: 'denied' })
    })

    await expect(
      client.connectExistingRemote('git@gitlab.com:owner/private.git', { _trace: trace }),
    ).rejects.toBeInstanceOf(RemotePreflightError)

    expect(calls).toEqual([
      '/bin/chezmoi --no-tty execute-template {{ .chezmoi.config.git.command }}',
      '/bin/git ls-remote --end-of-options git@gitlab.com:owner/private.git',
    ])
  })

  it('reads latest Remote branch SHA via git ls-remote without fetching or Provider APIs', async () => {
    const client = createClient(async (command, args) => {
      if (command === '/bin/chezmoi') return result(command, args, '')
      return result(command, args, '0123456789abcdef0123456789abcdef01234567\trefs/heads/trunk\n')
    })

    await expect(
      client.latestRemoteSha('https://git.example.test/owner/den.git', 'trunk', { _trace: trace }),
    ).resolves.toBe('0123456789abcdef0123456789abcdef01234567')
  })

  it('surfaces a sanitized, URL-free RemoteConnectError when chezmoi init fails after a passing preflight', async () => {
    // Preflight passes (execute-template + ls-remote succeed); only the committed `init` step throws.
    const initStderr =
      'fatal: clone failed token ghp_INITSECRET1234567890 https://user:pass@example.com/private.git\n'
    const client = createClient(async (command, args) => {
      if (command === '/bin/chezmoi' && args.includes('execute-template'))
        return result(command, args, '')
      if (command === '/bin/git') return result(command, args)
      // command === '/bin/chezmoi' with `init` — the only failing call.
      throw new CommandFailedError({
        command,
        args,
        exitCode: 128,
        stdout: '',
        stderr: initStderr,
      })
    })

    const url = 'https://user:pass@example.com/private.git'
    const error = await client
      .connectExistingRemote(url, { _trace: trace })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(RemoteConnectError)
    const connectError = error as RemoteConnectError
    // The sanitized stderr keeps host context but drops the token and the basic-auth credentials.
    expect(connectError.diagnostics.stderr).toBe(
      'fatal: clone failed token <redacted-token> https://<redacted>@example.com/private.git\n',
    )
    expect(connectError.diagnostics.host).toBe('example.com')
    // No raw URL or token survives on either the message or the diagnostics that cross IPC.
    const surfaced = `${connectError.message} ${JSON.stringify(connectError.diagnostics)}`
    expect(surfaced).not.toContain('user:pass')
    expect(surfaced).not.toContain('ghp_INITSECRET1234567890')
    expect(surfaced).not.toContain('https://user:pass@example.com/private.git')
  })

  it('rejects a leading-dash Remote URL in preflight without spawning ls-remote', async () => {
    const lsRemoteCalls: string[] = []
    const client = createClient(async (command, args) => {
      if (command === '/bin/chezmoi' && args.includes('execute-template'))
        return result(command, args, '')
      if (args.includes('ls-remote')) lsRemoteCalls.push(`${command} ${args.join(' ')}`)
      return result(command, args)
    })

    await expect(
      client.preflightRemote('--upload-pack=evil.sh', { _trace: trace }),
    ).resolves.toMatchObject({ reachable: false })
    // The guard short-circuits before any ls-remote spawn.
    expect(lsRemoteCalls).toEqual([])
  })

  it('surfaces a sanitized RemotePollError with the credential hint when latestRemoteSha fails', async () => {
    // GitHub returns "Repository not found" for both a missing repo AND a private repo the user's
    // credentials cannot see — the poller must carry that hint, not a raw URL-leaking dump.
    const client = createClient(async (command, args) => {
      if (command === '/bin/chezmoi') return result(command, args, '')
      throw new CommandFailedError({
        command,
        args,
        exitCode: 128,
        stdout: '',
        stderr: 'remote: Repository not found.\n',
      })
    })

    const url = 'https://github.com/owner/private.git'
    const error = await client
      .latestRemoteSha(url, 'main', { _trace: trace })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(RemotePollError)
    const pollError = error as RemotePollError
    expect(pollError.diagnostics.host).toBe('github.com')
    expect(pollError.diagnostics.exitCode).toBe(128)
    // The hint explains the ambiguous "Repository not found" so a private-repo access gap is clear.
    expect(pollError.diagnostics.help).toContain('your credentials may not have access')
    // No raw URL survives on the message or diagnostics.
    const surfaced = `${pollError.message} ${JSON.stringify(pollError.diagnostics)}`
    expect(surfaced).not.toContain('github.com/owner/private.git')
  })

  it('throws on a leading-dash Remote URL in latestRemoteSha (defense in depth)', async () => {
    const client = createClient(async (command, args) => result(command, args))

    await expect(
      client.latestRemoteSha('--upload-pack=evil.sh', 'main', { _trace: trace }),
    ).rejects.toThrow('Invalid Remote URL')
  })

  it('redacts non-GitHub credential shapes in stderr (http basic-auth and GitLab PAT)', async () => {
    const client = createClient(async (command, args) => {
      if (command === '/bin/chezmoi') return result(command, args, '')
      throw new CommandFailedError({
        command,
        args,
        exitCode: 128,
        stdout: '',
        stderr:
          'remote: denied http://user:pass@example.com/repo.git token glpat-ABCDEF1234567890\n',
      })
    })

    const preflight = await client.preflightRemote('https://gitlab.com/owner/private.git', {
      _trace: trace,
    })

    expect(preflight.reachable).toBe(false)
    expect(preflight.diagnostics?.stderr).toBe(
      'remote: denied http://<redacted>@example.com/repo.git token <redacted-token>\n',
    )
  })
})
