/**
 * Onboarding step model (issue 1-06) — the single source of truth for the V1-Lean
 * 7-screen first-run flow and its 6-item step rail (design: onboarding.md).
 *
 * V1-Lean flow (ADR 0020): Welcome → Create your repo → Connect (paste URL +
 * preflight) → Discover configs → First commit → Auto-sync → Done. The rail shows
 * six numbered steps; `done` is the terminal variant the rail collapses into.
 *
 * Steps 2–3 (CreateRepo / ConnectURL) replaced the deferred Connect-GitHub /
 * Create-Den convenience screens but kept the rail architecture unchanged.
 */

/** The ordered onboarding steps. `done` is the terminal screen, not a rail item. */
export type OnboardingStep =
  | 'welcome'
  | 'create-repo'
  | 'connect'
  | 'discover'
  | 'commit'
  | 'auto-sync'
  | 'done'

/**
 * The six rail steps, in order, with the labels shown in the `OnboardingMenu` rail.
 *
 * `done` is intentionally absent: per the design spec the rail has six items and a
 * separate `Step=Done` state, so the rail renders these six and marks them all
 * complete when the flow reaches `done`.
 */
export const RAIL_STEPS: readonly { step: OnboardingStep; label: string }[] = [
  { step: 'welcome', label: 'Welcome' },
  { step: 'create-repo', label: 'Create your repo' },
  { step: 'connect', label: 'Connect' },
  { step: 'discover', label: 'Discover configs' },
  { step: 'commit', label: 'First commit' },
  { step: 'auto-sync', label: 'Auto-sync' },
]

/** Linear order of every step including `done`, used to advance the flow. */
export const STEP_ORDER: readonly OnboardingStep[] = [
  'welcome',
  'create-repo',
  'connect',
  'discover',
  'commit',
  'auto-sync',
  'done',
]

/** The next step after `step`, or `step` itself when already at the end. */
export function nextStep(step: OnboardingStep): OnboardingStep {
  const index = STEP_ORDER.indexOf(step)
  return STEP_ORDER[Math.min(index + 1, STEP_ORDER.length - 1)] ?? step
}
