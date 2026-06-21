/**
 * DenStore — the synced `.dotden/` metadata seam (ADR 0024).
 *
 * dotden splits its data into two tiers: **user-authored organization/identity**
 * syncs through the Remote; **environment-local facts** stay local. The synced
 * tier lives in a single **chezmoi-ignored `.dotden/` directory** in the repo so
 * chezmoi never treats it as a managed target (ADR 0024). This store reads and
 * writes the MVP slice of that directory:
 *
 * - the **Workspace/Group tree** + **File/Folder placements** (`workspaces.json`);
 * - the **environment registry** `{ id, label, os, subscribedWorkspaces }`
 *   (`environments.json`).
 *
 * It also keeps `.dotden/` out of chezmoi's managed set by appending a
 * `.chezmoiignore` rule, because `.dotden/` is dotden metadata, never a dotfile.
 *
 * This is the synced metadata that lets a *second* environment reconstruct the
 * Den: env B clones the Remote, reads `.dotden/` through this store, and learns
 * which Workspaces exist and which Files belong to them.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { effectiveScope, narrowScope, type Scope } from './platform/os-scope.js'
import {
  addAllowlistEntry,
  EMPTY_SECRET_ALLOWLIST,
  type SecretAllowlist,
} from './secret-allowlist.js'
import type { SecretFinding } from './secret-scanner.js'
import { DEFAULT_COMMIT_MESSAGE_TEMPLATE } from '../../shared/commit-template.js'
import {
  type AppearanceSettings,
  normalizeAppearanceSettings,
} from '../../shared/appearance-settings.js'

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

/** Relative path (within the source dir) of the chezmoi-ignored `.dotden/` directory. */
const DEN_DIR = '.dotden'
const WORKSPACES_FILE = join(DEN_DIR, 'workspaces.json')
const ENVIRONMENTS_FILE = join(DEN_DIR, 'environments.json')
/**
 * The synced secret-scan "don't warn" allowlist (issue 2-04, ADR 0024). Lives in `.dotden/`
 * so a File the user judged safe stops nagging on EVERY environment — the decision is
 * user-authored organization-of-trust, so it travels with the Den (never re-answered per machine).
 */
const SECRET_ALLOWLIST_FILE = join(DEN_DIR, 'secret-allowlist.json')
/**
 * The synced commit-message template (issue 2-09, ADR 0024). The template is **user-authored**
 * organization-of-presentation (how the user wants their `git log` to read), so by ADR 0024 it
 * syncs through `.dotden/` as a **default** — every environment shares it unless a later local
 * override (PRD2#17) narrows it per machine. Maps to chezmoi's `git.commitMessageTemplate`.
 */
const COMMIT_TEMPLATE_FILE = join(DEN_DIR, 'commit-template.json')
/**
 * The synced appearance + default Apply/notification preferences (issue 2-10, ADR 0024). Like
 * the commit template these are **user-authored** preference/presentation, so by ADR 0024 they
 * sync through `.dotden/` as **defaults** every environment shares (until a later local override,
 * issue 2-17). Shape/defaults/normalization live in `shared/appearance-settings.ts`.
 */
const APPEARANCE_FILE = join(DEN_DIR, 'appearance-settings.json')

/**
 * Reads/writes the synced `.dotden/` metadata inside a chezmoi source dir.
 *
 * All paths are resolved under {@link DenStore.sourceDir}, which is chezmoi's
 * source state (the git-tracked repo). Because `.dotden/` is chezmoi-ignored, these
 * files travel with the Den through git (Sync) but are never written to the user's
 * home directory by `chezmoi apply`.
 */
export class DenStore {
  /**
   * @param sourceDir chezmoi source-state directory (the git repo) that holds `.dotden/`.
   */
  constructor(private readonly sourceDir: string) {}

  /**
   * Seed a brand-new Den with the default, subscribe-all Workspace and register
   * this environment — the env-A "first run" path.
   *
   * Writes `workspaces.json` (one default Workspace, no placements yet) and
   * `environments.json` (this environment subscribed to the default Workspace), and
   * ensures `.dotden/` is chezmoi-ignored. Idempotent on the Workspace doc: if one
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
   * {@link DenStore.setFileWorkspace}.
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
   * (issue 1-14). DISTINCT from {@link DenStore.moveFileToGroup}: changing the
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
  // user-authored intent lives here in `.dotden/`. The narrowing math lives in os-scope.ts.

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
   * An unplaced File (managed on disk but missing from `.dotden/`) is treated as universally
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
   * `.dotden/` too, otherwise a second environment would still see the (now removed)
   * File as incoming. No-op when the path is not placed, so calling it twice — or
   * after chezmoi already forgot/destroyed the source — is idempotent.
   *
   * @param targetPath Destination-relative File path whose placement to remove.
   */
  async removePlacement(targetPath: string): Promise<void> {
    const doc = await this.readWorkspaces()
    const placements = doc.placements.filter((p) => p.targetPath !== targetPath)
    // Skip the write entirely when nothing changed so an idempotent call produces no
    // git churn in `.dotden/workspaces.json`.
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
   * **Retire** (remove) an environment from the synced registry — the lifecycle op for a
   * decommissioned machine (issue 2-15, ADR 0024 "Retire/remove drops a decommissioned
   * environment").
   *
   * Drops exactly the entry keyed by `id`; every other entry is preserved byte-for-byte.
   * Because identity is the stable id (never the hostname), this can never accidentally
   * drop the wrong machine. The write is skipped when no entry matched, so retiring an
   * already-absent id is an idempotent clean no-op (no git churn). NOTHING about attribution
   * is touched — "who changed this" stays derived from git log, never stored here (ADR 0024),
   * so the retired environment's PAST history in `git log` is untouched and remains readable;
   * only its registry membership is removed.
   *
   * @param id The stable id of the environment to retire.
   * @returns The remaining entries after removal (for the caller to surface the new list).
   */
  async removeEnvironment(id: string): Promise<readonly EnvironmentEntry[]> {
    const doc = await this.readEnvironments()
    const remaining = doc.environments.filter((e) => e.id !== id)
    // Idempotent: nothing matched → leave the file untouched (no spurious git churn).
    if (remaining.length === doc.environments.length) return doc.environments
    await this.writeEnvironments({ environments: remaining })
    return remaining
  }

  /**
   * **Reassign / merge** a duplicate environment entry into the correct one — the lifecycle op
   * for a mistaken duplicate (issue 2-15, ADR 0024 "Reassign/merge folds a duplicate entry into
   * the correct one").
   *
   * Folds `fromId` (the duplicate) into `intoId` (the keeper): the keeper's Workspace
   * subscriptions become the UNION of both (the duplicate may have subscribed to a Workspace
   * the keeper had not), and the duplicate entry is then removed. The keeper's `id`, `label`,
   * and `os` are preserved unchanged — folding only ever WIDENS access (union), never narrows
   * it or relabels the keeper, so a merge can never silently strip a machine's subscriptions.
   * Identity stays the keeper's stable id, so the keeper's git-log attribution is continuous.
   *
   * Attribution is NEVER touched (it is git-log-derived, ADR 0024); past commits authored under
   * the duplicate's label stay in `git log` and remain attributable to that label — merging the
   * registry entry does not rewrite history. This is intentionally a *registry* merge only.
   *
   * @param fromId The duplicate entry to fold in and remove.
   * @param intoId The correct entry to keep (receives the unioned subscriptions).
   * @returns The kept entry as stored after the fold.
   * @throws Error when either id is absent, or when `fromId === intoId` (a no-op merge is a
   *   programming error the caller should never request — surfaced, never silently swallowed).
   */
  async reassignEnvironment(fromId: string, intoId: string): Promise<EnvironmentEntry> {
    if (fromId === intoId) {
      throw new Error('Cannot reassign an environment into itself')
    }
    const doc = await this.readEnvironments()
    const from = doc.environments.find((e) => e.id === fromId)
    const into = doc.environments.find((e) => e.id === intoId)
    if (!from) throw new Error(`Cannot reassign: no environment with id ${fromId}`)
    if (!into) throw new Error(`Cannot reassign: no target environment with id ${intoId}`)
    // Union the subscriptions (a merge only ever widens access — never strips the keeper's).
    const merged: EnvironmentEntry = {
      ...into,
      subscribedWorkspaces: [
        ...new Set([...into.subscribedWorkspaces, ...from.subscribedWorkspaces]),
      ],
    }
    // Drop the duplicate AND upsert the widened keeper in one write (no transient bad state).
    const others = doc.environments.filter((e) => e.id !== fromId && e.id !== intoId)
    await this.writeEnvironments({ environments: [...others, merged] })
    return merged
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
   * of when the `.dotden/` file was written: a Workspace from before the 1-14 Group
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

  // ── Secret-scan "don't warn" allowlist (issue 2-04) ──
  // The synced half of the Commit-anyway path: a File the user consciously judged safe (its
  // specific flagged value) stops triggering the warn step — on EVERY environment, because the
  // decision is user-authored organization-of-trust and so syncs through `.dotden/` (ADR 0024).
  // The model + the per-File+match scoping (which prevents a NEW secret being silently
  // re-enabled) live in secret-allowlist.ts; this is only the synced read/write seam.

  /**
   * Read the synced secret-scan allowlist, returning an empty one when absent (the default
   * before any finding has been dismissed). A Den synced by an older dotden that never wrote
   * this file simply reads back empty — forward-compatible, never fail silently.
   *
   * @returns The synced {@link SecretAllowlist} (`.dotden/secret-allowlist.json`).
   */
  async readSecretAllowlist(): Promise<SecretAllowlist> {
    return (await this.readJson<SecretAllowlist>(SECRET_ALLOWLIST_FILE)) ?? EMPTY_SECRET_ALLOWLIST
  }

  /**
   * Record a dismissed finding into the synced allowlist — the persistence half of the
   * "Don't warn me about this File again" checkbox (issue 2-04).
   *
   * Delegates the scoping to {@link addAllowlistEntry} (per File + match, idempotent) so a real
   * leak is never silently re-enabled, then writes `.dotden/secret-allowlist.json`. Only the
   * **masked** preview is ever stored — the raw secret never enters the synced file. The write
   * is skipped when the entry already exists, so re-dismissing produces no git churn. The Commit
   * that records this allowlist change is the one that staged `.dotden/` (DenService), so the
   * decision travels to every environment with the next Sync.
   *
   * @param finding The finding the user judged safe (the scanner's shape; `line` is ignored by
   *   the fingerprint so a moved secret stays allowlisted).
   * @returns The resulting allowlist as stored.
   */
  async addSecretAllowlistEntry(finding: SecretFinding): Promise<SecretAllowlist> {
    const current = await this.readSecretAllowlist()
    const next = addAllowlistEntry(current, finding)
    // Idempotent: addAllowlistEntry returns the SAME reference when nothing changed, so skip
    // the write to avoid churning `.dotden/secret-allowlist.json`.
    if (next !== current) await this.writeJson(SECRET_ALLOWLIST_FILE, next)
    return next
  }

  // ── Commit-message template (issue 2-09) ──
  // The synced default the user edits in Settings → Commit. Stored as `{ template }` so the file
  // is self-describing + forward-extensible; maps to chezmoi `git.commitMessageTemplate`.

  /**
   * Read the synced commit-message template, falling back to the built-in default when absent or
   * malformed (a fresh Den, or one synced by an older dotden that never wrote this file). Never
   * throws and never returns an empty template — degrades to {@link DEFAULT_COMMIT_MESSAGE_TEMPLATE}
   * so the Commit message is always coherent (never fail silently into a surprising state).
   *
   * @returns The synced template string (or the default).
   */
  async readCommitTemplate(): Promise<string> {
    const doc = await this.readJson<{ template?: unknown }>(COMMIT_TEMPLATE_FILE)
    return typeof doc?.template === 'string' && doc.template.length > 0
      ? doc.template
      : DEFAULT_COMMIT_MESSAGE_TEMPLATE
  }

  /**
   * Persist the synced commit-message template — the write half of the Commit tab's editor +
   * "Reset to default". Stores `.dotden/commit-template.json`; the Commit that stages `.dotden/`
   * (DenService) carries it, so the choice travels to every environment on the next Sync.
   *
   * @param template The template text to store (e.g. `[$os-sync-$year-$month-$day]`).
   */
  async writeCommitTemplate(template: string): Promise<void> {
    await this.writeJson(COMMIT_TEMPLATE_FILE, { template })
    // Guarantee `.dotden/` is chezmoi-ignored (creating `.chezmoiignore` if this is the first
    // `.dotden/` write on a never-seeded Den), so the metadata Commit can always stage it — and
    // so the template file is never applied to the user's home (it is dotden metadata, ADR 0024).
    await this.ensureIgnored()
  }

  // ── Appearance + default Apply/notification preferences (issue 2-10) ──
  // The synced defaults the user sets in Settings → Appearance: the app theme + the preferred
  // default Apply behaviour + which cross-environment events notify. Stored as the whole
  // settings object so the file is self-describing; normalized on read so an older/partial file
  // still yields a coherent object (never fail silently).

  /**
   * Read the synced appearance + default Apply/notification preferences, normalizing every field
   * to its safe default when absent or malformed (a fresh Den, or one synced by an older dotden
   * that never wrote this file). Never throws — degrades to {@link DEFAULT_APPEARANCE_SETTINGS}
   * per-field via {@link normalizeAppearanceSettings} (never fail silently into a surprising state).
   *
   * @returns The synced appearance settings (with safe defaults filled in for anything absent).
   */
  async readAppearanceSettings(): Promise<AppearanceSettings> {
    const doc = await this.readJson<unknown>(APPEARANCE_FILE)
    return normalizeAppearanceSettings(doc)
  }

  /**
   * Persist the synced appearance + default Apply/notification preferences — the write half of
   * the Appearance tab. Stores `.dotden/appearance-settings.json`; the Commit that stages `.dotden/`
   * (DenService) carries it, so the choice travels to every environment on the next Sync. Writes
   * the normalized object so the file is always coherent.
   *
   * @param settings The complete next appearance settings to store.
   */
  async writeAppearanceSettings(settings: AppearanceSettings): Promise<void> {
    await this.writeJson(APPEARANCE_FILE, normalizeAppearanceSettings(settings))
    // Guarantee `.dotden/` is chezmoi-ignored (mirrors writeCommitTemplate) so the metadata Commit
    // can always stage it and the file is never applied to the user's home (it is dotden metadata).
    await this.ensureIgnored()
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
   * Ensure `.dotden/` is listed in the source dir's `.chezmoiignore`.
   *
   * `.dotden/` is dotden metadata, not a dotfile, so chezmoi must never apply it to
   * the user's home. Appended idempotently (only if not already present) so we do
   * not clobber OS-Scope ignore rules a later slice writes to the same file.
   */
  private async ensureIgnored(): Promise<void> {
    const ignorePath = join(this.sourceDir, '.chezmoiignore')
    let current = ''
    try {
      current = await readFile(ignorePath, 'utf8')
    } catch {
      // No ignore file yet — we will create it with just the .dotden/ rule.
    }
    if (current.split(/\r?\n/).includes(`${DEN_DIR}/`)) return
    const next = current.length > 0 && !current.endsWith('\n') ? `${current}\n` : current
    await mkdir(this.sourceDir, { recursive: true })
    await writeFile(ignorePath, `${next}${DEN_DIR}/\n`, 'utf8')
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
    // Pretty-print so `.dotden/` JSON produces readable, mergeable git diffs.
    await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  }
}
