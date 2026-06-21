/**
 * os-scope — the pure OS Scope model + the scope→`.chezmoiignore` translation (issue 1-15).
 *
 * **Scope** is "the set of OSes where a File or Folder applies" (CONTEXT.md "Scope").
 * It is the OS-applicability axis, mapped faithfully (ADR 0003) onto chezmoi's native
 * per-OS **`.chezmoiignore`** rules: a path scoped to other operating systems is emitted
 * as a `.chezmoiignore` entry on this environment, so `chezmoi apply` skips it here.
 *
 * This module is the SOLE place two pieces of OS-Scope logic live, kept pure and
 * Electron-free (ADR 0023) so they are exhaustively unit-testable in plain Node:
 *
 * 1. **Inheritance (narrowable, never broadenable).** A Folder's Scope is inherited by
 *    its children; a child may **restrict further but never widen beyond its parent's
 *    Scope** (CONTEXT.md "Scope"; ADR 0005 "its OS Scope matches"). The narrowing is a
 *    **set intersection**, which makes "broaden past the parent" *unrepresentable* rather
 *    than a rule a caller must remember — {@link narrowScope} can only ever return a
 *    subset of the parent, and {@link effectiveScope} composes the chain by intersection.
 *
 * 2. **scope→ignore translation.** {@link scopedOutPaths} computes exactly the paths whose
 *    effective Scope does NOT include a given OS — the set a generated `.chezmoiignore`
 *    must list so chezmoi ignores them here (the muted/ignored rows of issue 1-07).
 *
 * Scope intent (which OSes a path is scoped to) is **user-authored data**, so it is stored
 * in the synced `.dotden/` (ADR 0024); the realized rules are native `.chezmoiignore`
 * (ADR 0024 "OS Scope rules live as native `.chezmoiignore`"). The compiler that writes
 * the file is {@link import('./chezmoi-adapter.js').ChezmoiAdapter.writeOsScopeIgnore},
 * which renders from {@link scopedOutPaths}.
 */

// The Os + Scope TYPES are the cross-process contract — they moved to
// `src/shared/scope.ts` so the renderer can speak Scope without reaching into
// `main/**` (ADR 0031). The OPERATIONS on them stay here (main-side behavior).
import type { Os, Scope } from '../../../shared/scope.js'

/**
 * Intersect two Scopes — the one primitive the whole "narrowable, never broadenable"
 * guarantee is built on.
 *
 * `null` is the universal Scope and the intersection identity: `intersect(null, s) === s`
 * and `intersect(s, null) === s`. Two concrete Scopes intersect to the OSes present in
 * BOTH. The result therefore can only ever be a **subset** of each input — there is no
 * input that makes the result contain an OS absent from one side, so "broaden" is
 * impossible by construction (the core of the inheritance invariant).
 *
 * @param a One Scope (a child's declared Scope, or a parent's effective Scope).
 * @param b The other Scope.
 * @returns The intersection: `null` only when BOTH are `null` (both universal), else the
 *   concrete set of OSes common to both (possibly empty = "applies nowhere").
 */
export function intersectScope(a: Scope, b: Scope): Scope {
  if (a === null) return b
  if (b === null) return a
  // Both concrete: keep only OSes in BOTH, de-duplicated and order-stable on `a`.
  const bSet = new Set(b)
  const out: Os[] = []
  for (const os of a) {
    if (bSet.has(os) && !out.includes(os)) out.push(os)
  }
  return out
}

/**
 * Narrow a parent's Scope by a child's **requested** Scope — the operation a child uses to
 * restrict its inherited Scope, which can NEVER broaden past the parent.
 *
 * This is just {@link intersectScope} named for its role: whatever the child asks for, the
 * result is the parent's Scope intersected with the request, so the child can only ever end
 * up with a subset of the parent's OSes. A child that "requests" an OS the parent does not
 * have simply does not get it (the request is clamped, never honored as a widening) — the
 * invariant is enforced by the math, not by a guard a caller could forget (ADR 0008 spirit).
 *
 * @param parentScope The parent Folder's already-effective Scope (universal `null` ⇒ no
 *   restriction inherited).
 * @param requested The child's declared Scope (universal `null` ⇒ inherit the parent as-is).
 * @returns The child's effective Scope: always a subset of `parentScope`.
 */
export function narrowScope(parentScope: Scope, requested: Scope): Scope {
  return intersectScope(parentScope, requested)
}

/**
 * Compose a chain of declared Scopes (outermost parent → … → the path itself) into the
 * path's single **effective Scope**, by folding {@link narrowScope} down the chain.
 *
 * Each step narrows the accumulated parent Scope by the next declared Scope, so the result
 * is a subset of EVERY ancestor's Scope — the faithful realization of "a Folder's Scope is
 * inherited by its children, narrowable but never broadenable" across arbitrary nesting
 * depth. An all-`null` chain yields `null` (universal); any concrete link clamps the rest.
 *
 * @param chain Declared Scopes from the outermost ancestor to the path, in order. An empty
 *   chain is the universal Scope (`null`) — nothing restricts the path.
 * @returns The path's effective Scope after inheritance + narrowing.
 */
export function effectiveScope(chain: readonly Scope[]): Scope {
  return chain.reduce<Scope>((acc, declared) => narrowScope(acc, declared), null)
}

/**
 * Does a path apply on `os`, given its effective Scope?
 *
 * The universal Scope (`null`) applies on every OS; a concrete Scope applies on `os` iff it
 * lists `os`. This is the predicate `ApplicabilityResolver` consumes for the OS-axis half of
 * `appliesHere` (`file.scope matches env.os`, issue 1-15 acceptance criterion) and the
 * inverse of {@link scopedOutPaths}'s membership test.
 *
 * @param scope The path's effective Scope (after inheritance).
 * @param os The environment's OS to test against.
 * @returns `true` when the path applies on `os` (in Scope), `false` when scoped out.
 */
export function scopeAppliesOn(scope: Scope, os: Os): boolean {
  return scope === null || scope.includes(os)
}

/**
 * One path with its already-resolved effective Scope, the input to {@link scopedOutPaths}.
 *
 * The caller (the store/service) is responsible for having folded inheritance via
 * {@link effectiveScope} first, so this translation step is a pure membership filter with
 * no knowledge of the Folder hierarchy.
 */
export interface ScopedPath {
  /** Destination-relative path being scoped (e.g. `.config/powershell/profile.ps1`). */
  readonly targetPath: string
  /** The path's EFFECTIVE Scope (after inheritance), or `null` for universal. */
  readonly scope: Scope
}

/**
 * Compute the destination-relative paths to list in a generated `.chezmoiignore` for an
 * environment running `currentOs` — exactly the paths whose effective Scope does NOT
 * include `currentOs`.
 *
 * This is the scope→ignore translation the acceptance criteria pin: a path scoped to other
 * OSes becomes a `.chezmoiignore` entry here, so `chezmoi apply` skips it and the three-pane
 * tree renders it muted (issue 1-07). A universally-scoped path (`null`) is never ignored;
 * a path whose Scope lists `currentOs` is never ignored; everything else is.
 *
 * @param paths The scoped paths, each carrying its EFFECTIVE Scope (inheritance pre-folded).
 * @param currentOs The OS this environment runs on.
 * @returns The destination-relative paths to ignore here, in input order (de-duplicated).
 */
export function scopedOutPaths(paths: readonly ScopedPath[], currentOs: Os): readonly string[] {
  const out: string[] = []
  for (const { targetPath, scope } of paths) {
    if (!scopeAppliesOn(scope, currentOs) && !out.includes(targetPath)) {
      out.push(targetPath)
    }
  }
  return out
}
