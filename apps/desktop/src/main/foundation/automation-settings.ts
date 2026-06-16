/**
 * Automation settings — the environment-local automation-level store (issue 1-12, ADR 0024).
 *
 * The chosen {@link AutomationLevel} is **environment-local** state, NOT synced: Auto-sync
 * is "environment-local" by definition (CONTEXT.md "Auto-sync"), because each environment
 * decides for itself how hands-off it wants to be — turning Auto-sync on at the office
 * laptop must not force it on at a shared machine. So, exactly like the environment
 * identity, this lives in Electron `userData` and never enters the synced `.myenv/`
 * (ADR 0024's synced-vs-local split).
 *
 * It is Electron-free (ADR 0023): it takes the userData dir as a path so the whole
 * read/write round-trip is unit-testable in plain Node; `index.ts` passes the real
 * `app.getPath('userData')`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  DEFAULT_AUTOMATION_LEVEL,
  isMvpAutomationLevel,
  type AutomationLevel,
} from './automation-policy.js'

/** Relative filename of the local automation-settings file inside the userData dir. */
const AUTOMATION_FILE = 'automation-settings.json'

/** On-disk shape of the environment-local automation settings (never synced). */
interface PersistedAutomation {
  /** The selected automation rung; absent/invalid ⇒ the safe Manual default. */
  readonly level?: AutomationLevel
}

/**
 * Read this environment's automation level, defaulting to the safe Manual rung.
 *
 * A missing file, malformed JSON, or a level that is not an MVP-selectable rung all fall
 * back to {@link DEFAULT_AUTOMATION_LEVEL} (`manual`) — never to a more-automated state,
 * so a corrupt/forward-incompatible settings file can never silently turn automation ON
 * (fail safe, never fail silently into a riskier mode).
 *
 * @param userDataDir Electron's `app.getPath('userData')`; a tempdir in tests.
 * @returns The persisted automation level, or Manual when none/invalid.
 */
export async function readAutomationLevel(userDataDir: string): Promise<AutomationLevel> {
  try {
    const parsed = JSON.parse(
      await readFile(join(userDataDir, AUTOMATION_FILE), 'utf8'),
    ) as PersistedAutomation
    // Only honor a rung the MVP actually exposes (Manual/Auto-sync). An `auto-apply`/`yolo`
    // value written by a future build is NOT silently respected by this MVP — it falls back
    // to Manual rather than enabling behavior this version does not implement.
    return isMvpAutomationLevel(parsed.level) ? parsed.level : DEFAULT_AUTOMATION_LEVEL
  } catch {
    return DEFAULT_AUTOMATION_LEVEL
  }
}

/**
 * Persist this environment's automation level (the onboarding opt-in + the Settings toggle).
 *
 * Rejects any level the MVP does not expose, so the only states that can be written are
 * Manual and Auto-sync — the engine can therefore trust a read value without re-validating
 * against unbuilt behavior.
 *
 * @param userDataDir Electron's `app.getPath('userData')`; a tempdir in tests.
 * @param level The MVP-selectable level to persist (`manual` or `auto-sync`).
 * @throws Error when `level` is not an MVP-selectable rung (never persist an unbuilt level).
 */
export async function writeAutomationLevel(
  userDataDir: string,
  level: AutomationLevel,
): Promise<void> {
  if (!isMvpAutomationLevel(level)) {
    throw new Error(`Cannot set unsupported automation level "${level}" (MVP = manual | auto-sync)`)
  }
  const file = join(userDataDir, AUTOMATION_FILE)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(
    file,
    `${JSON.stringify({ level } satisfies PersistedAutomation, null, 2)}\n`,
    'utf8',
  )
}
