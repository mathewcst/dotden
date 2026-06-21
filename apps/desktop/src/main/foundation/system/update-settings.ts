import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { UpdateSettings } from '../../../shared/app-info.js'

const FILE = 'update-settings.json'

/** Default update preferences for one environment. */
export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = {
  autoUpdateEnabled: true,
  channel: 'stable',
  lastCheckedAt: null,
}

function pathFor(userDataDir: string): string {
  return join(userDataDir, FILE)
}

function normalize(value: unknown): UpdateSettings {
  const raw = value as Partial<UpdateSettings> | null
  return {
    autoUpdateEnabled:
      typeof raw?.autoUpdateEnabled === 'boolean'
        ? raw.autoUpdateEnabled
        : DEFAULT_UPDATE_SETTINGS.autoUpdateEnabled,
    channel: raw?.channel === 'beta' ? 'beta' : DEFAULT_UPDATE_SETTINGS.channel,
    lastCheckedAt:
      typeof raw?.lastCheckedAt === 'string'
        ? raw.lastCheckedAt
        : DEFAULT_UPDATE_SETTINGS.lastCheckedAt,
  }
}

/** Read environment-local update preferences from Electron userData. */
export async function readUpdateSettings(userDataDir: string): Promise<UpdateSettings> {
  try {
    return normalize(JSON.parse(await readFile(pathFor(userDataDir), 'utf8')))
  } catch {
    return DEFAULT_UPDATE_SETTINGS
  }
}

/** Persist environment-local update preferences. */
export async function writeUpdateSettings(
  userDataDir: string,
  settings: UpdateSettings,
): Promise<UpdateSettings> {
  const normalized = normalize(settings)
  const file = pathFor(userDataDir)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  return normalized
}
