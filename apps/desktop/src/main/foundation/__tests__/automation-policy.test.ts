/**
 * AutomationPolicy — the automation ladder gate that DEPENDS on the invariant owners
 * (ADR 0008, issue 1-12).
 *
 * These tests pin the two MVP guarantees ADR 0008 requires of the policy:
 *
 *   1. it gates LEVELS only — Manual never auto-pushes, Auto-sync does; **Commit is
 *      never automatic** (there is no auto-commit decision to gate); **Apply stays
 *      manual** at both MVP rungs (`mayAutoApply` is always false);
 *   2. it never RE-CHECKS an invariant an owner guarantees — `mayAutoApply` consumes the
 *      planner's `blockedReason`/`requiresConfirmation` verdicts (invariants #2 & #4) and
 *      requires an `AppliesHere` witness (invariant #3) rather than re-deriving any of it.
 */
import { describe, expect, it } from 'vitest'
import {
  AutomationPolicy,
  DEFAULT_AUTOMATION_LEVEL,
  SELECTABLE_AUTOMATION_LEVELS,
  isSelectableAutomationLevel,
  type AutoApplyCandidate,
  type AutomationLevel,
} from '../automation-policy.js'
import { ApplicabilityResolver, isAppliesHere } from '../applicability-resolver.js'
import { planIncoming, type ApplyChangeKind } from '../apply-planner.js'
import type { EnvironmentEntry, WorkspacesDoc } from '../myenv-store.js'

/** A one-Workspace synced model the test environment subscribes to. */
const WORKSPACES: WorkspacesDoc = {
  workspaces: [{ id: 'personal', label: 'Personal', groups: [], scope: null }],
  placements: [
    { targetPath: '.zshrc', workspaceId: 'personal', groupId: null, scope: null },
    { targetPath: '.gitconfig', workspaceId: 'personal', groupId: null, scope: null },
  ],
}
const ENV: EnvironmentEntry = {
  id: 'env-1',
  label: 'this-mac',
  os: 'linux',
  subscribedWorkspaces: ['personal'],
}

/**
 * Build a REAL {@link AutoApplyCandidate} from the owners — never a hand-rolled object.
 * Mints the witness via the resolver and the plan item via the planner, so the candidate
 * carries genuine invariant verdicts (the only way the policy can be asked at all).
 */
function candidateFor(
  targetPath: string,
  kind: ApplyChangeKind,
  uncommittedEdits: ReadonlySet<string> = new Set(),
): AutoApplyCandidate {
  const result = new ApplicabilityResolver(ENV, WORKSPACES).resolve(targetPath)
  if (!isAppliesHere(result)) throw new Error('test setup: expected an applicable File')
  const plan = planIncoming([{ witness: result, kind }], { uncommittedEdits })
  return { witness: result, item: plan.items[0]! }
}

describe('AutomationPolicy gates LEVELS (ADR 0008, selectable = Manual + Auto-sync + Auto-apply)', () => {
  it('exposes Manual + Auto-sync + Auto-apply and defaults to Manual', () => {
    expect(SELECTABLE_AUTOMATION_LEVELS).toEqual(['manual', 'auto-sync', 'auto-apply'])
    expect(DEFAULT_AUTOMATION_LEVEL).toBe('manual')
    // An unset level constructs as the safest, fully-manual rung.
    expect(new AutomationPolicy().automationLevel).toBe('manual')
  })

  it('accepts the selectable levels through the guard but NOT yolo (issue 2-13)', () => {
    expect(isSelectableAutomationLevel('manual')).toBe(true)
    expect(isSelectableAutomationLevel('auto-sync')).toBe(true)
    expect(isSelectableAutomationLevel('auto-apply')).toBe(true)
    // yolo exists in the type to fix the ladder shape, but is NOT selectable yet.
    expect(isSelectableAutomationLevel('yolo')).toBe(false)
    expect(isSelectableAutomationLevel('nonsense')).toBe(false)
  })

  it('Manual auto-pushes nothing; Auto-sync auto-pushes Commits', () => {
    expect(new AutomationPolicy('manual').mayAutoPush()).toBe(false)
    expect(new AutomationPolicy('auto-sync').mayAutoPush()).toBe(true)
  })

  it('leaves Apply MANUAL at Manual + Auto-sync, but Auto-apply auto-applies a clean item', () => {
    const clean = candidateFor('.zshrc', 'create')
    // Manual/Auto-sync: Apply is a manual review — never auto-applied (CONTEXT.md Auto-sync).
    expect(new AutomationPolicy('manual').mayAutoApply(clean)).toBe(false)
    expect(new AutomationPolicy('auto-sync').mayAutoApply(clean)).toBe(false)
    // Auto-apply (issue 2-12): a clean, ready item applies on its own.
    expect(new AutomationPolicy('auto-apply').mayAutoApply(clean)).toBe(true)
  })

  it('autoAppliesIncoming() is the level-only gate: false ≤ Auto-sync, true ≥ Auto-apply', () => {
    expect(new AutomationPolicy('manual').autoAppliesIncoming()).toBe(false)
    expect(new AutomationPolicy('auto-sync').autoAppliesIncoming()).toBe(false)
    expect(new AutomationPolicy('auto-apply').autoAppliesIncoming()).toBe(true)
    expect(new AutomationPolicy('yolo').autoAppliesIncoming()).toBe(true)
  })

  it('notifies about incoming at the manual rungs (incoming never lands unseen)', () => {
    expect(new AutomationPolicy('manual').shouldNotifyIncoming()).toBe(true)
    expect(new AutomationPolicy('auto-sync').shouldNotifyIncoming()).toBe(true)
  })
})

describe('AutomationPolicy never re-checks an owner invariant (ADR 0008 #2/#3/#4)', () => {
  // These exercise the deferred auto-apply rung (issue 2-12) ONLY to prove the gate is
  // by-construction: even when a level WOULD auto-apply, it defers to the owners' verdicts.
  it('refuses to auto-apply a planner-BLOCKED item (invariant #2, consumed not re-derived)', () => {
    // The planner marks an incoming write to a locally-edited File `uncommitted-edit`.
    const blocked = candidateFor('.zshrc', 'update', new Set(['.zshrc']))
    expect(blocked.item.blockedReason).toBe('uncommitted-edit')
    // Even at auto-apply (2-12), the policy reads that verdict and refuses.
    expect(new AutomationPolicy('auto-apply').mayAutoApply(blocked)).toBe(false)
  })

  it('refuses to auto-apply an unconfirmed incoming DELETION (invariant #4)', () => {
    // Every deletion is requiresConfirmation:true from the planner — never auto-applied.
    const deletion = candidateFor('.gitconfig', 'delete')
    expect(deletion.item.requiresConfirmation).toBe(true)
    expect(new AutomationPolicy('auto-apply').mayAutoApply(deletion)).toBe(false)
    expect(new AutomationPolicy('yolo').mayAutoApply(deletion)).toBe(false)
  })

  it('permits auto-apply (at the 2-12 rung) ONLY for a clean, witness-backed, ready item', () => {
    const clean = candidateFor('.zshrc', 'create')
    expect(clean.item.blockedReason).toBeNull()
    expect(clean.item.requiresConfirmation).toBe(false)
    // The witness is the structural proof of invariant #3 — present because the resolver minted it.
    expect(clean.witness.targetPath).toBe('.zshrc')
    expect(new AutomationPolicy('auto-apply').mayAutoApply(clean)).toBe(true)
  })

  it('never offers an auto-commit decision (Commit is never automatic — ADR 0006)', () => {
    // Structural: the policy surface has mayAutoPush (transport of an already-Committed
    // change) but NO mayAutoCommit — there is nothing to gate, because nothing the user
    // didn't Commit ever syncs. This asserts the absence so a regression that adds one is caught.
    const policy = new AutomationPolicy('yolo') as unknown as Record<string, unknown>
    expect(policy['mayAutoCommit']).toBeUndefined()
  })
})

// A compile-time guard masquerading as a test: the level union must keep these four rungs
// in order, so a refactor that drops/renames one fails the suite loudly.
describe('AutomationLevel shape', () => {
  it('is the four-rung ladder', () => {
    const all: AutomationLevel[] = ['manual', 'auto-sync', 'auto-apply', 'yolo']
    expect(all).toHaveLength(4)
  })
})
