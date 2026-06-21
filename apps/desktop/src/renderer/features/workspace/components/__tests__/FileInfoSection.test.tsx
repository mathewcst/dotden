// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DenSessionProvider } from '@/app/providers/DenSessionProvider'
import { useDenSession } from '@/den-session'
import { installDotdenTestApi } from '@/test/dotden-test-api'
import { FileInfoSection } from '../FileInfoSection'
import type { FileVersion } from '@shared/history'
import type { SecretFinding } from '@shared/secrets'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('FileInfoSection', () => {
  it('shows backend-backed secret, history, and environment details for the selected File', async () => {
    const scanCommit = vi.fn(async () => [finding('.zshrc')])
    const fileHistory = vi.fn(async () => [version('abc1234'), version('def5678')])
    const list = vi.fn(async () => [
      {
        id: 'local',
        label: 'Laptop',
        os: 'linux',
        subscribedWorkspaces: ['personal'],
        isSelf: true,
        attribution: {
          lastActivityAt: '2026-06-21T10:30:00-03:00',
          lastSubject: 'Update shell',
          lastAuthorName: 'Laptop',
          lastAuthorEmail: 'laptop@example.com',
          commitCount: 3,
        },
      },
    ])
    installDotdenTestApi({
      den: {
        tree: vi.fn(async () => ({
          files: [
            {
              targetPath: '.zshrc',
              workspaceId: 'personal',
              groupId: null,
              status: 'modified' as const,
              muted: false,
              scope: null,
            },
          ],
          workspaces: [{ id: 'personal', label: 'Personal', groups: [], scope: null }],
        })),
        diff: vi.fn(async () => ''),
        scanCommit,
        fileHistory,
      },
      environment: { list },
    })

    render(
      <DenSessionProvider role="a">
        <SeedSelection targetPath=".zshrc" />
        <FileInfoSection />
      </DenSessionProvider>,
    )

    expect(await screen.findByText('1 warning')).toBeTruthy()
    expect(screen.getAllByText('Update shell')).toHaveLength(2)
    expect(screen.getByText(/Laptop/)).toBeTruthy()
    expect(screen.getByText(/This environment/)).toBeTruthy()
    await waitFor(() => expect(scanCommit).toHaveBeenCalledWith(['.zshrc']))
    expect(fileHistory).toHaveBeenCalledWith('.zshrc')
    expect(list).toHaveBeenCalled()
  })
})

function SeedSelection({ targetPath }: { readonly targetPath: string }) {
  const reloadTree = useDenSession((s) => s.reloadTree)
  const selectFile = useDenSession((s) => s.selectFile)

  useEffect(() => {
    let active = true
    async function seed() {
      await reloadTree()
      if (active) await selectFile(targetPath)
    }
    void seed()
    return () => {
      active = false
    }
  }, [reloadTree, selectFile, targetPath])

  return null
}

function finding(file: string): SecretFinding {
  return {
    file,
    kind: 'Generic API Key or Secret',
    line: 2,
    maskedValue: 'abc...xyz',
  }
}

function version(shortSha: string): FileVersion {
  return {
    sha: `${shortSha}000000000000000000000000000000000`,
    shortSha,
    message: 'Update shell',
    authorName: 'Laptop',
    authorEmail: 'laptop@example.com',
    committedAt: '2026-06-21T10:30:00-03:00',
    current: shortSha === 'abc1234',
  }
}
