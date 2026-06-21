// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_LIVENESS_TIMEOUT_MS } from '@/shared/lib/ipc-timeout'
import { installDotdenTestApi } from '@/test/dotden-test-api'
import { OBDiscover } from '../OBDiscover'

const suggestion = {
  targetPath: '.zshrc',
  toolId: 'zsh',
  toolLabel: 'Zsh',
  isFolder: false,
  sizeBytes: 128,
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('OBDiscover liveness', () => {
  it('recovers when tracking never settles', async () => {
    installDotdenTestApi({
      discover: {
        scan: vi.fn(async () => ({ suggestions: [suggestion], count: 1 })),
      },
      den: {
        track: vi.fn(() => new Promise<void>(() => {})),
        scanCommit: vi.fn(async () => []),
      },
    })

    render(<OBDiscover onTracked={vi.fn()} />)

    const trackButton = await screen.findByRole('button', { name: /track 1 selected/i })
    vi.useFakeTimers()
    fireEvent.click(trackButton)
    await act(async () => {
      vi.advanceTimersByTime(IPC_LIVENESS_TIMEOUT_MS)
    })
    vi.useRealTimers()

    expect((await screen.findByRole('alert')).textContent).toContain('did not respond')
    expect(
      (screen.getByRole('button', { name: /track 1 selected/i }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('advances when tracking resolves', async () => {
    const onTracked = vi.fn()
    installDotdenTestApi({
      discover: {
        scan: vi.fn(async () => ({ suggestions: [suggestion], count: 1 })),
      },
      den: {
        track: vi.fn(async () => undefined),
        scanCommit: vi.fn(async () => []),
      },
    })

    render(<OBDiscover onTracked={onTracked} />)

    fireEvent.click(await screen.findByRole('button', { name: /track 1 selected/i }))
    await waitFor(() => expect(onTracked).toHaveBeenCalledWith(['.zshrc']))
  })

  it('recovers when tracking rejects', async () => {
    installDotdenTestApi({
      discover: {
        scan: vi.fn(async () => ({ suggestions: [suggestion], count: 1 })),
      },
      den: {
        track: vi.fn(async () => {
          throw new Error('track failed')
        }),
        scanCommit: vi.fn(async () => []),
      },
    })

    render(<OBDiscover onTracked={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /track 1 selected/i }))
    expect((await screen.findByRole('alert')).textContent).toContain('track failed')
    expect(
      (screen.getByRole('button', { name: /track 1 selected/i }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })
})
