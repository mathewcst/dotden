import { describe, expect, it } from 'vitest'
import { syncStatus } from '../sync-status'

const base = {
  role: 'a' as const,
  remoteAxis: new Map(),
  pushQueued: false,
  busy: null,
  error: null,
  online: true,
}

describe('syncStatus', () => {
  it('does not report up to date while a push is queued', () => {
    expect(syncStatus({ ...base, pushQueued: true, online: false })).toMatchObject({
      kind: 'offline',
      label: 'Offline - queued',
    })
  })

  it('prioritizes errors over incoming state', () => {
    expect(
      syncStatus({
        ...base,
        remoteAxis: new Map([['.zshrc', 'incoming' as const]]),
        error: { message: 'Could not sync.' },
      }),
    ).toMatchObject({ kind: 'error', label: 'Sync error' })
  })

  it('counts incoming conflicts in the global label', () => {
    expect(
      syncStatus({
        ...base,
        remoteAxis: new Map([
          ['.zshrc', 'incoming' as const],
          ['.gitconfig', 'conflict' as const],
        ]),
      }),
    ).toMatchObject({ kind: 'incoming', label: '2 incoming, 1 conflict' })
  })
})
