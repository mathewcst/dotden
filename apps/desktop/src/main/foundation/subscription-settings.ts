/**
 * Subscription settings — the environment-local "what to do with un-subscribed Files"
 * preference store (issue 1-13, ADR 0024).
 *
 * Un-subscribing a Workspace stops chezmoi *managing* its Files here, but `.chezmoiignore`
 * alone does NOT delete them (the subscription spike proved this) — so dotden must ask the
 * user whether to **remove those Files from this environment's disk** or **keep them in
 * place** as untracked orphans. Because the right answer varies per user (a shared machine
 * wants them gone; a personal machine may keep them), the issue calls for a **remembered
 * default** so the user is not re-asked every time.
 *
 * The remembered default is **environment-local** (a property of how THIS machine likes to
 * handle orphans, never a shared decision), so — exactly like the automation level and the
 * environment identity — it lives in Electron `userData` and never enters the synced
 * `.dotden/` (ADR 0024's synced-vs-local split). Electron-free (ADR 0023): it takes the
 * userData dir as a path so the round-trip is unit-testable in plain Node.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * What to do with the Files of a Workspace this environment just un-subscribed from.
 *
 * - `keep` — leave the Files on disk as untracked orphans (chezmoi simply stops managing
 *   them); nothing is deleted. Safe default.
 * - `remove` — explicitly delete the Files from this environment's disk (a `chezmoi forget`
 *   + target-remove), because `.chezmoiignore` alone never removes them.
 */
export type UnsubscribeDisposition = 'keep' | 'remove'

/** The safe default: keep the Files on disk (never delete unless the user asked, issue 1-13). */
export const DEFAULT_UNSUBSCRIBE_DISPOSITION: UnsubscribeDisposition = 'keep'

/** Relative filename of the local subscription-settings file inside the userData dir. */
const SUBSCRIPTION_FILE = 'subscription-settings.json'

/** On-disk shape of the environment-local subscription settings (never synced). */
interface PersistedSubscriptionSettings {
  /** The remembered "keep vs remove un-subscribed Files" default; absent ⇒ the safe `keep`. */
  readonly unsubscribeDisposition?: UnsubscribeDisposition
}

/** True when `value` is one of the two valid dispositions (guards forward-incompatible files). */
function isDisposition(value: unknown): value is UnsubscribeDisposition {
  return value === 'keep' || value === 'remove'
}

/**
 * Read this environment's remembered "what to do with un-subscribed Files" default.
 *
 * A missing file, malformed JSON, or an unrecognized value all fall back to the safe
 * {@link DEFAULT_UNSUBSCRIBE_DISPOSITION} (`keep`) — never to `remove`, so a corrupt or
 * forward-incompatible settings file can never silently start deleting Files (fail safe).
 *
 * @param userDataDir Electron's `app.getPath('userData')`; a tempdir in tests.
 * @returns The remembered disposition, or `keep` when none/invalid.
 */
export async function readUnsubscribeDisposition(
  userDataDir: string,
): Promise<UnsubscribeDisposition> {
  try {
    const parsed = JSON.parse(
      await readFile(join(userDataDir, SUBSCRIPTION_FILE), 'utf8'),
    ) as PersistedSubscriptionSettings
    return isDisposition(parsed.unsubscribeDisposition)
      ? parsed.unsubscribeDisposition
      : DEFAULT_UNSUBSCRIBE_DISPOSITION
  } catch {
    return DEFAULT_UNSUBSCRIBE_DISPOSITION
  }
}

/**
 * Persist this environment's remembered "what to do with un-subscribed Files" default — the
 * "don't ask me again" choice (issue 1-13).
 *
 * @param userDataDir Electron's `app.getPath('userData')`; a tempdir in tests.
 * @param disposition The disposition to remember (`keep` or `remove`).
 * @throws Error when `disposition` is not a valid value (never persist an unknown default).
 */
export async function writeUnsubscribeDisposition(
  userDataDir: string,
  disposition: UnsubscribeDisposition,
): Promise<void> {
  if (!isDisposition(disposition)) {
    throw new Error(`Cannot remember unsupported unsubscribe disposition "${disposition}"`)
  }
  const file = join(userDataDir, SUBSCRIPTION_FILE)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(
    file,
    `${JSON.stringify({ unsubscribeDisposition: disposition } satisfies PersistedSubscriptionSettings, null, 2)}\n`,
    'utf8',
  )
}
