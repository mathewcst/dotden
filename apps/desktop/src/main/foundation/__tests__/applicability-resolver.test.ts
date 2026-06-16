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
    { id: 'personal', label: 'Personal', groups: [], scope: null },
    { id: 'work', label: 'Work', groups: [], scope: null },
  ],
  placements: [
    { targetPath: '.zshrc', workspaceId: 'personal', groupId: null, scope: null },
    { targetPath: '.work-only', workspaceId: 'work', groupId: null, scope: null },
    // A File scoped to win32 only — out of scope on a linux environment (issue 1-15).
    { targetPath: '.windows-only', workspaceId: 'personal', groupId: null, scope: ['win32'] },
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

  it('refuses a File scoped to a DIFFERENT OS (the file.scope matches env.os clause, issue 1-15)', () => {
    // Subscribed to the Workspace, but the File is win32-only and this env is linux — so
    // the OS-applicability axis refuses it even though the access axis passes.
    const resolver = new ApplicabilityResolver(env(['personal']), workspaces)

    const result = resolver.resolve('.windows-only')

    expect(isAppliesHere(result)).toBe(false)
    expect(result).toEqual({
      targetPath: '.windows-only',
      reason: 'out-of-scope',
      workspaceId: 'personal',
    })
  })

  it('mints a witness once the environment IS the File’s scoped OS', () => {
    // The SAME win32-only File DOES apply on a win32 environment (scope matches).
    const winEnv: EnvironmentEntry = {
      id: 'env-w',
      label: 'w',
      os: 'win32',
      subscribedWorkspaces: ['personal'],
    }
    const resolver = new ApplicabilityResolver(winEnv, workspaces)

    expect(isAppliesHere(resolver.resolve('.windows-only'))).toBe(true)
  })

  it('a hand-rolled object can never pass isAppliesHere (the witness is un-forgeable)', () => {
    // A caller cannot reach the private brand symbol, so even an object that looks
    // structurally like the witness is rejected by the guard — this is what makes
    // "act only within subscription" correct-by-construction (ADR 0008).
    const forged = { targetPath: '.zshrc' } as unknown
    expect(isAppliesHere(forged as never)).toBe(false)
  })
})
