/**
 * Automation settings — the environment-local automation-level store (issue 1-12, ADR 0024).
 *
 * The chosen {@link AutomationLevel} is **environment-local** state, NOT synced: Auto-sync
 * is "environment-local" by definition (CONTEXT.md "Auto-sync"), because each environment
 * decides for itself how hands-off it wants to be — turning Auto-sync on at the office
 * laptop must not force it on at a shared machine. So, exactly like the environment
 * identity, this lives in Electron `userData` and never enters the synced `.dotden/`
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
  isSelectableAutomationLevel,
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
    // Only honor a selectable rung (Manual/Auto-sync/Auto-apply/YOLO). An unrecognized level
    // written by a future build is NOT silently respected — it falls back to Manual rather
    // than enabling behavior this version does not implement (fail safe, never fail silently).
    return isSelectableAutomationLevel(parsed.level) ? parsed.level : DEFAULT_AUTOMATION_LEVEL
  } catch {
    return DEFAULT_AUTOMATION_LEVEL
  }
}

/**
 * Persist this environment's automation level (the onboarding opt-in + the Settings toggle).
 *
 * Rejects any non-selectable level, so the only states that can be written are the four
 * built rungs — Manual, Auto-sync, Auto-apply, and YOLO — and the engine can therefore
 * trust a read value without re-validating against unbuilt behavior.
 *
 * @param userDataDir Electron's `app.getPath('userData')`; a tempdir in tests.
 * @param level The selectable level to persist (`manual` | `auto-sync` | `auto-apply` | `yolo`).
 * @throws Error when `level` is not a selectable rung (never persist an unbuilt level).
 */
export async function writeAutomationLevel(
  userDataDir: string,
  level: AutomationLevel,
): Promise<void> {
  if (!isSelectableAutomationLevel(level)) {
    throw new Error(
      `Cannot set unsupported automation level "${level}" (selectable = manual | auto-sync | auto-apply | yolo)`,
    )
  }
  const file = join(userDataDir, AUTOMATION_FILE)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(
    file,
    `${JSON.stringify({ level } satisfies PersistedAutomation, null, 2)}\n`,
    'utf8',
  )
}
