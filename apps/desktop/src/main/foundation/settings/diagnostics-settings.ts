/**
 * Diagnostics settings — environment-local preferences for the PRD4 Console surface.
 *
 * The standing Console is a per-machine power-user preference, so it lives under Electron
 * `userData` and never enters the synced Den. Missing/corrupt files fall back to OFF so the
 * Console never appears unless the user opts in.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DiagnosticsSettings } from '../../../shared/settings.js'

const DIAGNOSTICS_SETTINGS_FILE = 'diagnostics-settings.json'

/** Default Diagnostics settings: the standing Console is off. */
export const DEFAULT_DIAGNOSTICS_SETTINGS: DiagnosticsSettings = {
  consoleEnabled: false,
}

/** Read this environment's Diagnostics preferences. */
export async function readDiagnosticsSettings(userDataDir: string): Promise<DiagnosticsSettings> {
  try {
    const parsed = JSON.parse(
      await readFile(join(userDataDir, DIAGNOSTICS_SETTINGS_FILE), 'utf8'),
    ) as Partial<Record<keyof DiagnosticsSettings, unknown>>
    return {
      consoleEnabled:
        typeof parsed.consoleEnabled === 'boolean'
          ? parsed.consoleEnabled
          : DEFAULT_DIAGNOSTICS_SETTINGS.consoleEnabled,
    }
  } catch {
    return DEFAULT_DIAGNOSTICS_SETTINGS
  }
}

/** Persist this environment's Diagnostics preferences. */
export async function writeDiagnosticsSettings(
  userDataDir: string,
  settings: DiagnosticsSettings,
): Promise<void> {
  const file = join(userDataDir, DIAGNOSTICS_SETTINGS_FILE)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(
    file,
    `${JSON.stringify(settings satisfies DiagnosticsSettings, null, 2)}\n`,
    'utf8',
  )
}
