/**
 * subscription-ignore renderer — the pure shape of the per-environment subscription
 * `.chezmoiignore` template (issue 1-13). The real-chezmoi materialization (two envs,
 * different subscriptions, one repo) is proven in the den-service e2e; here we assert the
 * generated template's invariants without shelling out.
 */
import { describe, expect, it } from 'vitest'
import {
  IGNORE_EVERYTHING_RULE,
  DEN_IGNORE_RULE,
  renderSubscriptionIgnore,
} from '../subscription-ignore.js'

describe('renderSubscriptionIgnore', () => {
  it('always emits the `.dotden/` rule first so dotden metadata is never applied (ADR 0024)', () => {
    const out = renderSubscriptionIgnore({ osScopedOutPaths: [] })
    const firstRule = out
      .split('\n')
      .find((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('{{'))
    expect(firstRule).toBe(DEN_IGNORE_RULE)
  })

  it('folds the per-OS scoped-out paths in as static lines (issue 1-15 + 1-13 share one file)', () => {
    const out = renderSubscriptionIgnore({
      osScopedOutPaths: ['.config/win-only.conf', '.macos-only'],
    })
    expect(out).toContain('.config/win-only.conf')
    expect(out).toContain('.macos-only')
    // The static OS lines sit ABOVE the dynamic subscription template block.
    expect(out.indexOf('.macos-only')).toBeLessThan(out.indexOf('{{- range $placements'))
  })

  it('self-identifies via dotden_env_id and joins the synced registry (the issue-13 seam)', () => {
    const out = renderSubscriptionIgnore({ osScopedOutPaths: [] })
    expect(out).toContain('.dotden_env_id')
    // Reads BOTH synced docs through chezmoi include+fromJson (the spike-proven functions).
    expect(out).toContain('include ".dotden/environments.json"')
    expect(out).toContain('include ".dotden/workspaces.json"')
    expect(out).toContain('fromJson')
  })

  it('guards a MISSING dotden_env_id key with hasKey (unregistered env never crashes apply)', () => {
    const out = renderSubscriptionIgnore({ osScopedOutPaths: [] })
    // A cloned-but-unclaimed env may have no `dotden_env_id` at all; hasKey degrades it to ""
    // → no matching entry → ignore-everything, never chezmoi's "map has no entry" error.
    expect(out).toContain('hasKey . "dotden_env_id"')
  })

  it('degrades a missing/empty subscription to ignore-everything (guard b: fail-safe, not apply-all)', () => {
    const out = renderSubscriptionIgnore({ osScopedOutPaths: [] })
    // The fail-safe writes a literal `*` (ignore the whole tree) when len(subscribed)==0.
    expect(out).toContain('{{- if eq (len $subscribed) 0 }}')
    const lines = out.split('\n')
    const guardIndex = lines.findIndex((l) => l.includes('len $subscribed) 0'))
    // The very next emitted rule is the ignore-everything `*` (never an error, never apply-all).
    expect(lines[guardIndex + 1]).toBe(IGNORE_EVERYTHING_RULE)
  })

  it('ignores exactly the un-subscribed Workspaces’ Files (has/not over placements)', () => {
    const out = renderSubscriptionIgnore({ osScopedOutPaths: [] })
    // For each placement NOT in the subscribed set, emit its targetPath (ignore it here).
    expect(out).toContain('{{- if not (has .workspaceId $subscribed) }}')
    expect(out).toContain('{{ .targetPath }}')
  })

  it('is newline-terminated and re-renders byte-stable for the same input (no git churn)', () => {
    const input = { osScopedOutPaths: ['.x'] }
    const a = renderSubscriptionIgnore(input)
    const b = renderSubscriptionIgnore(input)
    expect(a).toBe(b)
    expect(a.endsWith('\n')).toBe(true)
  })
})
