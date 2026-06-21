// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_LIVENESS_TIMEOUT_MS } from '@/lib/ipc-timeout'
import { installDotdenTestApi } from '@/test/dotden-test-api'
import { OBFoundDen } from '../OBFoundDen'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('OBFoundDen liveness', () => {
  it('exits loading when suggestClaims never settles', async () => {
    installDotdenTestApi({
      environment: {
        suggestClaims: vi.fn(() => new Promise<readonly []>(() => {})),
      },
    })

    vi.useFakeTimers()
    render(<OBFoundDen onChoose={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toContain('Reading your Den')

    await act(async () => {
      vi.advanceTimersByTime(IPC_LIVENESS_TIMEOUT_MS)
    })
    vi.useRealTimers()

    expect((await screen.findByRole('alert')).textContent).toContain('did not respond')
    expect(screen.queryByRole('status')).toBeNull()
    expect((screen.getByRole('radio', { name: /new environment/i }) as HTMLInputElement).disabled)
      .toBe(false)
    expect(
      (screen.getByRole('button', { name: /choose workspaces/i }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('reveals the new-environment choice when suggestClaims resolves empty', async () => {
    const onChoose = vi.fn()
    installDotdenTestApi({
      environment: {
        suggestClaims: vi.fn(async () => []),
      },
    })

    render(<OBFoundDen onChoose={onChoose} />)

    expect(((await screen.findByRole('radio', { name: /new environment/i })) as HTMLInputElement)
      .disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /choose workspaces/i }))
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith({ mode: 'new', claimEnvId: null }))
  })

  it('reveals the new-environment choice when suggestClaims rejects', async () => {
    installDotdenTestApi({
      environment: {
        suggestClaims: vi.fn(async () => {
          throw new Error('claim scan failed')
        }),
      },
    })

    render(<OBFoundDen onChoose={vi.fn()} />)

    expect((await screen.findByRole('alert')).textContent).toContain('claim scan failed')
    expect((screen.getByRole('radio', { name: /new environment/i }) as HTMLInputElement).disabled)
      .toBe(false)
    expect(
      (screen.getByRole('button', { name: /choose workspaces/i }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })
})
