/**
 * `apply` slice tests — the inbound half (ADR 0006; ADR 0027 Phase 2): Detect, the Remote axis,
 * and the review/resolve surface flags. Through the store seam, node environment, no DOM.
 */
import { describe, expect, it, vi } from 'vitest'
import { createDenSessionStore } from '../../store'
import type { DotdenApi } from '@shared/ipc-api'

function makeApi(over: Record<string, unknown> = {}): DotdenApi {
  return {
    den: {
      listIncoming: vi.fn(async () => [
        { targetPath: '.zshrc', marker: 'incoming', requiresConfirmation: false },
        { targetPath: '.vimrc', marker: 'incoming', requiresConfirmation: false },
      ]),
      incomingSummary: vi.fn(async () => ({
        items: [
          { targetPath: '.zshrc', marker: 'incoming' },
          { targetPath: '.bashrc', marker: 'conflict' },
        ],
        fromEnvironmentLabel: 'work-laptop',
      })),
      diff: vi.fn(async () => ''),
      ...(over.den ?? {}),
    },
  } as unknown as DotdenApi
}

describe('apply slice — list (env B Detect)', () => {
  it('lists incoming Files and selects the first', async () => {
    const api = makeApi()
    const store = createDenSessionStore('b', api)
    store.getState().list()
    await vi.waitFor(() => expect(store.getState().incoming).toHaveLength(2))
    expect(store.getState().selected).toBe('.zshrc')
    expect(api.den.listIncoming).toHaveBeenCalled()
  })

  it('clears the selection when nothing is incoming', async () => {
    const api = makeApi({ den: { listIncoming: vi.fn(async () => []) } })
    const store = createDenSessionStore('b', api)
    store.getState().list()
    await vi.waitFor(() => expect(api.den.listIncoming).toHaveBeenCalled())
    expect(store.getState().incoming).toEqual([])
    expect(store.getState().selected).toBeNull()
  })
})

describe('apply slice — refreshIncoming (the Remote axis + source label)', () => {
  it('maps the summary into the per-File marker map + source label', async () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)
    await store.getState().refreshIncoming()
    const s = store.getState()
    expect(s.remoteAxis.get('.zshrc')).toBe('incoming')
    expect(s.remoteAxis.get('.bashrc')).toBe('conflict')
    expect(s.incomingFrom).toBe('work-laptop')
  })

  it('soft-fails into the error channel without throwing (never breaks the local tree)', async () => {
    const api = makeApi({
      den: {
        incomingSummary: vi.fn(async () => {
          throw new Error('offline')
        }),
      },
    })
    const store = createDenSessionStore('a', api)
    await expect(store.getState().refreshIncoming()).resolves.toBeUndefined()
    expect(store.getState().error?.message).toMatch(/offline/)
    expect(store.getState().remoteAxis.size).toBe(0)
  })
})

describe('apply slice — review/resolve surface flags', () => {
  it('toggles reviewing and resolving independently', () => {
    const store = createDenSessionStore('a', makeApi())
    store.getState().setReviewing(true)
    expect(store.getState().reviewing).toBe(true)
    expect(store.getState().resolving).toBe(false)
    store.getState().setResolving(true)
    store.getState().setReviewing(false)
    expect(store.getState().reviewing).toBe(false)
    expect(store.getState().resolving).toBe(true)
  })
})
