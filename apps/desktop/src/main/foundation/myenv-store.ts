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
import { dirname, join } from 'node:path'

/**
 * The default Workspace id every Den is seeded with.
 *
 * v1's MVP thread uses a single, subscribe-all Workspace; richer Workspace/Group
 * structure is a later slice (1-14). Kept as a constant so the seeding and the
 * subscription default reference the same id.
 */
export const DEFAULT_WORKSPACE_ID = 'personal'

/**
 * A placement of a File (or Folder) inside the Workspace/Group tree.
 *
 * This is dotden's organization metadata, NOT a chezmoi concept — Workspace/Group
 * has "no chezmoi equivalent" (CONTEXT.md mapping table), so it is stored here in
 * the chezmoi-ignored `.myenv/` directory rather than in chezmoi's source state.
 */
export interface FilePlacement {
  /** Destination-relative target path of the File, e.g. `.zshrc` (CONTEXT.md "File"). */
  readonly targetPath: string
  /** The Workspace this File belongs to (its access boundary, ADR 0005). */
  readonly workspaceId: string
}

/** A top-level Workspace: the user-named container and environment-access boundary (ADR 0005). */
export interface Workspace {
  /** Stable Workspace id used by environment subscriptions and File placements. */
  readonly id: string
  /** User-facing Workspace label, e.g. "Personal". */
  readonly label: string
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
        workspaces: [{ id: DEFAULT_WORKSPACE_ID, label: 'Personal' }],
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
   * File belongs to. De-duplicates on `targetPath` so re-Tracking is idempotent.
   *
   * @param targetPath Destination-relative File path (e.g. `.zshrc`).
   * @param workspaceId Owning Workspace; defaults to {@link DEFAULT_WORKSPACE_ID}.
   */
  async placeFile(targetPath: string, workspaceId = DEFAULT_WORKSPACE_ID): Promise<void> {
    const doc = await this.readWorkspaces()
    const placements = doc.placements.filter((p) => p.targetPath !== targetPath)
    await this.writeWorkspaces({
      ...doc,
      placements: [...placements, { targetPath, workspaceId }],
    })
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

  /** Read the Workspace tree + placements, returning an empty doc when absent. */
  async readWorkspaces(): Promise<WorkspacesDoc> {
    return (
      (await this.readJson<WorkspacesDoc>(WORKSPACES_FILE)) ?? { workspaces: [], placements: [] }
    )
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
