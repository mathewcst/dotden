// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDotdenTestApi } from '@/test/dotden-test-api'
import type { ConnectResult } from '@shared/remote'
import { ReturningShell } from '../ReturningShell'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function connectResult(repositoryKind: ConnectResult['repositoryKind']): ConnectResult {
  return { gitCommand: 'git', sourceDir: '/tmp/source', repositoryKind }
}

describe('ReturningShell connect handoff', () => {
  it('routes greenfield repos back to first-run onboarding', async () => {
    const onNewDen = vi.fn()
    installDotdenTestApi({
      remote: {
        preflight: vi.fn(async () => ({ reachable: true, gitCommand: 'git' })),
        connect: vi.fn(async () => connectResult('greenfield')),
      },
    })

    render(<ReturningShell onComplete={vi.fn()} onNewDen={onNewDen} />)
    fireEvent.change(screen.getByRole('textbox', { name: /repo url/i }), {
      target: { value: 'https://github.com/acme/dotfiles.git' },
    })
    fireEvent.click(screen.getByRole('button', { name: /connect/i }))

    await waitFor(() => expect(onNewDen).toHaveBeenCalledTimes(1))
  })

  it('advances dotden repos to the found-den step', async () => {
    installDotdenTestApi({
      remote: {
        preflight: vi.fn(async () => ({ reachable: true, gitCommand: 'git' })),
        connect: vi.fn(async () => connectResult('dotden')),
      },
      environment: {
        suggestClaims: vi.fn(async () => []),
      },
    })

    render(<ReturningShell onComplete={vi.fn()} onNewDen={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: /repo url/i }), {
      target: { value: 'https://github.com/acme/dotfiles.git' },
    })
    fireEvent.click(screen.getByRole('button', { name: /connect/i }))

    expect(await screen.findByRole('heading', { name: /find your den/i })).toBeTruthy()
  })

  it('leaves foreign repos on a non-busy connect step', async () => {
    installDotdenTestApi({
      remote: {
        preflight: vi.fn(async () => ({ reachable: true, gitCommand: 'git' })),
        connect: vi.fn(async () => connectResult('foreign-chezmoi')),
      },
    })

    render(<ReturningShell onComplete={vi.fn()} onNewDen={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: /repo url/i }), {
      target: { value: 'https://github.com/acme/dotfiles.git' },
    })
    fireEvent.click(screen.getByRole('button', { name: /connect/i }))

    expect((await screen.findByRole('alert')).textContent).toContain('already has a chezmoi setup')
    expect((screen.getByRole('button', { name: /retry/i }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })
})
