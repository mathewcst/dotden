/**
 * os-scope — unit tests for the pure OS Scope model + scope→`.chezmoiignore`
 * translation (issue 1-15).
 *
 * The load-bearing acceptance criteria proven here (the rest are exercised end-to-end
 * against real chezmoi in den-service.e2e.test.ts):
 * - a Folder's Scope is inherited by its children;
 * - a child can NARROW its Scope but cannot BROADEN beyond the parent's (the invariant,
 *   enforced + property-tested below);
 * - Scope translates to the right per-OS `.chezmoiignore` entry set.
 *
 * The property tests use the codebase's in-house deterministic PRNG (mulberry32, same as
 * apply-planner/sync-engine) rather than a new dependency — the project is package-averse.
 */
import { describe, expect, it } from 'vitest'
import {
  effectiveScope,
  intersectScope,
  narrowScope,
  scopeAppliesOn,
  scopedOutPaths,
} from '../os-scope.js'
import type { Os, Scope } from '../../../../shared/scope.js'

/** The three desktop OSes dotden v1 scopes between, for the randomized property runs. */
const OSES: readonly Os[] = ['darwin', 'linux', 'win32']

describe('intersectScope — the narrowing primitive', () => {
  it('treats null as the universal Scope (intersection identity)', () => {
    expect(intersectScope(null, null)).toBeNull()
    expect(intersectScope(null, ['linux'])).toEqual(['linux'])
    expect(intersectScope(['darwin', 'win32'], null)).toEqual(['darwin', 'win32'])
  })

  it('keeps only OSes present in BOTH concrete Scopes', () => {
    expect(intersectScope(['darwin', 'linux'], ['linux', 'win32'])).toEqual(['linux'])
    // No overlap → the empty Scope ("applies nowhere"), a real representable value.
    expect(intersectScope(['darwin'], ['win32'])).toEqual([])
  })

  it('de-duplicates and is order-stable on the first operand', () => {
    expect(intersectScope(['linux', 'darwin', 'linux'], ['darwin', 'linux'])).toEqual([
      'linux',
      'darwin',
    ])
  })
})

describe('narrowScope / effectiveScope — inheritance is narrowable, never broadenable', () => {
  it('a child inherits the parent Scope when it declares none (null)', () => {
    expect(narrowScope(['darwin'], null)).toEqual(['darwin'])
    expect(effectiveScope([['darwin', 'linux'], null])).toEqual(['darwin', 'linux'])
  })

  it('a child can NARROW within the parent Scope', () => {
    // Parent = mac+linux, child asks for linux only → linux only.
    expect(narrowScope(['darwin', 'linux'], ['linux'])).toEqual(['linux'])
  })

  it('a child can NEVER broaden beyond the parent Scope (the invariant)', () => {
    // Parent = mac-only; child "requests" linux too → linux is clamped away, mac stays out.
    expect(narrowScope(['darwin'], ['linux'])).toEqual([])
    // Parent = mac-only; child requests mac+win → only mac survives (win is not the parent's).
    expect(narrowScope(['darwin'], ['darwin', 'win32'])).toEqual(['darwin'])
  })

  it('folds inheritance across arbitrary nesting depth', () => {
    // Workspace(all) → Folder(mac+linux) → Subfolder(linux+win) → File(linux) = linux.
    expect(effectiveScope([null, ['darwin', 'linux'], ['linux', 'win32'], ['linux']])).toEqual([
      'linux',
    ])
    // A Windows-only Folder with a Linux-only child → applies NOWHERE (empty, not an error).
    expect(effectiveScope([['win32'], ['linux']])).toEqual([])
  })

  it('an all-null chain is the universal Scope', () => {
    expect(effectiveScope([null, null])).toBeNull()
    expect(effectiveScope([])).toBeNull()
  })

  // The invariant as a property: for ANY parent + child Scope, the child's effective Scope
  // is a SUBSET of the parent — it can never contain an OS the parent lacks (never broadens).
  it('property: an effective child Scope is always a subset of its parent Scope', () => {
    let broadenedSeen = 0
    for (let seed = 0; seed < 500; seed++) {
      const rng = mulberry32(seed)
      const parent = randomScope(rng)
      const child = randomScope(rng)
      const effective = narrowScope(parent, child)
      for (const os of OSES) {
        if (scopeAppliesOn(effective, os)) {
          // Present in the result ⇒ present in BOTH inputs (a true intersection, never a widen).
          expect(scopeAppliesOn(parent, os)).toBe(true)
          expect(scopeAppliesOn(child, os)).toBe(true)
        }
      }
      // Count the cases where the child REQUESTED an OS the parent lacked, to prove the
      // run actually exercised the clamp (the test is not vacuous).
      for (const os of OSES) {
        if (scopeAppliesOn(child, os) && !scopeAppliesOn(parent, os)) broadenedSeen++
      }
    }
    expect(broadenedSeen).toBeGreaterThan(0)
  })
})

describe('scopeAppliesOn — the OS-axis appliesHere predicate', () => {
  it('universal Scope applies on every OS', () => {
    for (const os of OSES) expect(scopeAppliesOn(null, os)).toBe(true)
  })

  it('a concrete Scope applies only on the OSes it lists', () => {
    expect(scopeAppliesOn(['linux'], 'linux')).toBe(true)
    expect(scopeAppliesOn(['linux'], 'darwin')).toBe(false)
    // The empty Scope ("applies nowhere") applies on no OS.
    expect(scopeAppliesOn([], 'linux')).toBe(false)
  })
})

describe('scopedOutPaths — the scope→.chezmoiignore translation', () => {
  it('lists exactly the paths NOT in scope for this OS', () => {
    const ignored = scopedOutPaths(
      [
        { targetPath: '.zshrc', scope: ['linux', 'darwin'] }, // applies on linux → kept
        { targetPath: '.config/powershell/profile.ps1', scope: ['win32'] }, // win-only → ignored
        { targetPath: '.gitconfig', scope: null }, // universal → never ignored
        { targetPath: '.hammerspoon/init.lua', scope: ['darwin'] }, // mac-only → ignored on linux
      ],
      'linux',
    )
    expect(ignored).toEqual(['.config/powershell/profile.ps1', '.hammerspoon/init.lua'])
  })

  it('a universally-scoped path is never ignored', () => {
    expect(scopedOutPaths([{ targetPath: '.zshrc', scope: null }], 'win32')).toEqual([])
  })

  it('de-duplicates repeated paths', () => {
    const ignored = scopedOutPaths(
      [
        { targetPath: '.only-mac', scope: ['darwin'] },
        { targetPath: '.only-mac', scope: ['darwin'] },
      ],
      'linux',
    )
    expect(ignored).toEqual(['.only-mac'])
  })

  // The complement property: a path is ignored on `os` iff its Scope does not apply there.
  it('property: a path is scoped-out iff scopeAppliesOn is false', () => {
    for (let seed = 0; seed < 300; seed++) {
      const rng = mulberry32(seed)
      const scope = randomScope(rng)
      const os = OSES[Math.floor(rng() * OSES.length)]!
      const ignored = scopedOutPaths([{ targetPath: '.p', scope }], os)
      expect(ignored.includes('.p')).toBe(!scopeAppliesOn(scope, os))
    }
  })
})

/** A random Scope: `null` (universal, ~25%) or a random subset of the three desktop OSes. */
function randomScope(rng: () => number): Scope {
  if (rng() < 0.25) return null
  return OSES.filter(() => rng() < 0.5)
}

/** Tiny deterministic PRNG (mulberry32) so the property tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
