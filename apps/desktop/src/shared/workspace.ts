/**
 * workspace — IPC contract types shared by main + renderer (ADR 0030).
 * Moved out of foundation so the renderer speaks them without importing main.
 */
import type { Scope } from './scope.js'

/**
 * A nested **Group** node within a Workspace (issue 1-14, ADR 0005).
 *
 * Groups are **purely organizational**: they nest, carry NO access control and NO
 * Scope, and — critically — **moving a File between Groups never changes its
 * filesystem path or its access** (CONTEXT.md "Group"; ADR 0005). A Group therefore
 * has no chezmoi equivalent and lives only here in the chezmoi-ignored `.dotden/`.
 *
 * Stored flat (each node naming its `parentId`) rather than as a recursive tree so a
 * move is a one-field edit and produces a small, merge-friendly git diff in
 * `.dotden/workspaces.json`. The tree shape is reconstructed by the renderer from the
 * `parentId` links.
 */
export interface Group {
  /** Stable Group id, referenced by File placements and child Groups. */
  readonly id: string
  /** User-facing Group label, e.g. "Shell" or "Editors". */
  readonly label: string
  /**
   * The Group this Group nests under, or `null` for a top-level Group sitting
   * directly under its Workspace. Nesting is expressed purely through this link.
   */
  readonly parentId: string | null
  /**
   * This Group's **OS Scope** — the set of OSes Files under it apply on, or `null` for
   * the universal (unrestricted) Scope (issue 1-15, CONTEXT.md "Scope"). A Group acting
   * as a Folder carries Scope its children inherit and may narrow but never broaden
   * ({@link import('./os-scope.js').narrowScope}). UNLIKE access (Workspace) and on-disk
   * path, Scope is an applicability axis: a Group's Scope changes WHERE its Files apply,
   * not which Workspace owns them or where they land. Defaults to `null` for a Group
   * written before this slice (forward-compat in {@link DenStore.readWorkspaces}).
   */
  readonly scope: Scope
}

/**
 * A placement of a File (or Folder) inside the Workspace/Group tree.
 *
 * This is dotden's organization metadata, NOT a chezmoi concept — Workspace/Group
 * has "no chezmoi equivalent" (CONTEXT.md mapping table), so it is stored here in
 * the chezmoi-ignored `.dotden/` directory rather than in chezmoi's source state.
 *
 * Two fields, two very different roles (ADR 0005):
 * - **`workspaceId`** is the **access boundary** — an environment applies a File iff
 *   it subscribes to this Workspace. Changing it changes access.
 * - **`groupId`** is **pure organization** — which Group the File is filed under for
 *   tidiness. It changes NEITHER access NOR the File's on-disk `targetPath`.
 */
export interface FilePlacement {
  /** Destination-relative target path of the File, e.g. `.zshrc` (CONTEXT.md "File"). */
  readonly targetPath: string
  /** The Workspace this File belongs to (its access boundary, ADR 0005). */
  readonly workspaceId: string
  /**
   * The Group within {@link FilePlacement.workspaceId} the File is filed under, or
   * `null` when it sits directly under the Workspace root. Organization only — it
   * never affects access (which is `workspaceId`) or the File's path (`targetPath`).
   */
  readonly groupId: string | null
  /**
   * This File's OWN declared **OS Scope** — the OSes it applies on, or `null` for the
   * universal Scope (issue 1-15). This is the File's *requested* Scope; its EFFECTIVE
   * Scope is this **narrowed by** every ancestor Folder/Workspace Scope it inherits, so a
   * File can restrict itself further than its Folder but never broaden past it
   * ({@link DenStore.effectiveScopeOf}). Defaults to `null` (applies everywhere) — dotden
   * never silently scopes a freshly Tracked File out. Forward-compat: a placement written
   * before this slice has no `scope` and reads back as `null`.
   */
  readonly scope: Scope
}

/** A top-level Workspace: the user-named container and environment-access boundary (ADR 0005). */
export interface Workspace {
  /** Stable Workspace id used by environment subscriptions and File placements. */
  readonly id: string
  /** User-facing Workspace label, e.g. "Personal". */
  readonly label: string
  /**
   * The nested Groups inside this Workspace (issue 1-14). Empty for a Workspace with
   * no organization yet. Groups are organization only — they do not widen or narrow
   * the Workspace's access boundary (ADR 0005).
   */
  readonly groups: readonly Group[]
  /**
   * This Workspace's **OS Scope** — the root of the inheritance chain for every File and
   * Group inside it (issue 1-15), or `null` for the universal Scope (the default). A
   * Workspace-level Scope is the outermost narrowing: its Groups and Files inherit it and
   * may narrow further but never broaden past it. Forward-compat: a Workspace written
   * before this slice has no `scope` and reads back as `null`.
   */
  readonly scope: Scope
}
