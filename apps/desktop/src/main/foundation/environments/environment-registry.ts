/**
 * EnvironmentRegistry — environment identity, labels, and git-log attribution
 * (issue 1-05, ADR 0024).
 *
 * The synced environment registry in `.dotden/` holds, per environment, exactly
 * `{ id, label, os, subscribedWorkspaces }` — and **nothing else**. Critically,
 * "who changed this" / last-sync / activity is **derived from git log, never written
 * to the registry**, so the registry stays small and merge-friendly (renaming a label
 * is a one-line diff; activity never churns the file).
 *
 * This service composes the lower seams without re-owning any invariant:
 * - {@link DenStore} — the synced `.dotden/` registry/Workspace JSON;
 * - {@link GitTransport} — `git log` over the same source repo, the attribution source;
 * - {@link ChezmoiAdapter} — mirrors this environment's own id into the
 *   environment-local chezmoi config (`[data].dotden_env_id`), the per-environment
 *   subscription seam a templated `.chezmoiignore` reads.
 *
 * What lives here (the 1-05 acceptance criteria):
 * - register/seed this environment (stable id, hostname-derived default label);
 * - rename the label without churn or identity change;
 * - mirror the own id into local chezmoi config so subscription templates self-identify;
 * - list environments WITH attribution computed live from git log;
 * - suggest the likely returning-claim match by OS + setup-time hostname (issue 1-13),
 *   and claim a returning entry (identity re-association only — no auto-merge).
 *
 * It is Electron-free (ADR 0023): it is constructed from the foundation adapters and
 * a plain identity object, so it is fully unit-testable against real git in a tempdir.
 */
import { GitTransport } from '../chezmoi/git-transport.js'
import { ChezmoiAdapter } from '../chezmoi/chezmoi-adapter.js'
import { DenStore } from '../den-store.js'
import type { EnvironmentEntry } from '../../../shared/environments.js'
import type {
  EnvironmentWithAttribution,
  ClaimSuggestion,
  EnvironmentAttribution,
} from '../../../shared/environments.js'

/** This environment's local identity — the stable id, default label, OS, and claim hint. */
export interface LocalIdentity {
  /** Stable random id — the environment's identity, never the hostname (ADR 0024). */
  readonly id: string
  /** Default display label, derived from the hostname (user-editable). */
  readonly label: string
  /** Operating system (`process.platform` value). */
  readonly os: string
  /** Hostname captured at setup — the returning-claim match hint, not the identity. */
  readonly hostnameAtSetup: string
}

/** Construction wiring for an {@link EnvironmentRegistry}, bound to one environment's repo. */
export interface EnvironmentRegistryOptions {
  /** chezmoi source dir = the git-tracked Den repo holding `.dotden/`. */
  readonly sourceDir: string
  /** Path to the bundled git binary, for `git log` attribution. */
  readonly gitBin: string
  /** Path to the bundled chezmoi binary, for mirroring the own id into local config. */
  readonly chezmoiBin: string
  /** Destination/home dir (passed through to the ChezmoiAdapter). */
  readonly destinationDir: string
  /** Environment-local chezmoi config file path that receives `[data].dotden_env_id`. */
  readonly configPath: string
  /** This environment's local identity (stable id + default label + claim hint). */
  readonly identity: LocalIdentity
}

/** One parsed `git log` record (see {@link GitTransport.log}'s format). */
interface CommitRecord {
  readonly sha: string
  readonly authorName: string
  readonly authorEmail: string
  readonly date: string
  readonly subject: string
}

/** ASCII Unit Separator — must mirror {@link GitTransport.log}'s field separator. */
const LOG_FIELD_SEP = '\x1f'

/**
 * Reads/writes the environment registry and derives attribution from git log.
 *
 * One instance is bound to a single environment's source repo + local identity. It
 * holds a {@link DenStore} (synced registry), a {@link GitTransport} (attribution),
 * and a {@link ChezmoiAdapter} (local-config id mirror). It never persists attribution
 * and never re-checks an owner's invariant (ADR 0008).
 */
export class EnvironmentRegistry {
  private readonly store: DenStore
  private readonly git: GitTransport
  private readonly chezmoi: ChezmoiAdapter

  /**
   * @param options Source repo, binaries, dirs, config path, and this environment's identity.
   */
  constructor(private readonly options: EnvironmentRegistryOptions) {
    this.store = new DenStore(options.sourceDir)
    this.git = new GitTransport({ gitBin: options.gitBin, repoDir: options.sourceDir })
    this.chezmoi = new ChezmoiAdapter({
      chezmoiBin: options.chezmoiBin,
      sourceDir: options.sourceDir,
      destinationDir: options.destinationDir,
      configPath: options.configPath,
    })
  }

  /**
   * Ensure this environment is registered in the synced registry AND that its own id
   * is mirrored into the local chezmoi config — the full identity setup (ADR 0024).
   *
   * Idempotent: re-running re-seeds the default Workspace + upserts this environment by
   * its stable id (no duplicate), and rewrites the local `[data].dotden_env_id`. This is
   * the "written at environment setup" step the acceptance criteria call for, with the
   * hostname used only as the default label, never as the id.
   *
   * @returns This environment's registry entry as stored.
   */
  async setupIdentity(): Promise<EnvironmentEntry> {
    await this.store.seedDefault({
      id: this.options.identity.id,
      label: this.options.identity.label,
      os: this.options.identity.os,
    })
    // Mirror the own id into the environment-local chezmoi config so a templated
    // `.chezmoiignore` can self-identify and read registry[id].subscribedWorkspaces.
    await this.chezmoi.writeEnvId(this.options.identity.id)
    const entry = await this.self()
    if (!entry) throw new Error('Environment registry seed did not record this environment')
    return entry
  }

  /**
   * Mirror this environment's own id into the local chezmoi config WITHOUT touching
   * the synced registry — used when claiming a returning entry (the id changed locally
   * but the synced entry already exists).
   *
   * @returns Absolute path to the config file written.
   */
  async mirrorOwnId(): Promise<string> {
    return this.chezmoi.writeEnvId(this.options.identity.id)
  }

  /**
   * Read the Workspaces of the Den (id + label), for the returning flow's subscription pick
   * (issue 1-13). A second environment chooses which of these it subscribes to.
   *
   * @returns Every Workspace in the synced `.dotden/` (the default Den seeds exactly one).
   */
  async workspaces(): Promise<readonly { id: string; label: string }[]> {
    const { workspaces } = await this.store.readWorkspaces()
    return workspaces.map((w) => ({ id: w.id, label: w.label }))
  }

  /**
   * **Register this (new or returning) environment with its chosen Workspace subscription**,
   * mirror its id into the local chezmoi config, and return the stored entry (issue 1-13).
   *
   * This is the **registry-entry guard's primary (ordering) layer**: it writes this
   * environment's entry — with its subscription, defaulting to ALL Workspaces — into the synced
   * registry BEFORE any apply, so the templated `.chezmoiignore` never hits the "no entry yet"
   * gap (the template's `*` fail-safe is only the backstop). It also mirrors `dotden_env_id` so
   * the template self-identifies. It does NOT touch any File on disk — Files are applied fresh
   * via the normal reviewed Apply (ADR 0024 "claiming only re-associates identity").
   *
   * Used for BOTH branches of the new-or-returning fork: a brand-new second environment, and a
   * returning one whose id was already adopted via
   * {@link import('./environment-identity.js').claimLocalIdentity} (so `this.options.identity.id`
   * is the claimed id and this upserts that existing entry's subscription).
   *
   * @param workspaceIds The Workspaces to subscribe to; defaults to ALL when omitted.
   * @returns This environment's registry entry as stored.
   */
  async registerWithSubscription(workspaceIds?: readonly string[]): Promise<EnvironmentEntry> {
    // Ensure the Workspace doc + `.dotden/` ignore rule exist (idempotent), then default the
    // subscription to ALL Workspaces (the issue's "defaulting to all") when none was chosen.
    const all = (await this.workspaces()).map((w) => w.id)
    const chosen = workspaceIds ?? all
    const entry = await this.store.setSubscriptions(
      {
        id: this.options.identity.id,
        label: this.options.identity.label,
        os: this.options.identity.os,
      },
      chosen,
    )
    // Mirror the own id so the templated `.chezmoiignore` can self-identify (issue 1-05).
    await this.chezmoi.writeEnvId(this.options.identity.id)
    return entry
  }

  /**
   * Rename THIS environment's label in the synced registry — a one-line diff, no churn.
   *
   * Renaming the label only changes the `label` field of this environment's entry; the
   * stable `id` is untouched, so identity (and all git-log attribution keyed on history)
   * survives. Maps to a single {@link DenStore.registerEnvironment} upsert keyed by id.
   *
   * @param label The new, user-edited display label (trimmed; must be non-empty).
   * @returns The updated registry entry.
   * @throws Error when `label` is blank, or when this environment is not yet registered.
   */
  async renameLabel(label: string): Promise<EnvironmentEntry> {
    const trimmed = label.trim()
    if (!trimmed) throw new Error('Environment label cannot be empty')
    const entry = await this.self()
    if (!entry) {
      throw new Error('Cannot rename an environment that is not registered yet')
    }
    const updated: EnvironmentEntry = { ...entry, label: trimmed }
    await this.store.registerEnvironment(updated)
    // Record the one-line `.dotden/` diff LOCALLY (ADR 0006) so the renamed label travels to
    // every environment on the next Sync — the registry is synced user-authored data (ADR 0024).
    await this.commitRegistry(`Rename environment to ${trimmed}`)
    return updated
  }

  /**
   * List every environment in the registry, joined with attribution derived LIVE from
   * git log (ADR 0024 — attribution is never persisted).
   *
   * For each entry, the most-recent matching Commit (by author name == label) provides
   * last-author/last-activity/subject, and a count provides total activity. This is the
   * data the Environments surface (issue 2-15) and "N incoming from `<environment>`"
   * (issue 1-09) read.
   *
   * @returns Each registered environment with `isSelf` and its computed attribution.
   */
  async list(): Promise<readonly EnvironmentWithAttribution[]> {
    const [{ environments }, records] = await Promise.all([
      this.store.readEnvironments(),
      this.readCommits(),
    ])
    return environments.map((entry) => ({
      ...entry,
      isSelf: entry.id === this.options.identity.id,
      attribution: attributionFor(entry, records),
    }))
  }

  /**
   * Read this environment's own registry entry, or null when not yet registered.
   *
   * Keyed strictly on the stable id, never the hostname — a hostname change does not
   * lose the entry, and two machines with the same hostname never collide.
   */
  async self(): Promise<EnvironmentEntry | null> {
    const { environments } = await this.store.readEnvironments()
    return environments.find((e) => e.id === this.options.identity.id) ?? null
  }

  /**
   * Suggest the likely registry entries this install is "returning" to (issue 1-13).
   *
   * Used by the new-or-returning fork when there is no local id: dotden ranks existing
   * entries by OS match + whether their label matches the setup-time hostname, but the
   * user still explicitly claims one — there is NO auto-merge (ADR 0024). Entries that
   * are already this environment's own id are excluded (you cannot "return" to yourself).
   *
   * @returns Candidate entries with the reasons each was suggested, best matches first.
   */
  async suggestClaims(): Promise<readonly ClaimSuggestion[]> {
    const { environments } = await this.store.readEnvironments()
    const host = this.options.identity.hostnameAtSetup
    const suggestions: ClaimSuggestion[] = []
    for (const entry of environments) {
      if (entry.id === this.options.identity.id) continue
      const reasons: ClaimSuggestion['reasons'] = [
        ...(entry.os === this.options.identity.os ? (['same-os'] as const) : []),
        ...(labelMatchesHost(entry.label, host) ? (['hostname-match'] as const) : []),
      ]
      if (reasons.length > 0) suggestions.push({ entry, reasons })
    }
    // Hostname match is the stronger signal, so rank those first; OS-only matches follow.
    return suggestions.sort((a, b) => score(b.reasons) - score(a.reasons))
  }

  /**
   * **Retire** (remove) a decommissioned environment from the synced registry (issue 2-15,
   * ADR 0024 lifecycle "Retire/remove drops a decommissioned environment").
   *
   * Drops the entry keyed by `envId`. Identity is the stable id, so this never removes the
   * wrong machine even when two share a hostname. Refuses to retire THIS running environment
   * (you cannot decommission the machine you are using — that would orphan the local id from
   * the registry and break self-listing); a returning machine should instead claim, and a
   * mistaken duplicate of *yourself* is folded with {@link reassign}. Attribution is never
   * touched — the retired environment's past `git log` history stays readable (ADR 0024).
   *
   * @param envId The stable id of the environment to retire.
   * @returns The full list (with attribution) AFTER removal, so the UI re-renders in one round-trip.
   * @throws Error when `envId` is THIS running environment, or when no such entry exists.
   */
  async retire(envId: string): Promise<readonly EnvironmentWithAttribution[]> {
    if (envId === this.options.identity.id) {
      throw new Error('Cannot retire the environment you are currently using')
    }
    const { environments } = await this.store.readEnvironments()
    if (!environments.some((e) => e.id === envId)) {
      throw new Error(`Cannot retire: no environment with id ${envId}`)
    }
    await this.store.removeEnvironment(envId)
    // The removal is a `.dotden/` diff — Commit LOCALLY so the retire travels (ADR 0006/0024).
    await this.commitRegistry(`Retire environment ${envId}`)
    return this.list()
  }

  /**
   * **Reassign / merge** a mistaken duplicate environment entry into the correct one (issue 2-15,
   * ADR 0024 lifecycle "Reassign/merge folds a duplicate entry into the correct one").
   *
   * Folds `fromId` (the duplicate) into `intoId` (the keeper) at the {@link DenStore} registry
   * seam: the keeper inherits the UNION of both subscriptions (a merge only ever widens access)
   * and the duplicate entry is dropped. The keeper's stable id is preserved, so its git-log
   * attribution stays continuous; past commits authored under the duplicate's label stay readable
   * in `git log` (attribution is never rewritten — ADR 0024). Refuses to FOLD AWAY this running
   * environment (`fromId` must not be self — that would orphan the local id); folding a duplicate
   * INTO self is allowed (the common "I accidentally registered twice" fix).
   *
   * @param fromId The duplicate entry to fold in and remove.
   * @param intoId The correct entry to keep.
   * @returns The full list (with attribution) AFTER the fold, so the UI re-renders in one round-trip.
   * @throws Error when `fromId` is THIS running environment, when the ids are equal, or when
   *   either id is absent (delegated to {@link DenStore.reassignEnvironment}).
   */
  async reassign(fromId: string, intoId: string): Promise<readonly EnvironmentWithAttribution[]> {
    if (fromId === this.options.identity.id) {
      throw new Error('Cannot reassign away the environment you are currently using')
    }
    // The store validates existence + the self-into-self no-op and unions the subscriptions.
    await this.store.reassignEnvironment(fromId, intoId)
    // The fold is a `.dotden/` diff — Commit LOCALLY so the merge travels (ADR 0006/0024).
    await this.commitRegistry(`Reassign environment ${fromId} into ${intoId}`)
    return this.list()
  }

  /**
   * Commit a `.dotden/`-only registry edit LOCALLY (ADR 0006), so a lifecycle change (rename /
   * reassign / retire) travels to every environment on the next Sync. Uses `commitIfChanged`
   * (idempotent) so a no-op mutation — e.g. retiring an already-absent id — records nothing and
   * never fails "nothing to commit". Mirrors {@link DenService}'s `commitMetadata` pattern; the
   * registry is its own committer here so the lifecycle ops are self-contained and travel-correct.
   */
  private async commitRegistry(message: string): Promise<void> {
    await this.git.commitIfChanged(['.dotden', '.chezmoiignore'], message)
  }

  /** Read + parse the source repo's git log once, for attribution joins. */
  private async readCommits(): Promise<readonly CommitRecord[]> {
    const raw = await this.git.log()
    if (!raw) return []
    return raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const [sha, authorName, authorEmail, date, ...subjectParts] = line.split(LOG_FIELD_SEP)
        return {
          // Defaults keep this total even if a malformed line is somehow read — a
          // missing field becomes empty rather than crashing the attribution join.
          sha: sha ?? '',
          authorName: authorName ?? '',
          authorEmail: authorEmail ?? '',
          date: date ?? '',
          // Re-join in case a (control-byte-free) subject somehow contained a separator.
          subject: subjectParts.join(LOG_FIELD_SEP),
        }
      })
  }
}

/**
 * Compute one entry's attribution from the parsed commit list.
 *
 * Commits are attributed to an environment by matching the git author NAME to the
 * environment's label — dotden's default Commit message/identity carries the label,
 * so this is the faithful join without storing anything. The list is newest-first
 * (git log default), so the first match is the latest activity.
 */
function attributionFor(
  entry: EnvironmentEntry,
  records: readonly CommitRecord[],
): EnvironmentAttribution {
  const mine = records.filter((r) => r.authorName === entry.label)
  const latest = mine[0]
  return {
    lastAuthorName: latest?.authorName,
    lastAuthorEmail: latest?.authorEmail,
    lastActivityAt: latest?.date,
    lastSubject: latest?.subject,
    commitCount: mine.length,
  }
}

/** Case-insensitive match of a label against a hostname (hostnames may include domain). */
function labelMatchesHost(label: string, host: string): boolean {
  const l = label.trim().toLowerCase()
  const h = host.trim().toLowerCase()
  if (!l || !h) return false
  // Match the bare hostname OR its first DNS label (e.g. "mbp" vs "mbp.local").
  return l === h || l === h.split('.')[0]
}

/** Rank a suggestion: a hostname match outweighs an OS-only match. */
function score(reasons: ClaimSuggestion['reasons']): number {
  return (reasons.includes('hostname-match') ? 2 : 0) + (reasons.includes('same-os') ? 1 : 0)
}
