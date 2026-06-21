/**
 * Appearance local override — the environment-local store for THIS environment's override of the
 * SYNCED appearance defaults (issue 2-17, ADR 0024).
 *
 * ADR 0024's governing rule for the three appearance settings (theme, default Apply behaviour,
 * notification flags): each SYNCED value is a **shared default**, and an environment **may override
 * it locally** without changing it everywhere. The synced default lives in the synced `.dotden/`
 * directory (issue 2-10, {@link import('./den-store.js').DenStore.readAppearanceSettings}); the
 * per-environment override that SHADOWS it lives HERE — in Electron `userData`, and **never** enters
 * the synced source tree — so pinning a local override never mutates the value other environments
 * read (the load-bearing guarantee this issue proves).
 *
 * The override is a **sparse partial** ({@link AppearanceOverride}): only the fields the user pinned
 * locally are present; an absent field means "inherit the synced default". The effective settings an
 * environment renders are computed by {@link resolveAppearanceSettings} (the pure precedence rule —
 * local field beats synced field — owned by `shared/appearance-settings.ts`), which DenService calls.
 *
 * Mirrors {@link import('./sync-settings.js').readSyncSettings} /
 * {@link import('./privacy-settings.js').readPrivacySettings} exactly: it is Electron-free (ADR 0023)
 * — it takes the userData dir as a path so the whole read/write round-trip is unit-testable in plain
 * Node; `index.ts` passes the real `app.getPath('userData')`. A missing/corrupt file degrades to the
 * EMPTY override (follow the synced defaults for everything) — never fail silently into a surprising
 * local pin the user did not set.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  EMPTY_APPEARANCE_OVERRIDE,
  normalizeAppearanceOverride,
  type AppearanceOverride,
} from '../../../shared/appearance-settings.js'

/** Relative filename of the local appearance-override file inside the userData dir. */
const OVERRIDE_FILE = 'appearance-override.json'

/**
 * Read this environment's LOCAL appearance override, defaulting to the EMPTY override (follow the
 * synced defaults for everything) when absent or malformed.
 *
 * A missing file, malformed JSON, or any individually-invalid field degrades to "not pinned" for
 * that field (it falls through to the synced default) rather than throwing — a partial/garbage
 * override file still yields a coherent sparse override (never fail silently into a surprising pin).
 * The normalization (which fields are validly pinned) is owned by the shared
 * {@link normalizeAppearanceOverride}, so the renderer and main normalize identically.
 *
 * @param userDataDir Electron's `app.getPath('userData')`; a tempdir in tests.
 * @returns This environment's sparse override (only the validly-pinned fields), or `{}` when none.
 */
export async function readAppearanceOverride(userDataDir: string): Promise<AppearanceOverride> {
  try {
    const parsed = JSON.parse(await readFile(join(userDataDir, OVERRIDE_FILE), 'utf8')) as unknown
    return normalizeAppearanceOverride(parsed)
  } catch {
    return EMPTY_APPEARANCE_OVERRIDE
  }
}

/**
 * Persist this environment's LOCAL appearance override — the per-environment pin that shadows the
 * synced default without touching it.
 *
 * Writes the NORMALIZED (sparse) override so the file carries only validly-pinned fields and a later
 * read never has to re-validate. Writing the EMPTY override is the explicit "clear all local pins,
 * follow the synced defaults again" gesture — to keep the userData dir tidy we **delete** the file in
 * that case rather than leaving an empty `{}` behind (a subsequent read returns the same empty
 * override either way, so the behaviour is identical).
 *
 * This NEVER writes to the synced `.dotden/` directory — it is environment-local by ADR 0024, so the
 * synced default other environments read is never mutated by pinning (or clearing) a local override.
 *
 * @param userDataDir Electron's `app.getPath('userData')`; a tempdir in tests.
 * @param override The override to persist (sparse partial); `{}` clears all local pins.
 */
export async function writeAppearanceOverride(
  userDataDir: string,
  override: AppearanceOverride,
): Promise<void> {
  const file = join(userDataDir, OVERRIDE_FILE)
  const normalized = normalizeAppearanceOverride(override)
  // No pinned fields ⇒ the environment follows the synced defaults again; remove the file so the
  // userData dir doesn't accumulate empty override stubs (a read of an absent file already returns
  // the empty override). Best-effort: ignore a not-found removal.
  if (Object.keys(normalized).length === 0) {
    await rm(file, { force: true })
    return
  }
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
}
