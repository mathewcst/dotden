import { describe, expect, it } from 'vitest'
import { isConnectBusy, stateAfterConnectResult } from '../connect-state'
import type { ConnectResult } from '@shared/remote'

function result(repositoryKind: ConnectResult['repositoryKind']): ConnectResult {
  return { gitCommand: 'git', sourceDir: '/tmp/den', repositoryKind }
}

describe('connect-state', () => {
  it('returns foreign chezmoi repos to a recoverable non-busy state', () => {
    const state = stateAfterConnectResult(result('foreign-chezmoi'))

    expect(state).toBe('refused')
    expect(isConnectBusy(state)).toBe(false)
  })

  it('keeps real in-flight states busy', () => {
    expect(isConnectBusy('checking')).toBe(true)
    expect(isConnectBusy('reachable')).toBe(true)
    expect(isConnectBusy('idle')).toBe(false)
    expect(isConnectBusy('credential-error')).toBe(false)
  })
})
