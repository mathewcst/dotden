/**
 * `secrets` slice tests — the commit-time warn + convert flow (issues 2-03/2-05; ADR 0027 Phase 2).
 *
 * The picker's pure selection rules live in `pm-picker.ts` (tested separately); this covers the
 * FLOW transitions — opening the picker for the flagged File and converting + reflecting its
 * Commit — through the store seam, node environment, no DOM.
 */
import { describe, expect, it, vi } from 'vitest'
import { createDenSessionStore } from '../../../shell/lib/den-session-store'
import type { DotdenApi } from '../../../../../shared/ipc-api'
import type { SecretFinding } from '../../../../../main/foundation/secret-scanner'

function finding(file: string): SecretFinding {
  return { file, kind: 'AWS Access Key ID', line: 1, maskedValue: 'AKIA••••N7QX' }
}

function makeApi(over: Record<string, unknown> = {}): DotdenApi {
  return {
    den: {
      detectPasswordManagers: vi.fn(async () => [
        {
          id: 'op',
          label: '1Password',
          cli: 'op',
          available: true,
          installHint: '',
          referenceExample: '',
        },
      ]),
      pmPreference: vi.fn(async () => null),
      convertSecret: vi.fn(async () => ({
        commit: { message: 'Convert .netrc to a Secret reference', pushed: false, queued: false },
      })),
      tree: vi.fn(async () => ({ files: [], workspaces: [] })),
      incomingSummary: vi.fn(async () => ({ items: [], fromEnvironmentLabel: 'laptop' })),
      ...(over.den ?? {}),
    },
  } as unknown as DotdenApi
}

describe('secrets slice — openConvertPicker (step 2)', () => {
  it('detects managers + reads the preference and targets the FIRST flagged File', async () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)
    store.getState().openConvertPicker([finding('.netrc'), finding('.aws/credentials')])
    await vi.waitFor(() => expect(store.getState().secretPicker).not.toBeNull())
    const picker = store.getState().secretPicker!
    expect(picker.targetPath).toBe('.netrc')
    expect(picker.managers).toHaveLength(1)
    expect(api.den.detectPasswordManagers).toHaveBeenCalled()
    expect(api.den.pmPreference).toHaveBeenCalled()
  })

  it('opens nothing when there is no flagged File', async () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)
    store.getState().openConvertPicker([])
    // Let the run() microtask settle, then confirm no picker + no detection.
    await Promise.resolve()
    expect(store.getState().secretPicker).toBeNull()
    expect(api.den.detectPasswordManagers).not.toHaveBeenCalled()
  })
})

describe('secrets slice — convertSecret', () => {
  it('reflects the conversion Commit outcome and reloads the tree', async () => {
    const api = makeApi({
      den: {
        convertSecret: vi.fn(async () => ({
          commit: { message: 'Convert .netrc', pushed: true, queued: false },
        })),
        tree: vi.fn(async () => ({ files: [], workspaces: [] })),
        incomingSummary: vi.fn(async () => ({ items: [], fromEnvironmentLabel: 'laptop' })),
      },
    })
    const store = createDenSessionStore('a', api)
    store
      .getState()
      .convertSecret({ targetPath: '.netrc', manager: 'op', reference: 'op://x' } as never)
    await vi.waitFor(() => expect(store.getState().lastCommitMessage).toBe('Convert .netrc'))
    expect(store.getState().lastCommitPushed).toBe(true)
    expect(api.den.tree).toHaveBeenCalled()
    // pushed → incoming refreshed in the same round-trip.
    expect(api.den.incomingSummary).toHaveBeenCalled()
  })

  it('does NOT clear a standing commit notice (faithful to the old Workspace behavior)', async () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)
    store.setState({ commitNotice: 'Nothing to commit — already matched.' })
    store
      .getState()
      .convertSecret({ targetPath: '.netrc', manager: 'op', reference: 'op://x' } as never)
    await vi.waitFor(() => expect(store.getState().lastCommitMessage).not.toBeNull())
    expect(store.getState().commitNotice).toBe('Nothing to commit — already matched.')
  })
})

describe('secrets slice — setters', () => {
  it('opens and closes the warn step', () => {
    const store = createDenSessionStore('a', makeApi())
    store.getState().setSecretWarn({ findings: [finding('.netrc')], paths: ['.netrc'] })
    expect(store.getState().secretWarn?.paths).toEqual(['.netrc'])
    store.getState().setSecretWarn(null)
    expect(store.getState().secretWarn).toBeNull()
  })
})
