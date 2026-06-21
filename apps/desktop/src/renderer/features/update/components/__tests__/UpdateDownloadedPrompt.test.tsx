// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDotdenTestApi } from '@/test/dotden-test-api'
import type { DownloadedUpdate } from '@shared/app-info'
import { UpdateDownloadedPrompt } from '../UpdateDownloadedPrompt'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('UpdateDownloadedPrompt', () => {
  it('surfaces a downloaded update, allows deferral, and restarts on command', async () => {
    const events: { listener?: (update: DownloadedUpdate) => void } = {}
    const quitAndInstallUpdate = vi.fn(async () => undefined)
    installDotdenTestApi({
      app: {
        onUpdateDownloaded: vi.fn((nextListener) => {
          events.listener = nextListener
          return () => {
            events.listener = undefined
          }
        }),
        quitAndInstallUpdate,
      },
    })

    render(<UpdateDownloadedPrompt />)
    events.listener?.({
      version: '1.2.3',
      releaseName: 'dotden 1.2.3',
      releaseDate: '2026-06-21T00:00:00.000Z',
    })

    expect(await screen.findByText('Update downloaded')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /later/i }))
    await waitFor(() => expect(screen.queryByText('Update downloaded')).toBeNull())

    events.listener?.({
      version: '1.2.3',
      releaseName: 'dotden 1.2.3',
      releaseDate: '2026-06-21T00:00:00.000Z',
    })
    fireEvent.click(await screen.findByRole('button', { name: /restart now/i }))

    await waitFor(() => expect(quitAndInstallUpdate).toHaveBeenCalledTimes(1))
  })
})
