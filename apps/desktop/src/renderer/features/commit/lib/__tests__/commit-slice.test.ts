/**
 * `commit` slice tests — the outbound Commit flow (ADR 0006; ADR 0027, Phase 2).
 *
 * The PRD's load-bearing slice: the scan→warn→Commit→record transitions are exactly what used to
 * be untestable inside `Workspace.tsx`. Tested here through the store seam (build a store with a
 * fake API, dispatch, assert state) in vitest's node environment — no React, no DOM.
 */
import { describe, expect, it, vi } from 'vitest'
import { createDenSessionStore } from '../../../shell/lib/den-session-store'
import type { DotdenApi } from '../../../../../shared/ipc-api'
import type { SecretFinding } from '../../../../../main/foundation/secret-scanner'

function finding(file: string): SecretFinding {
  return { file, kind: 'AWS Access Key ID', line: 1, maskedValue: 'AKIA••••N7QX' }
}

/** Default commit/sync result fields, overridable per test. */
function makeApi(over: Record<string, unknown> = {}): DotdenApi {
  return {
    den: {
      scanCommit: vi.fn(async () => [] as SecretFinding[]),
      commit: vi.fn(async () => ({
        noop: false,
        message: 'Update .zshrc',
        pushed: false,
        queued: false,
      })),
      tree: vi.fn(async () => ({ files: [], workspaces: [] })),
      incomingSummary: vi.fn(async () => ({ items: [], fromEnvironmentLabel: 'laptop' })),
      allowlistSecret: vi.fn(async () => ({})),
      syncPush: vi.fn(async () => ({ pushed: true, queued: false })),
      pushPending: vi.fn(async () => false),
      ...(over.den ?? {}),
    },
  } as unknown as DotdenApi
}

describe('commit slice — commitWithScan (scan-then-warn, ADR 0001)', () => {
  it('opens the amber warn step and does NOT Commit when the scan flags a secret', async () => {
    const api = makeApi({
      den: {
        scanCommit: vi.fn(async () => [finding('.aws/credentials')]),
        commit: vi.fn(async () => ({ noop: false, message: 'x', pushed: false, queued: false })),
        tree: vi.fn(async () => ({ files: [], workspaces: [] })),
      },
    })
    const store = createDenSessionStore('a', api)
    await store.getState().commitWithScan(['.aws/credentials'])
    expect(store.getState().secretWarn).toEqual({
      findings: [finding('.aws/credentials')],
      paths: ['.aws/credentials'],
    })
    expect(api.den.commit).not.toHaveBeenCalled()
  })

  it('Commits immediately on a clean scan and records the message + push flag', async () => {
    const api = makeApi({
      den: {
        scanCommit: vi.fn(async () => []),
        commit: vi.fn(async () => ({
          noop: false,
          message: 'Update .zshrc',
          pushed: true,
          queued: false,
        })),
        tree: vi.fn(async () => ({ files: [], workspaces: [] })),
        incomingSummary: vi.fn(async () => ({ items: [], fromEnvironmentLabel: 'laptop' })),
      },
    })
    const store = createDenSessionStore('a', api)
    await store.getState().commitWithScan(['.zshrc'])
    expect(store.getState().secretWarn).toBeNull()
    expect(api.den.commit).toHaveBeenCalledWith(['.zshrc'])
    expect(store.getState().lastCommitMessage).toBe('Update .zshrc')
    expect(store.getState().lastCommitPushed).toBe(true)
    // An auto-pushed Commit refreshes incoming as part of the round-trip.
    expect(api.den.incomingSummary).toHaveBeenCalled()
  })

  it('does nothing for an empty path set', async () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)
    await store.getState().commitWithScan([])
    expect(api.den.scanCommit).not.toHaveBeenCalled()
    expect(api.den.commit).not.toHaveBeenCalled()
  })
})

describe('commit slice — recordCommit no-op (honest neutral notice, not an error)', () => {
  it('shows the "nothing to commit" notice and clears the last message on a no-op', async () => {
    const api = makeApi({
      den: {
        scanCommit: vi.fn(async () => []),
        commit: vi.fn(async () => ({ noop: true, message: '', pushed: false, queued: false })),
        tree: vi.fn(async () => ({ files: [], workspaces: [] })),
      },
    })
    const store = createDenSessionStore('a', api)
    await store.getState().commitWithScan(['.zshrc'])
    expect(store.getState().commitNotice).toMatch(/nothing to commit/i)
    expect(store.getState().lastCommitMessage).toBeNull()
    expect(store.getState().error).toBeNull()
  })
})

describe('commit slice — commitAnyway (issue 2-04)', () => {
  it('allowlists each finding FIRST when "don\'t warn again" is set, then Commits', async () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)
    const findings = [finding('.netrc'), finding('.aws/credentials')]
    await store.getState().commitAnyway(findings, ['.netrc', '.aws/credentials'], true)
    expect(api.den.allowlistSecret).toHaveBeenCalledTimes(2)
    expect(api.den.commit).toHaveBeenCalledWith(['.netrc', '.aws/credentials'])
  })

  it('does NOT allowlist when the box is unticked, but still Commits', async () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)
    await store.getState().commitAnyway([finding('.netrc')], ['.netrc'], false)
    expect(api.den.allowlistSecret).not.toHaveBeenCalled()
    expect(api.den.commit).toHaveBeenCalledWith(['.netrc'])
  })
})

describe('commit slice — push ("Sync now")', () => {
  it('reflects the queued/pushed flags and refreshes incoming', async () => {
    const api = makeApi({
      den: {
        syncPush: vi.fn(async () => ({ pushed: false, queued: true })),
        incomingSummary: vi.fn(async () => ({ items: [], fromEnvironmentLabel: 'laptop' })),
        pushPending: vi.fn(async () => true),
      },
    })
    const store = createDenSessionStore('a', api)
    store.getState().push()
    await vi.waitFor(() => expect(api.den.syncPush).toHaveBeenCalled())
    expect(store.getState().pushQueued).toBe(true)
    expect(store.getState().lastCommitPushed).toBe(false)
    expect(api.den.incomingSummary).toHaveBeenCalled()
  })
})

describe('commit slice — refreshPushQueued (soft, never breaks the view)', () => {
  it('updates the queue flag from the main-process truth', async () => {
    const api = makeApi({ den: { pushPending: vi.fn(async () => true) } })
    const store = createDenSessionStore('a', api)
    await store.getState().refreshPushQueued()
    expect(store.getState().pushQueued).toBe(true)
  })

  it('leaves the flag unchanged on a read error (no flicker)', async () => {
    const api = makeApi({
      den: {
        pushPending: vi.fn(async () => {
          throw new Error('x')
        }),
      },
    })
    const store = createDenSessionStore('a', api)
    await store.getState().refreshPushQueued()
    expect(store.getState().pushQueued).toBe(false)
  })
})
