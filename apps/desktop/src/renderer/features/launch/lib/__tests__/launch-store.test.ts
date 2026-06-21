/**
 * `launch` store tests — app boot + routing through the public factory seam (ADR 0027).
 *
 * Exercises `boot()` and navigation with a fake injected API and a spy theme fn — no React, no DOM.
 */
import { describe, expect, it, vi } from 'vitest'
import type { AppearanceSettings } from '../../../../../shared/appearance-settings'
import type { DotdenApi } from '../../../../../shared/ipc-api'
import { createLaunchStore } from '../launch-store'

function makeApi(over: Record<string, unknown> = {}): DotdenApi {
  return {
    den: {
      launchState: vi.fn(async () => ({ status: 'fresh' as const })),
      appearanceSettings: vi.fn(async () => ({ theme: 'amber' }) as AppearanceSettings),
      ...(over.den ?? {}),
    },
  } as unknown as DotdenApi
}

describe('launch store — boot()', () => {
  it('routes to app when launch gate is ready', async () => {
    const api = makeApi({
      den: { launchState: vi.fn(async () => ({ status: 'ready' as const })) },
    })
    const store = createLaunchStore(api, vi.fn())
    await store.getState().boot()
    expect(store.getState().route).toBe('app')
  })

  it('routes to landing when launch gate is fresh', async () => {
    const api = makeApi({
      den: { launchState: vi.fn(async () => ({ status: 'fresh' as const })) },
    })
    const store = createLaunchStore(api, vi.fn())
    await store.getState().boot()
    expect(store.getState().route).toBe('landing')
  })

  it('routes to landing when launch gate is incomplete', async () => {
    const api = makeApi({
      den: { launchState: vi.fn(async () => ({ status: 'incomplete' as const })) },
    })
    const store = createLaunchStore(api, vi.fn())
    await store.getState().boot()
    expect(store.getState().route).toBe('landing')
  })

  it('routes to landing when launch gate read fails', async () => {
    const api = makeApi({
      den: { launchState: vi.fn(async () => Promise.reject(new Error('ipc down'))) },
    })
    const store = createLaunchStore(api, vi.fn())
    await store.getState().boot()
    expect(store.getState().route).toBe('landing')
  })

  it('applies theme when appearance settings resolve', async () => {
    const applyThemeFn = vi.fn()
    const api = makeApi({
      den: {
        appearanceSettings: vi.fn(async () => ({ theme: 'amber' }) as AppearanceSettings),
      },
    })
    const store = createLaunchStore(api, applyThemeFn)
    await store.getState().boot()
    expect(applyThemeFn).toHaveBeenCalledWith('amber')
  })

  it('does not apply theme when appearance settings fail', async () => {
    const applyThemeFn = vi.fn()
    const api = makeApi({
      den: {
        appearanceSettings: vi.fn(async () => Promise.reject(new Error('no den'))),
      },
    })
    const store = createLaunchStore(api, applyThemeFn)
    await store.getState().boot()
    expect(applyThemeFn).not.toHaveBeenCalled()
  })

  it('still routes when appearance fails but launch gate succeeds', async () => {
    const api = makeApi({
      den: {
        launchState: vi.fn(async () => ({ status: 'ready' as const })),
        appearanceSettings: vi.fn(async () => Promise.reject(new Error('no den'))),
      },
    })
    const store = createLaunchStore(api, vi.fn())
    await store.getState().boot()
    expect(store.getState().route).toBe('app')
  })
})

describe('launch store — navigation', () => {
  it('starts on booting with default role a', () => {
    const store = createLaunchStore(makeApi(), vi.fn())
    expect(store.getState().route).toBe('booting')
    expect(store.getState().role).toBe('a')
    expect(store.getState().openReviewOnAppMount).toBe(false)
  })

  it('goToApp sets role and openReviewOnAppMount', () => {
    const store = createLaunchStore(makeApi(), vi.fn())
    store.getState().goToApp({ role: 'b', openReview: true })
    expect(store.getState().route).toBe('app')
    expect(store.getState().role).toBe('b')
    expect(store.getState().openReviewOnAppMount).toBe(true)
  })

  it('clearOpenReviewOnAppMount clears the flag', () => {
    const store = createLaunchStore(makeApi(), vi.fn())
    store.getState().goToApp({ role: 'b', openReview: true })
    store.getState().clearOpenReviewOnAppMount()
    expect(store.getState().openReviewOnAppMount).toBe(false)
  })
})
