/**
 * pm-preference — the environment-local "Remember my choice" password-manager store (issue 2-05).
 *
 * The "Remember my choice for the future" toggle in the picker records the user's preferred
 * manager so a later conversion can go straight to it (acceptance criterion 5). That preference is
 * **environment-local, never synced** (acceptance criterion 10, ADR 0024): which password manager
 * a given computer uses is a property of *that* computer — the office laptop might have `op`, a
 * shared box only `pass` — so forcing one environment's choice onto another would be wrong. It
 * therefore lives in Electron `userData`, exactly like the automation level
 * ({@link import('./automation-settings.js')}), never in the synced `.myenv/`.
 *
 * Electron-free (ADR 0023): it takes the userData dir as a path, so the read/write round-trip is
 * unit-testable in plain Node; `index.ts` passes the real `app.getPath('userData')`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PASSWORD_MANAGERS, type PasswordManagerId } from './secret-reference.js'

/** Relative filename of the environment-local PM-preference file inside the userData dir. */
const PM_PREFERENCE_FILE = 'pm-preference.json'

/**
 * The remembered conversion default — the preferred manager + (for 1Password) the chosen account.
 * `null` (absent file) means "no remembered choice; ask which manager each time".
 */
export interface PmPreference {
  /** The preferred password manager future conversions go straight to. */
  readonly manager: PasswordManagerId
  /** (1Password) the remembered non-default account, if the user picked one. */
  readonly account?: string
}

/** Whether `id` is one of the v1-supported managers — guards reads + writes against stale ids. */
function isKnownManager(id: unknown): id is PasswordManagerId {
  return PASSWORD_MANAGERS.some((manager) => manager.id === id)
}

/**
 * Read this environment's remembered password-manager preference, or `null` when none is set.
 *
 * A missing file, malformed JSON, or a stored manager that is not a known v1 manager all fall back
 * to `null` ("no preference") — never to a wrong/unsupported manager. So a corrupt or
 * forward-incompatible file simply re-asks the picker rather than silently converting against the
 * wrong vault (fail safe, never fail silently).
 *
 * @param userDataDir Electron's `app.getPath('userData')`; a tempdir in tests.
 * @returns The remembered preference, or `null` when none/invalid.
 */
export async function readPmPreference(userDataDir: string): Promise<PmPreference | null> {
  try {
    const parsed = JSON.parse(await readFile(join(userDataDir, PM_PREFERENCE_FILE), 'utf8')) as {
      manager?: unknown
      account?: unknown
    }
    if (!isKnownManager(parsed.manager)) return null
    const account = typeof parsed.account === 'string' ? parsed.account : undefined
    return account ? { manager: parsed.manager, account } : { manager: parsed.manager }
  } catch {
    return null
  }
}

/**
 * Persist this environment's preferred password manager (the picker's "Remember my choice" toggle).
 *
 * Rejects an unknown manager id so only a real v1 manager can ever be written — a later read can
 * therefore trust the value without re-validating against unbuilt managers.
 *
 * @param userDataDir Electron's `app.getPath('userData')`; a tempdir in tests.
 * @param preference The manager (+ optional 1Password account) to remember.
 * @throws {Error} When `preference.manager` is not a supported v1 manager.
 */
export async function writePmPreference(
  userDataDir: string,
  preference: PmPreference,
): Promise<void> {
  if (!isKnownManager(preference.manager)) {
    throw new Error(
      `Cannot remember unsupported password manager "${preference.manager}" (v1 = op | bw | pass)`,
    )
  }
  const file = join(userDataDir, PM_PREFERENCE_FILE)
  await mkdir(dirname(file), { recursive: true })
  // Only persist a non-empty account — keep the file minimal + the round-trip exact.
  const account = preference.account?.trim()
  const payload: PmPreference =
    account && account.length > 0
      ? { manager: preference.manager, account }
      : { manager: preference.manager }
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}
