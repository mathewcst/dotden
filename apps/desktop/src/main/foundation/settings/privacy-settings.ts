/**
 * Privacy settings — the environment-local consent store behind the Settings → Privacy tab
 * (issue 2-14, stories 43–44; ADR 0007 wide-events, ADR 0001 no-backend, ADR 0024 synced-vs-local).
 *
 * The Privacy tab is the **control surface** for telemetry consent: two INDEPENDENT opt-in
 * toggles the user flips to permit (or not) two distinct off-environment flows. Both default
 * **OFF**, so out of the box nothing ever leaves the environment — consent is the gate, and the
 * gate starts closed (privacy-by-default; never fail silently INTO a surprising egress).
 *
 * The consents are deliberately separate so the user can permit one without the others:
 *
 * - **`analyticsEnabled`** — permission to send anonymous, allowlisted usage **wide events**
 *   (ADR 0007) so the project can see which flows are used. By construction these carry only the
 *   bounded **Allowlisted attribute key** set (CONTEXT.md) — never a path, file content, secret,
 *   or repo URL. Off by default.
 * - **`crashReportsEnabled`** — permission to send a crash/error report (stack + app version)
 *   when dotden hits an unexpected failure, so bugs are diagnosable. Off by default.
 * - **`diagnosticLogsEnabled`** — permission to attach anonymized diagnostic logs to a crash
 *   report so a hard-to-reproduce failure is debuggable. Same allowlisted-key discipline as
 *   analytics — paths/contents/secrets/URLs are unrepresentable by construction. Off by default.
 *
 * **Consent is environment-local (ADR 0024).** It is a per-machine decision — a shared or
 * locked-down environment must be able to refuse telemetry independently of the user's other
 * machines — so it lives in Electron `userData` and **never** enters the synced `.dotden/`
 * directory. Mirrors {@link readSyncSettings}/{@link writeSyncSettings} exactly: Electron-free
 * (ADR 0023), it takes the userData dir as a path so the whole read/write round-trip is
 * unit-testable in plain Node; `index.ts` passes the real `app.getPath('userData')`.
 *
 * **CONTROL SURFACE ONLY (the load-bearing scope rule, issue 2-14).** This module persists the
 * consent flag and nothing else. It opens no network connection, loads no SDK, and reaches no
 * service. Flipping a toggle here records a stored boolean — the actual egress wiring (the
 * Sentry/Umami clients gated behind these flags, and the first-launch consent screen) is PRD 3
 * (issues 3-09/3-10), which will READ this flag. A missing/corrupt file degrades to the SAFE
 * all-off defaults — never to a surprising state that silently turns telemetry on.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PrivacySettings } from '../../../shared/settings.js'

/** Relative filename of the local privacy-settings file inside the userData dir. */
const PRIVACY_FILE = 'privacy-settings.json'

/**
 * The SAFE defaults for a fresh environment with no privacy-settings file yet: **all consents
 * OFF**.
 *
 * Privacy-by-default is the whole point of this surface (ADR 0001 keeps dotden backend-free; any
 * off-environment flow is strictly opt-in). Nothing is shared until the user deliberately turns
 * it on, and a missing/corrupt/forward-incompatible file degrades to exactly this all-off state
 * — it can never silently enable telemetry the user did not choose (never fail silently INTO
 * egress).
 */
export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  analyticsEnabled: false,
  crashReportsEnabled: false,
  diagnosticLogsEnabled: false,
}

/**
 * Read this environment's privacy/telemetry consent, defaulting each flag to **off**.
 *
 * A missing file, malformed JSON, or any individually-missing/invalid field falls back to the
 * corresponding {@link DEFAULT_PRIVACY_SETTINGS} value — i.e. OFF. Each field is validated
 * independently so a partially-written/forward-incompatible file still yields a coherent object
 * rather than throwing, and — critically for a consent gate — an unreadable file is treated as
 * "no consent given" rather than "consent" (fail CLOSED, never fail silently into egress).
 *
 * @param userDataDir Electron's `app.getPath('userData')`; a tempdir in tests.
 * @returns The persisted consent, with off-defaults filled in for anything absent/invalid.
 */
export async function readPrivacySettings(userDataDir: string): Promise<PrivacySettings> {
  try {
    const parsed = JSON.parse(await readFile(join(userDataDir, PRIVACY_FILE), 'utf8')) as Partial<
      Record<keyof PrivacySettings, unknown>
    >
    return {
      analyticsEnabled:
        typeof parsed.analyticsEnabled === 'boolean'
          ? parsed.analyticsEnabled
          : DEFAULT_PRIVACY_SETTINGS.analyticsEnabled,
      crashReportsEnabled:
        typeof parsed.crashReportsEnabled === 'boolean'
          ? parsed.crashReportsEnabled
          : DEFAULT_PRIVACY_SETTINGS.crashReportsEnabled,
      diagnosticLogsEnabled:
        typeof parsed.diagnosticLogsEnabled === 'boolean'
          ? parsed.diagnosticLogsEnabled
          : DEFAULT_PRIVACY_SETTINGS.diagnosticLogsEnabled,
    }
  } catch {
    // Unreadable/corrupt → fail CLOSED to all-off (the consent gate must never default open).
    return DEFAULT_PRIVACY_SETTINGS
  }
}

/**
 * Persist this environment's privacy/telemetry consent (the Privacy tab's two toggles).
 *
 * Writes the full {@link PrivacySettings} object so a later read never has to merge — the file is
 * always coherent. The caller (the IPC bridge) passes the complete next state; the Privacy tab
 * reads the current consent, flips one flag, and writes the whole object back.
 *
 * This is the ENTIRE side effect of flipping a toggle in v1: a local JSON write. No network call,
 * no SDK, no egress — the consumers that act on consent are PRD 3 (issues 3-09/3-10), which read
 * this file (issue 2-14 is control-surface-only).
 *
 * @param userDataDir Electron's `app.getPath('userData')`; a tempdir in tests.
 * @param settings The complete next consent state to persist.
 */
export async function writePrivacySettings(
  userDataDir: string,
  settings: PrivacySettings,
): Promise<void> {
  const file = join(userDataDir, PRIVACY_FILE)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(settings satisfies PrivacySettings, null, 2)}\n`, 'utf8')
}
