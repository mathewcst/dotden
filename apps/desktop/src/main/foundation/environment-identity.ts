/**
 * Environment identity — the stable, environment-local id (ADR 0024).
 *
 * Each environment has a **stable random ID** that is its identity; the hostname is
 * never the identity (hostnames collide and change, ADR 0024 / CONTEXT.md
 * "environment"). Instead the hostname is used only for two presentation/UX roles:
 *
 * 1. the **default `label`** the user sees (and may rename), and
 * 2. the **returning-claim match hint** — when a fresh install has no local id, the
 *    "new or returning?" fork (issue 1-13) suggests the likely existing registry
 *    entry by OS + the hostname captured at the *original* setup.
 *
 * The id itself is environment-LOCAL state (it lives in Electron `userData`, never
 * synced); only the registry *entry* keyed by it is synced into `.myenv/`. This
 * module mints and persists that local id (plus the setup-time hostname, so the
 * match hint survives a later hostname change), and derives the default label.
 *
 * It is Electron-free (ADR 0023): it takes the userData dir as a path so it can be
 * unit-tested in plain Node.
 */
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** This environment's local identity: a stable id plus its OS and default label. */
export interface EnvironmentIdentity {
  /** Stable random id — the environment's identity, persisted locally and never synced. */
  readonly id: string
  /** Default display label, derived from the hostname on first run (user-editable later). */
  readonly label: string
  /** Operating system, from `process.platform`. */
  readonly os: string
  /**
   * Hostname captured at setup — the returning-claim match hint, NOT the identity.
   *
   * Persisted alongside the id so that, even if the user later renames the machine,
   * a reinstall's "new or returning?" fork can still suggest the matching registry
   * entry by the *original* hostname (hostnames change; the id never does). It is
   * deliberately not the `label`, which the user may have edited away from it.
   */
  readonly hostnameAtSetup: string
}

/** On-disk shape of the local identity file (everything synced lives in `.myenv/`, not here). */
interface PersistedIdentity {
  /** Stable random id minted at setup. */
  readonly id: string
  /** Hostname at the moment of setup, frozen as the claim hint. */
  readonly hostnameAtSetup?: string
}

/** Relative filename of the local identity file inside the userData dir. */
const IDENTITY_FILE = 'environment-identity.json'

/**
 * Load this environment's identity, minting and persisting a fresh id on first run.
 *
 * Reads `<userDataDir>/environment-identity.json`; if absent, generates a random
 * UUID and freezes the current hostname as the claim hint, writing both so the id
 * is stable across launches (ADR 0024 "written on first run"). The `label` defaults
 * from the *current* hostname (so a freshly-renamed machine reads naturally) and the
 * OS from `process.platform`; both are derivable on every load, so only the id and
 * the setup-time hostname must persist.
 *
 * A **missing** local id (fresh or wiped install) is exactly the signal the
 * "new or returning?" fork keys on (issue 1-13): this function MINTS one (the "new"
 * branch). The "returning" branch instead adopts an existing registry id via
 * {@link claimLocalIdentity}.
 *
 * @param userDataDir Electron's `app.getPath('userData')` in production; a tempdir in tests.
 * @returns The stable id plus the current host's default label, OS, and the claim hint.
 */
export async function loadEnvironmentIdentity(userDataDir: string): Promise<EnvironmentIdentity> {
  const file = join(userDataDir, IDENTITY_FILE)
  const persisted = (await readPersisted(file)) ?? (await mintAndPersist(file))
  return {
    id: persisted.id,
    label: hostname() || 'this environment',
    os: process.platform,
    hostnameAtSetup: (persisted.hostnameAtSetup ?? hostname()) || 'this environment',
  }
}

/**
 * Read whether this environment already has a minted local id, WITHOUT minting one.
 *
 * This is the probe the "new or returning?" fork uses (issue 1-13): a `null` here
 * means there is no local identity yet, so the user must choose to start a new
 * environment ({@link loadEnvironmentIdentity}) or claim an existing registry entry
 * ({@link claimLocalIdentity}). Unlike {@link loadEnvironmentIdentity} it has no
 * side effects, so calling it never commits the install to a fresh id.
 *
 * @param userDataDir Electron's `app.getPath('userData')`; a tempdir in tests.
 * @returns The persisted id when one exists, else null.
 */
export async function readLocalIdentity(userDataDir: string): Promise<string | null> {
  const persisted = await readPersisted(join(userDataDir, IDENTITY_FILE))
  return persisted?.id ?? null
}

/**
 * Adopt an existing registry entry's id as THIS install's local identity — the
 * "returning" branch of the new-or-returning fork (issue 1-13, ADR 0024 lifecycle).
 *
 * Claiming only re-associates identity: it writes the chosen id (and freezes the
 * current hostname as the claim hint) into local state so this install IS the
 * returning environment, and its git-log history/attribution stay continuous. It
 * does not touch the synced registry or any files — Files are applied fresh from the
 * repo via normal Apply. Duplicates are resolved by the explicit Reassign/merge
 * lifecycle, never by silent auto-merge.
 *
 * @param userDataDir Electron's `app.getPath('userData')`; a tempdir in tests.
 * @param id The existing registry entry's stable id to adopt.
 * @returns The resulting local identity (now carrying the claimed id).
 */
export async function claimLocalIdentity(
  userDataDir: string,
  id: string,
): Promise<EnvironmentIdentity> {
  if (!id) throw new Error('Cannot claim an environment with an empty id')
  const file = join(userDataDir, IDENTITY_FILE)
  await persist(file, { id, hostnameAtSetup: hostname() || 'this environment' })
  return loadEnvironmentIdentity(userDataDir)
}

/** Read the persisted identity, or null when the identity file does not exist yet. */
async function readPersisted(file: string): Promise<PersistedIdentity | null> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<PersistedIdentity>
    if (typeof parsed.id !== 'string' || parsed.id.length === 0) return null
    return {
      id: parsed.id,
      hostnameAtSetup:
        typeof parsed.hostnameAtSetup === 'string' ? parsed.hostnameAtSetup : undefined,
    }
  } catch {
    return null
  }
}

/** Generate a stable random id, freeze the current hostname, and persist both. */
async function mintAndPersist(file: string): Promise<PersistedIdentity> {
  const identity: PersistedIdentity = {
    id: randomUUID(),
    hostnameAtSetup: hostname() || 'this environment',
  }
  await persist(file, identity)
  return identity
}

/** Serialize+write the local identity file, creating parent dirs as needed. */
async function persist(file: string, identity: PersistedIdentity): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(identity, null, 2)}\n`, 'utf8')
}
