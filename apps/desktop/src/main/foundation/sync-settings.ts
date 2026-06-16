/**
 * Sync settings — the environment-local store for the **Sync & polling** tab (issue 2-08,
 * ADR 0024).
 *
 * The Sync tab controls three preferences, all of which are **environment-local facts**
 * (paths/runtime/per-machine behavior), NOT user-authored organization — so by ADR 0024's
 * synced-vs-local split they live in Electron `userData` and **never** enter the synced
 * `.myenv/` directory:
 *
 * - **`pollerEnabled`** — whether the always-on TrayPoller watches the Remote at all. Each
 *   environment decides whether it wants the background watcher running (a shared/locked-down
 *   machine may want it off), so this is per-environment, never synced.
 * - **`cadence`** — how aggressively the poller checks the Remote: `fast` (≈2–5 min active /
 *   15–30 min idle) vs `relaxed` (a slower battery-friendly profile). Maps onto the
 *   {@link PollCadence} bounds the {@link TrayPoller} already consumes (issue 1-12).
 * - **`startOnLogin`** — whether dotden launches at login so the tray (and therefore the
 *   watcher) is present without the user opening the app. Realized via Electron's
 *   `app.setLoginItemSettings` in `index.ts`; the bare preference is stored here.
 *
 * Mirrors {@link readAutomationLevel}/{@link writeAutomationLevel} exactly: it is Electron-free
 * (ADR 0023) — it takes the userData dir as a path so the whole read/write round-trip is
 * unit-testable in plain Node; `index.ts` passes the real `app.getPath('userData')`.
 *
 * A synced setting acts only as a default; this is one of the per-environment overrides ADR
 * 0024 keeps local. A missing/corrupt file falls back to the SAFE defaults below — never to a
 * surprising state (never fail silently into something the user did not choose).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Relative filename of the local sync-settings file inside the userData dir. */
const SYNC_FILE = 'sync-settings.json'

/**
 * How aggressively the TrayPoller checks the Remote (issue 2-08, maps onto {@link PollCadence}).
 *
 * - `fast` — the lively profile (≈2–5 min active · 15–30 min idle, scope-v1 "Poll cadence");
 *   the default, so incoming changes are noticed promptly.
 * - `relaxed` — a slower, battery-friendlier ceiling for a machine the user wants to keep quiet.
 *
 * Only the named *profile* is stored (never raw millisecond bounds), so the concrete cadence
 * numbers stay owned by the poller and can evolve without rewriting users' settings files.
 */
export type PollCadenceProfile = 'fast' | 'relaxed'

/**
 * The environment-local Sync preferences the Sync tab reads/writes (never synced — ADR 0024).
 */
export interface SyncSettings {
  /** Whether the always-on TrayPoller runs on this environment (default: on). */
  readonly pollerEnabled: boolean
  /** How aggressively the poller checks the Remote (default: `fast`). */
  readonly cadence: PollCadenceProfile
  /** Whether dotden starts at login so the tray/watcher is present (default: off). */
  readonly startOnLogin: boolean
}

/**
 * The SAFE defaults for a fresh environment with no settings file yet.
 *
 * - The poller is **on** — awareness of incoming changes is the baseline value of the app
 *   (detect-only is not automation, ADR 0006/issue 1-12), so a fresh install watches by default.
 * - The cadence is **fast** — notice incoming changes promptly out of the box; the user can
 *   relax it on a machine they want quieter.
 * - Start-on-login is **off** — autostart is an explicit opt-in, never forced on a user's
 *   machine without their say (least-surprise).
 */
export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  pollerEnabled: true,
  cadence: 'fast',
  startOnLogin: false,
}

/** True when `value` is a known poll-cadence profile (`fast` or `relaxed`). */
function isCadenceProfile(value: unknown): value is PollCadenceProfile {
  return value === 'fast' || value === 'relaxed'
}

/**
 * Read this environment's Sync settings, defaulting each field to its SAFE default.
 *
 * A missing file, malformed JSON, or any individually-missing/invalid field falls back to the
 * corresponding {@link DEFAULT_SYNC_SETTINGS} value — never to a surprising state. Each field is
 * validated independently so a partially-written/forward-incompatible file still yields a
 * coherent settings object rather than throwing (never fail silently; degrade to safe defaults).
 *
 * @param userDataDir Electron's `app.getPath('userData')`; a tempdir in tests.
 * @returns The persisted Sync settings, with safe defaults filled in for anything absent/invalid.
 */
export async function readSyncSettings(userDataDir: string): Promise<SyncSettings> {
  try {
    const parsed = JSON.parse(await readFile(join(userDataDir, SYNC_FILE), 'utf8')) as Partial<
      Record<keyof SyncSettings, unknown>
    >
    return {
      pollerEnabled:
        typeof parsed.pollerEnabled === 'boolean'
          ? parsed.pollerEnabled
          : DEFAULT_SYNC_SETTINGS.pollerEnabled,
      cadence: isCadenceProfile(parsed.cadence) ? parsed.cadence : DEFAULT_SYNC_SETTINGS.cadence,
      startOnLogin:
        typeof parsed.startOnLogin === 'boolean'
          ? parsed.startOnLogin
          : DEFAULT_SYNC_SETTINGS.startOnLogin,
    }
  } catch {
    return DEFAULT_SYNC_SETTINGS
  }
}

/**
 * Persist this environment's Sync settings (the Sync tab toggles + cadence picker).
 *
 * Writes the full {@link SyncSettings} object so a later read never has to merge — the file is
 * always coherent. The caller (the IPC bridge) passes the complete next state; the Sync tab
 * reads the current settings, flips one field, and writes the whole object back.
 *
 * @param userDataDir Electron's `app.getPath('userData')`; a tempdir in tests.
 * @param settings The complete next Sync settings to persist.
 */
export async function writeSyncSettings(
  userDataDir: string,
  settings: SyncSettings,
): Promise<void> {
  const file = join(userDataDir, SYNC_FILE)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(settings satisfies SyncSettings, null, 2)}\n`, 'utf8')
}
