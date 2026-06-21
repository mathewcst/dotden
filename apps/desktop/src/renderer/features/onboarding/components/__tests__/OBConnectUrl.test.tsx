// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDotdenTestApi } from '@/test/dotden-test-api'
import { OBConnectUrl } from '../OBConnectUrl'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OBConnectUrl liveness', () => {
  it('leaves a foreign chezmoi repo non-busy and retryable', async () => {
    const onConnected = vi.fn()
    installDotdenTestApi({
      remote: {
        preflight: vi.fn(async () => ({ reachable: true, gitCommand: 'git' })),
        connect: vi.fn(async () => ({
          gitCommand: 'git',
          sourceDir: '/tmp/source',
          repositoryKind: 'foreign-chezmoi' as const,
        })),
      },
    })

    render(<OBConnectUrl onConnected={onConnected} />)
    fireEvent.change(screen.getByRole('textbox', { name: /repo url/i }), {
      target: { value: 'https://github.com/acme/dotfiles.git' },
    })
    fireEvent.click(screen.getByRole('button', { name: /connect/i }))

    expect((await screen.findByRole('alert')).textContent).toContain('already has a chezmoi setup')
    expect((screen.getByRole('textbox', { name: /repo url/i }) as HTMLInputElement).disabled).toBe(
      false,
    )
    expect((screen.getByRole('button', { name: /retry/i }) as HTMLButtonElement).disabled).toBe(
      false,
    )
    expect(onConnected).not.toHaveBeenCalled()
  })

  it.each(['greenfield', 'dotden'] as const)('hands off reachable %s repos once', async (kind) => {
    const onConnected = vi.fn()
    installDotdenTestApi({
      remote: {
        preflight: vi.fn(async () => ({ reachable: true, gitCommand: 'git' })),
        connect: vi.fn(async () => ({
          gitCommand: 'git',
          sourceDir: '/tmp/source',
          repositoryKind: kind,
        })),
      },
    })

    render(<OBConnectUrl onConnected={onConnected} />)
    fireEvent.change(screen.getByRole('textbox', { name: /repo url/i }), {
      target: { value: 'https://github.com/acme/dotfiles.git' },
    })
    fireEvent.click(screen.getByRole('button', { name: /connect/i }))

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
    expect(onConnected.mock.calls[0]?.[0].repositoryKind).toBe(kind)
  })

  it('surfaces sanitized clone/init diagnostics after preflight passes', async () => {
    const onConnected = vi.fn()
    const error = Object.assign(new Error('Could not initialize from github.com.'), {
      diagnostics: {
        host: 'github.com',
        scheme: 'https',
        exitCode: 128,
        stderr: 'fatal: repository not found',
        help: 'Could not initialize from github.com. Check access, then retry.',
      },
    })
    installDotdenTestApi({
      remote: {
        preflight: vi.fn(async () => ({ reachable: true, gitCommand: 'git' })),
        connect: vi.fn(async () => {
          throw error
        }),
      },
    })

    render(<OBConnectUrl onConnected={onConnected} />)
    fireEvent.change(screen.getByRole('textbox', { name: /repo url/i }), {
      target: { value: 'https://github.com/acme/private.git' },
    })
    fireEvent.click(screen.getByRole('button', { name: /connect/i }))

    expect(await screen.findByText(/could not initialize from github.com/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /details/i }))
    expect(screen.getByText(/stderr: fatal: repository not found/i)).toBeTruthy()
    expect(onConnected).not.toHaveBeenCalled()
  })

  it('cancels the active remote trace when the user cancels preflight', async () => {
    const cancel = vi.fn(async (traceId: string) => traceId.length > 0)
    installDotdenTestApi({
      remote: {
        preflight: vi.fn(() => new Promise<never>(() => {})),
        cancel,
      },
    })

    render(<OBConnectUrl onConnected={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: /repo url/i }), {
      target: { value: 'https://github.com/acme/private.git' },
    })
    fireEvent.click(screen.getByRole('button', { name: /connect/i }))
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(cancel).toHaveBeenCalledWith(expect.any(String)))
    const [traceId] = cancel.mock.calls[0] as [string]
    expect(traceId).not.toHaveLength(0)
  })
})
