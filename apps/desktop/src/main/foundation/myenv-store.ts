/**
 * MyenvStore — the synced `.myenv/` metadata seam (ADR 0024).
 *
 * dotden splits its data into two tiers: **user-authored organization/identity**
 * syncs through the Remote; **environment-local facts** stay local. The synced
 * tier lives in a single **chezmoi-ignored `.myenv/` directory** in the repo so
 * chezmoi never treats it as a managed target (ADR 0024). This store reads and
 * writes the MVP slice of that directory:
 *
 * - the **Workspace/Group tree** + **File/Folder placements** (`workspaces.json`);
 * - the **environment registry** `{ id, label, os, subscribedWorkspaces }`
 *   (`environments.json`).
 *
 * It also keeps `.myenv/` out of chezmoi's managed set by appending a
 * `.chezmoiignore` rule, because `.myenv/` is dotden metadata, never a dotfile.
 *
 * This is the synced metadata that lets a *second* environment reconstruct the
 * Den: env B clones the Remote, reads `.myenv/` through this store, and learns
 * which Workspaces exist and which Files belong to them.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { effectiveScope, narrowScope, type Scope } from './os-scope.js'

/**
 * The default Workspace id every Den is seeded with.
 *
 * v1's MVP thread uses a single, subscribe-all Workspace; richer Workspace/Group
 * structure is this slice (1-14). Kept as a constant so the seeding and the
 * subscription default reference the same id.
 */
export const DEFAULT_WORKSPACE_ID = 'personal'

/**
 * A nested **Group** node within a Workspace (issue 1-14, ADR 0005).
 *
 * Groups are **purely organizational**: they nest, carry NO access control and NO
 * Scope, and — critically — **moving a File between Groups never changes its
 * filesystem path or its access** (CONTEXT.md "Group"; ADR 0005). A Group therefore
 * has no chezmoi equivalent and lives only here in the chezmoi-ignored `.myenv/`.
 *
 * Stored flat (each node naming its `parentId`) rather than as a recursive tree so a
 * move is a one-field edit and produces a small, merge-friendly git diff in
 * `.myenv/workspaces.json`. The tree shape is reconstructed by the renderer from the
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
   * written before this slice (forward-compat in {@link MyenvStore.readWorkspaces}).
   */
  readonly scope: Scope
}

/**
 * A placement of a File (or Folder) inside the Workspace/Group tree.
 *
 * This is dotden's organization metadata, NOT a chezmoi concept — Workspace/Group
 * has "no chezmoi equivalent" (CONTEXT.md mapping table), so it is stored here in
 * the chezmoi-ignored `.myenv/` directory rather than in chezmoi's source state.
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
   * ({@link MyenvStore.effectiveScopeOf}). Defaults to `null` (applies everywhere) — dotden
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

/** The synced Workspace tree + File placements (`workspaces.json`). */
export interface WorkspacesDoc {
  /** All Workspaces in the Den. The MVP thread seeds exactly one (default). */
  readonly workspaces: readonly Workspace[]
  /** Where each managed File lives in the Workspace tree. */
  readonly placements: readonly FilePlacement[]
}

/**
 * One environment's registry entry (ADR 0024).
 *
 * Identity is the **stable random `id`**, never the hostname (hostnames collide
 * and change). `label` defaults from the hostname but is user-editable.
 * `subscribedWorkspaces` is the access boundary: this environment applies only
 * Files inside Workspaces it subscribes to (ADR 0005).
 */
export interface EnvironmentEntry {
  /** Stable random identity for this environment — the source of truth, not the hostname. */
  readonly id: string
  /** User-editable display label, defaulting from the hostname on first run. */
  readonly label: string
  /** Operating system this environment runs on (`process.platform` value). */
  readonly os: string
  /** Workspace ids this environment subscribes to; only these Files apply here (ADR 0005). */
  readonly subscribedWorkspaces: readonly string[]
}

/** The synced environment registry (`environments.json`). */
export interface EnvironmentsDoc {
  /** Every environment participating in the Den. */
  readonly environments: readonly EnvironmentEntry[]
}

/** Relative path (within the source dir) of the chezmoi-ignored `.myenv/` directory. */
const MYENV_DIR = '.myenv'
const WORKSPACES_FILE = join(MYENV_DIR, 'workspaces.json')
const ENVIRONMENTS_FILE = join(MYENV_DIR, 'environments.json')

/**
 * Reads/writes the synced `.myenv/` metadata inside a chezmoi source dir.
 *
 * All paths are resolved under {@link MyenvStore.sourceDir}, which is chezmoi's
 * source state (the git-tracked repo). Because `.myenv/` is chezmoi-ignored, these
 * files travel with the Den through git (Sync) but are never written to the user's
 * home directory by `chezmoi apply`.
 */
export class MyenvStore {
  /**
   * @param sourceDir chezmoi source-state directory (the git repo) that holds `.myenv/`.
   */
  constructor(private readonly sourceDir: string) {}

  /**
   * Seed a brand-new Den with the default, subscribe-all Workspace and register
   * this environment — the env-A "first run" path.
   *
   * Writes `workspaces.json` (one default Workspace, no placements yet) and
   * `environments.json` (this environment subscribed to the default Workspace), and
   * ensures `.myenv/` is chezmoi-ignored. Idempotent on the Workspace doc: if one
   * already exists it is left intact and only the environment is registered.
   *
   * @param env This environment's registry entry (id/label/os; subscription defaulted).
   */
  async seedDefault(env: Pick<EnvironmentEntry, 'id' | 'label' | 'os'>): Promise<void> {
    await this.ensureIgnored()
    const existing = await this.readWorkspaces()
    if (existing.workspaces.length === 0) {
      await this.writeWorkspaces({
        // The single default Workspace seeds with no Groups and the universal Scope
        // (`null` — applies on every OS); the UI keeps the whole Workspace concept
        // invisible while only this one exists (issue 1-14).
        workspaces: [{ id: DEFAULT_WORKSPACE_ID, label: 'Personal', groups: [], scope: null }],
        placements: [],
      })
    }
    await this.registerEnvironment({
      ...env,
      subscribedWorkspaces: [DEFAULT_WORKSPACE_ID],
    })
  }

  /**
   * Record a File placement into a Workspace (defaulting to the default Workspace).
   *
   * Called when a File is Tracked so a second environment knows which Workspace the
   * File belongs to. De-duplicates on `targetPath` so re-Tracking is idempotent — and
   * preserves any existing Group the File was already filed under, so re-Tracking a
   * File never silently shuffles it out of its Group (organization is sticky).
   *
   * @param targetPath Destination-relative File path (e.g. `.zshrc`).
   * @param workspaceId Owning Workspace; defaults to {@link DEFAULT_WORKSPACE_ID}.
   */
  async placeFile(targetPath: string, workspaceId = DEFAULT_WORKSPACE_ID): Promise<void> {
    const doc = await this.readWorkspaces()
    const previous = doc.placements.find((p) => p.targetPath === targetPath)
    const placements = doc.placements.filter((p) => p.targetPath !== targetPath)
    await this.writeWorkspaces({
      ...doc,
      placements: [
        ...placements,
        // Keep the File in the same Group only when its Workspace is unchanged; a
        // Workspace change resets the Group (a Group belongs to ONE Workspace).
        {
          targetPath,
          workspaceId,
          groupId: previous?.workspaceId === workspaceId ? (previous?.groupId ?? null) : null,
          // Re-Tracking is sticky: preserve the File's own declared Scope so it is never
          // silently widened back to universal. A brand-new File starts universal (`null`)
          // — dotden never scopes a freshly Tracked File out (issue 1-15).
          scope: previous?.scope ?? null,
        },
      ],
    })
  }

  /**
   * Create a new **Workspace** — the second-and-onward Workspace the user adds to
   * separate access (e.g. "Work" alongside "Personal"). Creating the *second*
   * Workspace is what reveals the Workspace concept in the UI (issue 1-14): with only
   * the default one, the concept stays invisible.
   *
   * A new Workspace starts with NO subscribers other than environments the user later
   * opts in (subscription is exercised in issue 1-13) and no Groups. This is the
   * access-boundary creation step (ADR 0005); placing Files into it uses
   * {@link MyenvStore.setFileWorkspace}.
   *
   * @param label User-facing Workspace label (e.g. "Work").
   * @returns The created Workspace (with its freshly minted stable id).
   */
  async createWorkspace(label: string): Promise<Workspace> {
    const doc = await this.readWorkspaces()
    // A new Workspace starts with the universal Scope (`null`); the user narrows it later.
    const workspace: Workspace = { id: `ws-${randomUUID()}`, label, groups: [], scope: null }
    await this.writeWorkspaces({ ...doc, workspaces: [...doc.workspaces, workspace] })
    return workspace
  }

  /**
   * Create a nested **Group** inside a Workspace to organize Files (issue 1-14).
   *
   * Groups are pure organization (ADR 0005): this adds a node to the Workspace's
   * `groups` list and changes NEITHER any environment's access NOR any File's on-disk
   * path. `parentId` nests the Group under another Group in the same Workspace, or is
   * `null` for a top-level Group directly under the Workspace.
   *
   * @param workspaceId The Workspace the Group lives in (its access is unchanged).
   * @param label User-facing Group label (e.g. "Shell").
   * @param parentId Parent Group id for nesting, or `null` for a top-level Group.
   * @returns The created Group (with its freshly minted stable id).
   * @throws Error when the Workspace does not exist (never fail silently).
   */
  async createGroup(
    workspaceId: string,
    label: string,
    parentId: string | null = null,
  ): Promise<Group> {
    const doc = await this.readWorkspaces()
    const workspace = doc.workspaces.find((w) => w.id === workspaceId)
    if (!workspace) {
      throw new Error(`Cannot create a Group: Workspace "${workspaceId}" does not exist.`)
    }
    // A parent, if given, must be an existing Group in the SAME Workspace — Groups
    // never span Workspaces (a Group belongs to exactly one access boundary).
    if (parentId !== null && !workspace.groups.some((g) => g.id === parentId)) {
      throw new Error(
        `Cannot nest under Group "${parentId}": it is not a Group of Workspace "${workspaceId}".`,
      )
    }
    // A new Group starts with the universal Scope (`null`); it inherits its ancestors'
    // Scope as its EFFECTIVE Scope until the user narrows it (issue 1-15).
    const group: Group = { id: `grp-${randomUUID()}`, label, parentId, scope: null }
    const workspaces = doc.workspaces.map((w) =>
      w.id === workspaceId ? { ...w, groups: [...w.groups, group] } : w,
    )
    await this.writeWorkspaces({ ...doc, workspaces })
    return group
  }

  /**
   * File a managed File under a Group (or back to the Workspace root) — the
   * **organize-only** move (issue 1-14).
   *
   * This edits ONLY the placement's `groupId`. It is the load-bearing proof of the
   * Group invariant (ADR 0005): the File's `workspaceId` (its access) and its
   * `targetPath` (its on-disk location) are left byte-for-byte unchanged, so moving a
   * File between Groups never alters where it lands or which environments apply it.
   *
   * @param targetPath The managed File to re-file (must already be placed).
   * @param groupId Target Group id, or `null` to move it to the Workspace root.
   * @throws Error when the File is not placed, or the Group is not in the File's Workspace.
   */
  async moveFileToGroup(targetPath: string, groupId: string | null): Promise<void> {
    const doc = await this.readWorkspaces()
    const placement = doc.placements.find((p) => p.targetPath === targetPath)
    if (!placement) {
      throw new Error(`Cannot move "${targetPath}": it is not placed in any Workspace.`)
    }
    if (groupId !== null) {
      const workspace = doc.workspaces.find((w) => w.id === placement.workspaceId)
      if (!workspace?.groups.some((g) => g.id === groupId)) {
        throw new Error(
          `Cannot file "${targetPath}" under Group "${groupId}": it is not a Group of the File's Workspace.`,
        )
      }
    }
    const placements = doc.placements.map((p) =>
      // ONLY groupId changes — workspaceId (access) and targetPath (path) are preserved.
      p.targetPath === targetPath ? { ...p, groupId } : p,
    )
    await this.writeWorkspaces({ ...doc, placements })
  }

  /**
   * Move a managed File into a different **Workspace** — the access-boundary move
   * (issue 1-14). DISTINCT from {@link MyenvStore.moveFileToGroup}: changing the
   * Workspace DOES change which environments apply the File (ADR 0005), so it resets
   * the File's Group (a Group belongs to one Workspace) back to the Workspace root.
   *
   * @param targetPath The managed File to move (must already be placed).
   * @param workspaceId Target Workspace id (its access boundary).
   * @throws Error when the File is not placed, or the Workspace does not exist.
   */
  async setFileWorkspace(targetPath: string, workspaceId: string): Promise<void> {
    const doc = await this.readWorkspaces()
    const placement = doc.placements.find((p) => p.targetPath === targetPath)
    if (!placement) {
      throw new Error(`Cannot move "${targetPath}": it is not placed in any Workspace.`)
    }
    if (!doc.workspaces.some((w) => w.id === workspaceId)) {
      throw new Error(`Cannot move "${targetPath}": Workspace "${workspaceId}" does not exist.`)
    }
    const placements = doc.placements.map((p) =>
      // Workspace change resets the Group, since Groups never span Workspaces.
      p.targetPath === targetPath ? { ...p, workspaceId, groupId: null } : p,
    )
    await this.writeWorkspaces({ ...doc, placements })
  }

  // ── OS Scope (issue 1-15) ──
  // Scope is the OS-applicability axis (CONTEXT.md "Scope"): the set of OSes a File or
  // Folder applies on, inherited down the Workspace → Group → File chain and narrowable
  // but never broadenable. The realized rules are native `.chezmoiignore` (ADR 0024); the
  // user-authored intent lives here in `.myenv/`. The narrowing math lives in os-scope.ts.

  /**
   * Set a managed File's **OS Scope**, clamped so it can NARROW but never BROADEN past the
   * Scope it inherits from its Folder/Workspace (issue 1-15; CONTEXT.md "Scope").
   *
   * The `requested` Scope is intersected with the File's inherited parent Scope
   * ({@link narrowScope}), so a request for an OS the parent does not allow is silently
   * clamped away rather than honored as a widening — the "never broaden" invariant is
   * enforced by the math, not a guard a caller could forget. Pass `null` to clear the
   * File's own restriction and fall back to pure inheritance.
   *
   * @param targetPath The managed File to scope (must already be placed).
   * @param requested The File's requested Scope (`null` ⇒ inherit only, no own restriction).
   * @returns The File's resulting EFFECTIVE Scope after clamping + inheritance.
   * @throws Error when the File is not placed (never fail silently).
   */
  async setFileScope(targetPath: string, requested: Scope): Promise<Scope> {
    const doc = await this.readWorkspaces()
    const placement = doc.placements.find((p) => p.targetPath === targetPath)
    if (!placement) {
      throw new Error(`Cannot scope "${targetPath}": it is not placed in any Workspace.`)
    }
    // The Scope this File inherits from its ancestors (Workspace + Group chain), WITHOUT its
    // own current declared Scope — the ceiling the request is clamped under.
    const parentScope = this.inheritedScope(doc, placement.workspaceId, placement.groupId)
    // Narrow the request under the inherited ceiling: the stored own-Scope can only ever be
    // a subset of what the parent allows, so the File can never broaden past its Folder.
    const clamped = narrowScope(parentScope, requested)
    const placements = doc.placements.map((p) =>
      p.targetPath === targetPath ? { ...p, scope: clamped } : p,
    )
    await this.writeWorkspaces({ ...doc, placements })
    // The effective Scope equals the clamped own-Scope (already narrowed under the parent).
    return clamped
  }

  /**
   * Set a **Group's** (Folder's) OS Scope, clamped so it can NARROW but never BROADEN past
   * the Scope it inherits from its parent Group/Workspace (issue 1-15).
   *
   * Like {@link setFileScope}, the request is intersected with the Group's inherited
   * ceiling. Narrowing a Group narrows every File and child Group under it (they inherit it),
   * which is exactly the Folder-Scope-is-inherited-by-children behavior the issue requires.
   *
   * @param workspaceId The Workspace the Group lives in.
   * @param groupId The Group to scope.
   * @param requested The Group's requested Scope (`null` ⇒ inherit only).
   * @returns The Group's resulting EFFECTIVE Scope after clamping + inheritance.
   * @throws Error when the Workspace or Group does not exist.
   */
  async setGroupScope(workspaceId: string, groupId: string, requested: Scope): Promise<Scope> {
    const doc = await this.readWorkspaces()
    const workspace = doc.workspaces.find((w) => w.id === workspaceId)
    const group = workspace?.groups.find((g) => g.id === groupId)
    if (!workspace || !group) {
      throw new Error(
        `Cannot scope Group "${groupId}": it is not a Group of Workspace "${workspaceId}".`,
      )
    }
    // The Group's inherited ceiling = the Workspace Scope narrowed by its PARENT Group chain
    // (excluding this Group's own current Scope, so re-scoping is idempotent under the ceiling).
    const parentScope = this.inheritedScope(doc, workspaceId, group.parentId)
    const clamped = narrowScope(parentScope, requested)
    const workspaces = doc.workspaces.map((w) =>
      w.id === workspaceId
        ? { ...w, groups: w.groups.map((g) => (g.id === groupId ? { ...g, scope: clamped } : g)) }
        : w,
    )
    await this.writeWorkspaces({ ...doc, workspaces })
    return clamped
  }

  /**
   * The **effective OS Scope** of a managed File after inheritance + narrowing (issue 1-15).
   *
   * Folds the whole ancestor chain — Workspace Scope → each Group from the outermost down to
   * the File's own Group → the File's own declared Scope — by intersection
   * ({@link effectiveScope}), so the result is a subset of every ancestor's Scope. This is
   * the single source of "which OSes does this File actually apply on?", consumed by the
   * scope→`.chezmoiignore` translation and the `appliesHere` OS clause.
   *
   * An unplaced File (managed on disk but missing from `.myenv/`) is treated as universally
   * scoped (`null`) so it never silently disappears from a Scope-aware surface.
   *
   * @param doc The current Workspace doc (read once by the caller, passed in to avoid re-I/O).
   * @param targetPath The managed File whose effective Scope to compute.
   * @returns The File's effective Scope (`null` = applies everywhere).
   */
  effectiveScopeOf(doc: WorkspacesDoc, targetPath: string): Scope {
    const placement = doc.placements.find((p) => p.targetPath === targetPath)
    if (!placement) return null
    // Inherited Scope (Workspace + the Group chain up to and including the File's Group),
    // then narrowed by the File's OWN declared Scope.
    const inherited = this.inheritedScope(doc, placement.workspaceId, placement.groupId)
    return narrowScope(inherited, placement.scope)
  }

  /**
   * Compute the Scope a File or Group **inherits** — the Workspace Scope narrowed down the
   * chain of Group ancestors up to (and INCLUDING) `groupId` — WITHOUT the leaf's own Scope.
   *
   * Building the chain from the outermost ancestor inward and folding by intersection
   * realizes "a Folder's Scope is inherited by its children, narrowable but never
   * broadenable" at arbitrary depth. Passing `groupId = null` returns just the Workspace
   * Scope (a File/Group directly under the Workspace inherits only that).
   *
   * @param doc The current Workspace doc.
   * @param workspaceId The owning Workspace.
   * @param groupId The deepest Group in the chain to include, or `null` for the Workspace root.
   * @returns The inherited (ancestor) Scope before the leaf narrows it further.
   */
  private inheritedScope(doc: WorkspacesDoc, workspaceId: string, groupId: string | null): Scope {
    const workspace = doc.workspaces.find((w) => w.id === workspaceId)
    // Walk from the leaf Group up to the Workspace root, collecting Group Scopes, then
    // reverse so the chain runs outermost → innermost for the inheritance fold.
    const chain: Scope[] = [workspace?.scope ?? null]
    const ancestors: Scope[] = []
    let current = groupId
    const seen = new Set<string>() // guard against a malformed parent cycle (never loop forever).
    while (current !== null && !seen.has(current)) {
      seen.add(current)
      const group = workspace?.groups.find((g) => g.id === current)
      if (!group) break
      ancestors.push(group.scope)
      current = group.parentId
    }
    // `ancestors` is innermost → outermost; reverse so the Workspace-then-outer-then-inner
    // order matches `effectiveScope`'s outermost-first contract.
    chain.push(...ancestors.reverse())
    return effectiveScope(chain)
  }

  /**
   * Drop a File's placement from the Workspace tree — the synced half of the
   * **Untrack** (`forget`) and **Delete everywhere** (`destroy`) verbs (CONTEXT.md).
   *
   * Both verbs stop dotden managing the File, so its placement must leave the synced
   * `.myenv/` too, otherwise a second environment would still see the (now removed)
   * File as incoming. No-op when the path is not placed, so calling it twice — or
   * after chezmoi already forgot/destroyed the source — is idempotent.
   *
   * @param targetPath Destination-relative File path whose placement to remove.
   */
  async removePlacement(targetPath: string): Promise<void> {
    const doc = await this.readWorkspaces()
    const placements = doc.placements.filter((p) => p.targetPath !== targetPath)
    // Skip the write entirely when nothing changed so an idempotent call produces no
    // git churn in `.myenv/workspaces.json`.
    if (placements.length === doc.placements.length) return
    await this.writeWorkspaces({ ...doc, placements })
  }

  /**
   * Insert or replace an environment in the registry (write on first run, rename,
   * or subscription change, per ADR 0024). Keyed on the stable `id`.
   *
   * @param env The environment entry to upsert.
   */
  async registerEnvironment(env: EnvironmentEntry): Promise<void> {
    const doc = await this.readEnvironments()
    const others = doc.environments.filter((e) => e.id !== env.id)
    await this.writeEnvironments({ environments: [...others, env] })
  }

  /**
   * Set an environment's **subscribed Workspaces** — the access boundary a second
   * environment picks during returning onboarding (issue 1-13, ADR 0005).
   *
   * Subscription is the realized access axis: this environment applies only Files in the
   * Workspaces it subscribes to, compiled into the templated `.chezmoiignore`. This upserts
   * the entry's `subscribedWorkspaces`, creating the entry if the environment is not yet
   * registered (a fresh clone before claim) so the **registry-entry guard's ordering layer**
   * (write the entry BEFORE any apply, issue 1-13) holds — the apply never hits the
   * "no entry yet" gap. The set is de-duplicated and only kept to Workspaces that actually
   * exist, so a stale id never lingers in the registry.
   *
   * @param env This environment's id/label/os (used to create the entry if absent).
   * @param workspaceIds The Workspace ids to subscribe to (deduped + existence-filtered).
   * @returns The resulting registry entry as stored.
   */
  async setSubscriptions(
    env: Pick<EnvironmentEntry, 'id' | 'label' | 'os'>,
    workspaceIds: readonly string[],
  ): Promise<EnvironmentEntry> {
    const [registry, { workspaces }] = await Promise.all([
      this.readEnvironments(),
      this.readWorkspaces(),
    ])
    const existingIds = new Set(workspaces.map((w) => w.id))
    // Keep only real Workspaces, de-duplicated, so a removed/renamed Workspace never lingers.
    const subscribedWorkspaces = [...new Set(workspaceIds)].filter((id) => existingIds.has(id))
    const previous = registry.environments.find((e) => e.id === env.id)
    const entry: EnvironmentEntry = {
      id: env.id,
      // Preserve a user-edited label when the entry already exists; else default from setup.
      label: previous?.label ?? env.label,
      os: previous?.os ?? env.os,
      subscribedWorkspaces,
    }
    await this.registerEnvironment(entry)
    return entry
  }

  /**
   * Read the Workspace tree + placements, returning an empty doc when absent.
   *
   * Normalizes the on-disk shape so callers always see the canonical model regardless
   * of when the `.myenv/` file was written: a Workspace from before the 1-14 Group
   * slice has no `groups`, and a placement from before it has no `groupId`. Defaulting
   * them here (to `[]` / `null`) means a Den synced by an older dotden still loads
   * cleanly — the metadata is forward-compatible (never fail silently on old data).
   */
  async readWorkspaces(): Promise<WorkspacesDoc> {
    const raw = await this.readJson<WorkspacesDoc>(WORKSPACES_FILE)
    if (!raw) return { workspaces: [], placements: [] }
    return {
      // Default `groups`/`scope`/`groupId` for docs written before the 1-14/1-15 slices so
      // an older Den loads forward-compat: a missing Scope is the universal Scope (`null`),
      // i.e. "applies everywhere" — never silently scoping an old File out (issue 1-15).
      workspaces: raw.workspaces.map((w) => ({
        ...w,
        groups: (w.groups ?? []).map((g) => ({ ...g, scope: g.scope ?? null })),
        scope: w.scope ?? null,
      })),
      placements: raw.placements.map((p) => ({
        ...p,
        groupId: p.groupId ?? null,
        scope: p.scope ?? null,
      })),
    }
  }

  /** Read the environment registry, returning an empty doc when absent. */
  async readEnvironments(): Promise<EnvironmentsDoc> {
    return (await this.readJson<EnvironmentsDoc>(ENVIRONMENTS_FILE)) ?? { environments: [] }
  }

  /** Write the Workspace doc (pretty-printed JSON, for human-readable git diffs). */
  private async writeWorkspaces(doc: WorkspacesDoc): Promise<void> {
    await this.writeJson(WORKSPACES_FILE, doc)
  }

  /** Write the environment registry doc. */
  private async writeEnvironments(doc: EnvironmentsDoc): Promise<void> {
    await this.writeJson(ENVIRONMENTS_FILE, doc)
  }

  /**
   * Ensure `.myenv/` is listed in the source dir's `.chezmoiignore`.
   *
   * `.myenv/` is dotden metadata, not a dotfile, so chezmoi must never apply it to
   * the user's home. Appended idempotently (only if not already present) so we do
   * not clobber OS-Scope ignore rules a later slice writes to the same file.
   */
  private async ensureIgnored(): Promise<void> {
    const ignorePath = join(this.sourceDir, '.chezmoiignore')
    let current = ''
    try {
      current = await readFile(ignorePath, 'utf8')
    } catch {
      // No ignore file yet — we will create it with just the .myenv/ rule.
    }
    if (current.split(/\r?\n/).includes(`${MYENV_DIR}/`)) return
    const next = current.length > 0 && !current.endsWith('\n') ? `${current}\n` : current
    await mkdir(this.sourceDir, { recursive: true })
    await writeFile(ignorePath, `${next}${MYENV_DIR}/\n`, 'utf8')
  }

  /** Read+parse a JSON file under the source dir, or null when it does not exist. */
  private async readJson<T>(relativePath: string): Promise<T | null> {
    try {
      const raw = await readFile(join(this.sourceDir, relativePath), 'utf8')
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  /** Serialize+write a JSON file under the source dir, creating parent dirs. */
  private async writeJson(relativePath: string, value: unknown): Promise<void> {
    const absolute = join(this.sourceDir, relativePath)
    await mkdir(dirname(absolute), { recursive: true })
    // Pretty-print so `.myenv/` JSON produces readable, mergeable git diffs.
    await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  }
}
