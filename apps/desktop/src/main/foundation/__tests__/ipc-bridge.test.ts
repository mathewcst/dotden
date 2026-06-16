/**
 * IpcBridge unit tests — the `_trace`-on-every-call contract (ADR 0007, issue 1-04).
 *
 * The bridge's load-bearing guarantee is that EVERY IPC channel carries a `_trace`
 * envelope so one Operation is correlatable end to end. These tests drive the bridge
 * with a fake registrar + fake collaborators and assert: every registered channel
 * forwards the call's `traceId` into the foundation, and a payload that arrives
 * WITHOUT a `_trace` fails loudly (never silently emit an uncorrelated Operation).
 */
import { describe, expect, it, vi } from 'vitest'
import { registerIpcBridge, traceId, type IpcRegistrar } from '../../ipc/ipc-bridge.js'

/** A fake registrar that captures channel→handler so tests can invoke them directly. */
function fakeRegistrar() {
  const handlers = new Map<
    string,
    (event: unknown, payload: { _trace: { traceId: string } }) => Promise<unknown>
  >()
  const registrar: IpcRegistrar = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
  }
  return { registrar, handlers }
}

describe('IpcBridge', () => {
  it('forwards the _trace id into the DenService on every den:* channel', async () => {
    const den = {
      trackFile: vi.fn(async () => undefined),
      commitTracked: vi.fn(async () => ({
        message: 'm',
        templateId: 'default',
        templateLabel: 'Default',
        committedFiles: ['.zshrc'],
        pushed: false,
      })),
      syncPush: vi.fn(async () => undefined),
      listIncomingClean: vi.fn(async () => []),
      applyIncoming: vi.fn(async () => ({ applied: [] })),
    }
    const { registrar, handlers } = fakeRegistrar()
    registerIpcBridge(registrar, {
      remoteClient: async () => ({}) as never,
      denService: async () => den as never,
      environmentRegistry: async () => ({}) as never,
    })

    await handlers.get('den:track')?.({}, {
      targetPath: '.zshrc',
      _trace: { traceId: 't1' },
    } as never)
    await handlers.get('den:commit')?.({}, {
      targetPaths: ['.zshrc'],
      _trace: { traceId: 't2' },
    } as never)
    await handlers.get('den:sync-push')?.({}, { _trace: { traceId: 't3' } } as never)
    await handlers.get('den:list-incoming')?.({}, { _trace: { traceId: 't4' } } as never)
    await handlers.get('den:apply')?.({}, {
      targetPaths: ['.zshrc'],
      _trace: { traceId: 't5' },
    } as never)

    expect(den.trackFile).toHaveBeenCalledWith('.zshrc', 't1')
    expect(den.commitTracked).toHaveBeenCalledWith(['.zshrc'], 't2')
    expect(den.syncPush).toHaveBeenCalledWith('t3')
    expect(den.listIncomingClean).toHaveBeenCalledWith('t4')
    expect(den.applyIncoming).toHaveBeenCalledWith(['.zshrc'], 't5')
  })

  it('forwards the _trace envelope into the RemoteClient on every remote:* channel', async () => {
    const remote = {
      preflightRemote: vi.fn(async () => ({ reachable: true, gitCommand: 'git' })),
      connectExistingRemote: vi.fn(async () => ({ gitCommand: 'git', sourceDir: '/s' })),
      latestRemoteSha: vi.fn(async () => null),
    }
    const { registrar, handlers } = fakeRegistrar()
    registerIpcBridge(registrar, {
      remoteClient: async () => remote as never,
      denService: async () => ({}) as never,
      environmentRegistry: async () => ({}) as never,
    })

    await handlers.get('remote:preflight')?.({}, {
      url: 'git@h:o/r.git',
      _trace: { traceId: 'r1' },
    } as never)

    expect(remote.preflightRemote).toHaveBeenCalledWith('git@h:o/r.git', {
      _trace: { traceId: 'r1' },
    })
  })

  it('rejects a call that reached the bridge without a _trace envelope', async () => {
    const { registrar, handlers } = fakeRegistrar()
    registerIpcBridge(registrar, {
      remoteClient: async () => ({}) as never,
      denService: async () => ({ syncPush: async () => undefined }) as never,
      environmentRegistry: async () => ({}) as never,
    })

    await expect(handlers.get('den:sync-push')?.({}, {} as never)).rejects.toThrow(
      'without a _trace envelope',
    )
  })

  it('routes env:* channels to the EnvironmentRegistry and asserts _trace', async () => {
    const selfEntry = {
      id: 'env-self',
      label: 'renamed',
      os: 'linux',
      subscribedWorkspaces: ['personal'],
      isSelf: true,
      attribution: { commitCount: 0 },
    }
    const registry = {
      setupIdentity: vi.fn(async () => ({ id: 'env-self', label: 'renamed' })),
      list: vi.fn(async () => [selfEntry]),
      renameLabel: vi.fn(async () => ({ id: 'env-self', label: 'renamed' })),
      suggestClaims: vi.fn(async () => []),
    }
    const { registrar, handlers } = fakeRegistrar()
    registerIpcBridge(registrar, {
      remoteClient: async () => ({}) as never,
      denService: async () => ({}) as never,
      environmentRegistry: async () => registry as never,
    })

    await expect(
      handlers.get('env:list')?.({}, { _trace: { traceId: 'e1' } } as never),
    ).resolves.toBeDefined()
    // rename returns the renamed self entry joined with attribution (one round-trip).
    await expect(
      handlers.get('env:rename')?.({}, { label: 'renamed', _trace: { traceId: 'e2' } } as never),
    ).resolves.toMatchObject({ isSelf: true, label: 'renamed' })
    expect(registry.renameLabel).toHaveBeenCalledWith('renamed')
    await expect(
      handlers.get('env:suggest-claims')?.({}, { _trace: { traceId: 'e3' } } as never),
    ).resolves.toEqual([])

    // Every env:* channel still hard-fails without a _trace envelope.
    await expect(handlers.get('env:list')?.({}, {} as never)).rejects.toThrow(
      'without a _trace envelope',
    )
  })

  it('traceId() throws on a missing or empty id', () => {
    expect(() => traceId({ _trace: { traceId: '' } })).toThrow()
    expect(() => traceId({} as never)).toThrow()
    expect(traceId({ _trace: { traceId: 'ok' } })).toBe('ok')
  })
})
