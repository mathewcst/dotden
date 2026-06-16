/**
 * ApplicabilityResolver unit tests — invariant #3's owner (ADR 0008).
 *
 * Asserts the resolver mints an AppliesHere witness exactly when a File is placed in
 * a subscribed Workspace, refuses with a typed reason otherwise, and — the
 * load-bearing structural property — that the witness is UN-FORGEABLE: a caller
 * cannot hand-roll one and pass `isAppliesHere`, so `ApplyPlanner`/`SyncEngine` can
 * only act on Files the resolver vouched for.
 */
import { describe, expect, it } from 'vitest'
import { ApplicabilityResolver, isAppliesHere } from '../applicability-resolver.js'
import type { EnvironmentEntry, WorkspacesDoc } from '../myenv-store.js'

const workspaces: WorkspacesDoc = {
  workspaces: [
    { id: 'personal', label: 'Personal', groups: [] },
    { id: 'work', label: 'Work', groups: [] },
  ],
  placements: [
    { targetPath: '.zshrc', workspaceId: 'personal', groupId: null },
    { targetPath: '.work-only', workspaceId: 'work', groupId: null },
  ],
}

function env(subscribedWorkspaces: string[]): EnvironmentEntry {
  return { id: 'env-a', label: 'a', os: 'linux', subscribedWorkspaces }
}

describe('ApplicabilityResolver', () => {
  it('mints a witness for a File placed in a subscribed Workspace', () => {
    const resolver = new ApplicabilityResolver(env(['personal']), workspaces)

    const result = resolver.resolve('.zshrc')

    expect(isAppliesHere(result)).toBe(true)
    if (isAppliesHere(result)) expect(result.targetPath).toBe('.zshrc')
  })

  it('refuses a File in a non-subscribed Workspace with a typed reason', () => {
    const resolver = new ApplicabilityResolver(env(['personal']), workspaces)

    const result = resolver.resolve('.work-only')

    expect(isAppliesHere(result)).toBe(false)
    expect(result).toEqual({
      targetPath: '.work-only',
      reason: 'not-subscribed',
      workspaceId: 'work',
    })
  })

  it('refuses an unplaced File rather than guessing', () => {
    const resolver = new ApplicabilityResolver(env(['personal', 'work']), workspaces)

    const result = resolver.resolve('.never-placed')

    expect(result).toEqual({ targetPath: '.never-placed', reason: 'unplaced' })
  })

  it('a hand-rolled object can never pass isAppliesHere (the witness is un-forgeable)', () => {
    // A caller cannot reach the private brand symbol, so even an object that looks
    // structurally like the witness is rejected by the guard — this is what makes
    // "act only within subscription" correct-by-construction (ADR 0008).
    const forged = { targetPath: '.zshrc' } as unknown
    expect(isAppliesHere(forged as never)).toBe(false)
  })
})
