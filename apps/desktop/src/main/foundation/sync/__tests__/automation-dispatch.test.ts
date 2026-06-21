import { describe, expect, it, vi } from 'vitest'
import type { AutoApplyResult, YoloSyncResult } from '../../../../shared/den.js'
import { dispatchIncomingAutomation, type AutomationDispatchPorts } from '../automation-dispatch.js'

function autoApply(overrides: Partial<AutoApplyResult> = {}): AutoApplyResult {
  return {
    autoApplyEnabled: true,
    applied: { results: [], applied: [], failed: [] },
    needsReview: [],
    ...overrides,
  }
}

function yolo(overrides: Partial<YoloSyncResult> = {}): YoloSyncResult {
  return {
    autoCommitEnabled: true,
    autoCommit: { committedPaths: [], skipped: [], commit: null },
    push: null,
    conflicts: [],
    autoMerged: true,
    autoApplied: autoApply(),
    ...overrides,
  }
}

function setup(
  level: 'manual' | 'auto-sync' | 'auto-apply' | 'yolo',
  result: AutoApplyResult | YoloSyncResult,
) {
  const actions: string[] = []
  const den = {
    autoApplyIncoming: vi.fn(async () => result as AutoApplyResult),
    yoloSync: vi.fn(async () => result as YoloSyncResult),
  }
  const ports = {
    readLevel: vi.fn(async () => level),
    den: vi.fn(async () => den),
    notifyIncoming: vi.fn(() => actions.push('notifyIncoming')),
    notifyConflict: vi.fn(() => actions.push('notifyConflict')),
    notifyApplied: vi.fn((count: number) => actions.push(`notifyApplied:${count}`)),
    pushAction: vi.fn((action) => actions.push(`push:${action}`)),
  } satisfies AutomationDispatchPorts
  return { actions, den, ports }
}

describe('dispatchIncomingAutomation', () => {
  it('keeps manual and auto-sync as incoming review prompts', async () => {
    const manual = setup('manual', autoApply())
    await dispatchIncomingAutomation('trace', manual.ports)
    expect(manual.actions).toEqual(['notifyIncoming', 'push:refresh'])
    expect(manual.den.autoApplyIncoming).not.toHaveBeenCalled()

    const autoSync = setup('auto-sync', autoApply())
    await dispatchIncomingAutomation('trace', autoSync.ports)
    expect(autoSync.actions).toEqual(['notifyIncoming', 'push:refresh'])
    expect(autoSync.den.autoApplyIncoming).not.toHaveBeenCalled()
  })

  it('auto-applies clean incoming and still opens review for held items', async () => {
    const slice = setup(
      'auto-apply',
      autoApply({
        applied: { results: [], applied: ['.zshrc'], failed: [] },
        needsReview: [{ targetPath: '.gitconfig', reason: 'needs-confirmation' }],
      }),
    )

    await dispatchIncomingAutomation('trace', slice.ports)

    expect(slice.den.autoApplyIncoming).toHaveBeenCalledWith('trace')
    expect(slice.actions).toEqual([
      'push:refresh',
      'notifyApplied:1',
      'notifyIncoming',
      'push:review',
    ])
  })

  it('routes YOLO conflicts to the resolver', async () => {
    const slice = setup(
      'yolo',
      yolo({
        conflicts: [
          { targetPath: '.zshrc', workspaceId: 'default', current: '', incoming: '', both: '' },
        ],
        autoMerged: false,
      }),
    )

    await dispatchIncomingAutomation('trace', slice.ports)

    expect(slice.den.yoloSync).toHaveBeenCalledWith('trace')
    expect(slice.actions).toEqual(['push:refresh', 'notifyConflict', 'push:resolve'])
  })
})
