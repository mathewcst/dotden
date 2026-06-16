/**
 * Returning-environment step model (issue 1-13) — the second-environment journey's rail
 * (design: returning-environment.md).
 *
 * The flow reuses the onboarding shell unchanged (design's "Wizard, Part A"): **Connect**
 * (paste the SAME Remote URL + preflight, reused from onboarding's `OBConnectUrl`) → **Find
 * your Den** (the detected-repo card + new/returning *identity* claim choice) → **Choose
 * Workspaces** (the subscription checklist, default all) → hand off to **Review & Apply** (the
 * app's Apply surface — that step has NO shell, so it stays `upcoming` in every rail variant).
 *
 * Distinguished from the first-run flow AFTER clone by repo content (ADR 0020): an empty repo
 * is first-run Discover; a repo that already has a Den is THIS returning flow.
 */

/** The ordered returning-flow wizard steps. `review` is the handoff to the app (no shell). */
export type ReturningStep = 'connect' | 'found-den' | 'workspaces' | 'review'

/**
 * The rail steps, in order, with the labels shown in the `ReturningMenu` rail.
 *
 * All four show in the rail; `review` is rendered as the always-`upcoming` handoff item (the
 * app's Review & Apply surface has no wizard shell — design's "stays upcoming in every variant").
 */
export const RETURNING_RAIL_STEPS: readonly { step: ReturningStep; label: string }[] = [
  { step: 'connect', label: 'Connect' },
  { step: 'found-den', label: 'Find your Den' },
  { step: 'workspaces', label: 'Choose Workspaces' },
  { step: 'review', label: 'Review & Apply' },
]

/** Linear order used to advance the flow. */
export const RETURNING_STEP_ORDER: readonly ReturningStep[] = [
  'connect',
  'found-den',
  'workspaces',
  'review',
]

/** The next step after `step`, or `step` itself when already at the end. */
export function nextReturningStep(step: ReturningStep): ReturningStep {
  const index = RETURNING_STEP_ORDER.indexOf(step)
  return RETURNING_STEP_ORDER[Math.min(index + 1, RETURNING_STEP_ORDER.length - 1)] ?? step
}
