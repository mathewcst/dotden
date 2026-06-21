/**
 * ConflictModel — the SOLE owner of invariant #1, "never auto-resolve a Conflict"
 * (ADR 0008).
 *
 * A **Conflict** is the cross-environment axis (CONTEXT.md): two environments each
 * Committed the same File, so their source-state git histories diverged in a way git
 * could NOT auto-merge — `git merge` left `<<<<<<<` markers (`UU` in `git status`).
 * Non-overlapping edits never reach here; git already merged them. What reaches here
 * is a *true* Conflict, and the one rule that may never be relaxed is that dotden does
 * not pick a side for the user — at any automation level, including YOLO.
 *
 * ADR 0008 makes that guarantee **structural, not behavioural**: the resolved bytes of
 * a Conflict are **unconstructable without an explicit user choice**. This is the same
 * trick {@link import('./applicability-resolver.js').AppliesHere} uses for invariant #3
 * — a module-private brand symbol — applied here so the *only* way to obtain a
 * {@link ResolvedConflict} (the bytes that will be written to disk) is to call
 * {@link ConflictModel.resolve} with a {@link ResolutionChoice}. The merge view and the
 * `DenService` resolution path **require** a `ResolvedConflict` to write anything, so
 * "auto-resolved a Conflict" is not a bug that can be forgotten — it is a state the type
 * system cannot express (ADR 0008's "cannot express the unsafe state"). In particular,
 * the renderer's `@pierre/diffs` merge view must route through `ConflictModel.resolve`
 * (carried over IPC) and **never** call the library's own `resolveConflict()` directly.
 */

/**
 * The user's three-way resolution of one conflicting File — the only inputs that can
 * mint resolved bytes. The names map 1:1 onto the UI's Keep mine / Take theirs / Open
 * both, and onto `@pierre/diffs`' `MergeConflictResolution` union so the merge view's
 * choice flows straight through without translation:
 *
 * - `current` — **Keep mine**: the bytes this environment Committed (git's "ours"/HEAD).
 * - `incoming` — **Take theirs**: the bytes the Remote Committed (git's "theirs").
 * - `both` — **Open both**: the union with the `<<<<<<<`/`=======`/`>>>>>>>` markers
 *   left in, so the user consciously hand-edits the merged result. Still an explicit
 *   choice — never an automatic union.
 */
export type ResolutionChoice = 'current' | 'incoming' | 'both'

/**
 * Module-private brand symbol for {@link ResolvedConflict}.
 *
 * A REAL runtime symbol (so the witness can carry it) that is NOT exported, so no code
 * outside this module can name the key — the only value carrying it comes from
 * {@link ConflictModel.resolve}. That is what makes resolved bytes un-forgeable at both
 * the type and runtime levels (mirrors `AppliesHere`'s brand for invariant #3).
 */
const ResolvedConflictBrand: unique symbol = Symbol('dotden.ResolvedConflict')

/**
 * The bytes a Conflict resolves to — and the un-forgeable proof a human chose them.
 *
 * It carries the resolved {@link bytes} plus *which* {@link choice} produced them, for
 * the audit/commit message, and the brand that proves it came from
 * {@link ConflictModel.resolve}. `DenService` writes `bytes` to the source-state File
 * and completes the merge; because it can only accept a `ResolvedConflict` (not a raw
 * string), there is no code path that writes resolved bytes the user did not choose.
 */
export interface ResolvedConflict {
  /** Destination-relative File path this resolution is for (e.g. `.zshrc`). */
  readonly targetPath: string
  /** Which side the user chose — recorded for the resolution commit message + audit. */
  readonly choice: ResolutionChoice
  /** The exact bytes to write to the source-state File for this resolution. */
  readonly bytes: string
  /** Private brand — present only on values minted inside {@link ConflictModel.resolve}. */
  readonly [ResolvedConflictBrand]: true
}

/**
 * One conflicting File's three sides, as git surfaces them after a failed auto-merge.
 *
 * The sides are read out of the working tree once the merge stops on a `UU` File: the
 * `:2:`/`:3:` index stages give the current/ours and incoming/theirs bytes, and the
 * working-tree copy holds the `<<<<<<<`-marked union (see
 * {@link import('./git-transport.js').GitTransport.conflictedFile}). They are plain data
 * — constructing a {@link ConflictModel} from them resolves nothing.
 */
export interface ConflictFile {
  /** Destination-relative File path in Conflict (e.g. `.zshrc`). */
  readonly targetPath: string
  /** **Keep mine** bytes — what this environment Committed (git "ours"/HEAD, stage 2). */
  readonly current: string
  /** **Take theirs** bytes — what the Remote Committed (git "theirs", stage 3). */
  readonly incoming: string
  /** **Open both** bytes — the marker-bearing union from the working tree, for hand-editing. */
  readonly both: string
}

/**
 * True when a value is a {@link ResolvedConflict} this module minted (type guard).
 *
 * The brand key is module-private, so this can only ever match a value produced by
 * {@link ConflictModel.resolve} — a caller cannot smuggle a hand-rolled object past it.
 * It takes `unknown` (not `ResolvedConflict`) on purpose: its whole job is to *filter
 * untrusted values* — a forged "resolution" coming over IPC or from an automation path —
 * so the gate that protects invariant #1 must be able to inspect any shape, not just
 * values already typed as resolved.
 *
 * @param value Any value to test.
 */
export function isResolvedConflict(value: unknown): value is ResolvedConflict {
  return typeof value === 'object' && value !== null && ResolvedConflictBrand in value
}

/**
 * Owns one conflicting File and is the only place its resolved bytes can be minted.
 *
 * Construct one per conflicting File from the three sides git surfaced; it performs no
 * I/O (a pure value object), so it is exhaustively unit-testable. Reading the sides
 * ({@link current}/{@link incoming}/{@link both}) lets the merge view render the
 * Conflict, but bytes only come into existence when the user calls {@link resolve} with
 * an explicit choice — never on construction, and never automatically.
 */
export class ConflictModel {
  /**
   * @param file The conflicting File's three sides (path + current/incoming/both bytes).
   */
  constructor(private readonly file: ConflictFile) {}

  /** Destination-relative File path this model resolves. */
  get targetPath(): string {
    return this.file.targetPath
  }

  /** **Keep mine** bytes (git "ours"/HEAD), for the merge view's current side. */
  get current(): string {
    return this.file.current
  }

  /** **Take theirs** bytes (git "theirs"/Remote), for the merge view's incoming side. */
  get incoming(): string {
    return this.file.incoming
  }

  /** **Open both** bytes (the marker-bearing union), for the merge view's both side. */
  get both(): string {
    return this.file.both
  }

  /**
   * Resolve this Conflict to the bytes the user chose — the ONLY way to mint a
   * {@link ResolvedConflict} (invariant #1, ADR 0008).
   *
   * Maps the three-way {@link ResolutionChoice} onto the side git gave us: `current` →
   * Keep mine, `incoming` → Take theirs, `both` → the marker-bearing union the user will
   * hand-edit. There is intentionally no default/fallback branch: a choice outside the
   * three-way space is a programming error and throws, so the model can never silently
   * pick a side (never auto-resolve, never fail silently).
   *
   * @param choice The user's explicit Keep mine / Take theirs / Open both decision.
   * @returns The un-forgeable resolved bytes (the only value `DenService` will write).
   * @throws Error when `choice` is not one of the three valid resolutions.
   */
  resolve(choice: ResolutionChoice): ResolvedConflict {
    let bytes: string
    switch (choice) {
      case 'current':
        bytes = this.file.current
        break
      case 'incoming':
        bytes = this.file.incoming
        break
      case 'both':
        bytes = this.file.both
        break
      default:
        // An unknown choice is a wiring bug — refuse rather than invent a resolution.
        throw new Error(`Unknown conflict resolution choice: ${String(choice)}`)
    }
    // This object literal is the ONLY place a ResolvedConflict is minted in the whole
    // codebase — the brand key is unreachable elsewhere, so a caller cannot fabricate
    // resolved bytes without going through this explicit user choice.
    return { targetPath: this.file.targetPath, choice, bytes, [ResolvedConflictBrand]: true }
  }
}
