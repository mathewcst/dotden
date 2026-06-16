/* eslint-disable turbo/no-undeclared-env-vars -- local development overrides for binary resolution. */
/**
 * Locates the chezmoi & git binaries that dotden BUNDLES inside its app resources,
 * so the running app never depends on a host install of either tool.
 *
 * Resolution probes `resourcesPath/bin/...` (platform/arch-specific first, then a
 * flat fallback) and honours `DOTDEN_*_BIN` env overrides for local dev/tests.
 * Throws a clear error when either binary cannot be found, since every chezmoi/git
 * verb dotden forwards depends on these paths.
 */
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'

/**
 * Absolute filesystem paths to the bundled CLI binaries dotden shells out to.
 *
 * @remarks Both fields are guaranteed to point at existing executables — they are
 * only produced by {@link resolveBundledTools}, which throws rather than returning
 * a partial/missing pair.
 */
export interface ToolPaths {
  /** Absolute path to the bundled chezmoi binary (the dotfile engine dotden wraps). */
  readonly chezmoi: string
  /** Absolute path to the bundled git binary (backs Sync: push/fetch/status/diff). */
  readonly git: string
}

/**
 * Reports whether `path` exists AND has the executable bit set for this process.
 *
 * @param path - Candidate binary path to test.
 * @returns `true` if the file is executable, `false` if missing or not executable.
 *   Never throws — an empty string or a failed `access` check resolves to `false`,
 *   which lets callers pass unset env overrides (`''`) straight into the probe list.
 */
async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Returns the first executable path from `paths`, in order — the path-probing core.
 *
 * @param paths - Candidate paths tried in priority order (env override, then
 *   platform/arch-specific, then flat). Empty strings are skipped via {@link executable}.
 * @returns The first path that is executable, or `undefined` if none qualify.
 */
async function firstExecutable(paths: readonly string[]): Promise<string | undefined> {
  for (const path of paths) {
    if (await executable(path)) return path
  }
  return undefined
}

/**
 * Resolves the bundled chezmoi & git binaries dotden ships inside its app resources.
 *
 * For each tool, candidates are probed in this priority order:
 *  1. The `DOTDEN_CHEZMOI_BIN` / `DOTDEN_GIT_BIN` env override (dev/tests). Unset
 *     overrides become `''`, which {@link executable} treats as not-executable and skips.
 *  2. The platform/arch-specific path `bin/<platform>/<arch>/<name>` — what packaged
 *     builds ship for chezmoi (a single static binary), so the correct native binary
 *     is selected per host.
 *  3. The dugite git distribution tree `bin/<platform>/<arch>/git-dist/...` (git only) —
 *     git is bundled as the full relocatable `desktop/dugite-native` tree (a bare git
 *     launcher can't find its `libexec`/templates), so its real launcher lives at
 *     `git-dist/bin/git` (POSIX) or `git-dist/cmd/git.exe` (Windows). See
 *     `scripts/fetch-binaries.mjs` + `resources/bin/tools.lock.json` (issue 3-19).
 *  4. The flat fallback `bin/<name>` — a single-binary layout (e.g. simpler dev setups).
 * On Windows the binary name carries the `.exe` suffix.
 *
 * @param resourcesPath - Root of the app's bundled resources. Defaults to Electron's
 *   `process.resourcesPath`; pass an explicit dir in tests.
 * @returns Absolute paths to both binaries, guaranteed to exist and be executable.
 * @throws {Error} If either chezmoi or git cannot be located through any candidate;
 *   the message points at the `DOTDEN_*_BIN` overrides for development/tests.
 */
export async function resolveBundledTools(
  resourcesPath = process.resourcesPath,
): Promise<ToolPaths> {
  const binDir = join(resourcesPath, 'bin')
  const chezmoi = await firstExecutable([
    process.env.DOTDEN_CHEZMOI_BIN ?? '',
    join(
      binDir,
      process.platform,
      process.arch,
      process.platform === 'win32' ? 'chezmoi.exe' : 'chezmoi',
    ),
    join(binDir, process.platform === 'win32' ? 'chezmoi.exe' : 'chezmoi'),
  ])
  const git = await firstExecutable([
    process.env.DOTDEN_GIT_BIN ?? '',
    join(binDir, process.platform, process.arch, process.platform === 'win32' ? 'git.exe' : 'git'),
    // The bundled dugite-native git: a full relocatable tree whose launcher resolves its
    // own support files (libexec/git-core, templates) relative to the binary, so it must
    // be run from inside the extracted `git-dist/` tree, not copied out as a bare binary.
    join(
      binDir,
      process.platform,
      process.arch,
      'git-dist',
      process.platform === 'win32' ? 'cmd' : 'bin',
      process.platform === 'win32' ? 'git.exe' : 'git',
    ),
    join(binDir, process.platform === 'win32' ? 'git.exe' : 'git'),
  ])

  // Fail loud and early: a missing binary means every downstream chezmoi/git verb
  // would break, so surface it here with the dev-override hint rather than later.
  if (!chezmoi || !git) {
    throw new Error(
      'Bundled chezmoi/git tools were not found. Set DOTDEN_CHEZMOI_BIN/DOTDEN_GIT_BIN for development tests.',
    )
  }

  return { chezmoi, git }
}
