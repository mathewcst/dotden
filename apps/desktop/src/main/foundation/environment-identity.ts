/**
 * Environment identity — the stable, environment-local id (ADR 0024).
 *
 * Each environment has a **stable random ID** that is its identity; the hostname is
 * never the identity (hostnames collide and change, ADR 0024 / CONTEXT.md
 * "environment"). The id itself is environment-LOCAL state (it lives in Electron
 * `userData`, never synced); only the registry *entry* keyed by it is synced into
 * `.myenv/`. This module mints and persists that local id, plus the default
 * hostname-derived label.
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
}

/**
 * Load this environment's identity, minting and persisting a fresh id on first run.
 *
 * Reads `<userDataDir>/environment-identity.json`; if absent, generates a random
 * UUID and writes it, so the id is stable across launches (ADR 0024 "written on
 * first run"). The label defaults from the hostname and the OS from
 * `process.platform`; both come from the current host on every load since they are
 * derivable, while only the id must persist.
 *
 * @param userDataDir Electron's `app.getPath('userData')` in production; a tempdir in tests.
 * @returns The stable id plus the current host's default label and OS.
 */
export async function loadEnvironmentIdentity(userDataDir: string): Promise<EnvironmentIdentity> {
  const file = join(userDataDir, 'environment-identity.json')
  const id = (await readPersistedId(file)) ?? (await mintAndPersistId(file))
  return { id, label: hostname() || 'this environment', os: process.platform }
}

/** Read the persisted id, or null when the identity file does not exist yet. */
async function readPersistedId(file: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { id?: unknown }
    return typeof parsed.id === 'string' && parsed.id.length > 0 ? parsed.id : null
  } catch {
    return null
  }
}

/** Generate a stable random id and persist it for future launches. */
async function mintAndPersistId(file: string): Promise<string> {
  const id = randomUUID()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify({ id }, null, 2)}\n`, 'utf8')
  return id
}
