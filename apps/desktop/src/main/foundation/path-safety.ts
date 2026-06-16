/**
 * Path-safety helpers for destination-relative dotden File paths.
 *
 * Renderer IPC sends user-facing File ids such as `.zshrc` or
 * `.config/nvim/init.lua`. Privileged main-process code must never treat those
 * strings as arbitrary filesystem paths: an absolute path or `..` traversal
 * would escape the Den's destination/home dir and turn a dotden verb into a
 * generic file read/write/delete. These helpers centralize the containment
 * check so every adapter resolves paths the same way.
 */
import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * Resolve a user-facing relative path under `root`, rejecting escapes.
 *
 * @param root Absolute root directory the path must remain inside.
 * @param targetPath User-facing destination-relative File path.
 * @param label Human-readable path kind for thrown diagnostics.
 * @returns Absolute path under `root`.
 * @throws Error when `targetPath` is empty, absolute, or resolves outside `root`.
 */
export function resolveContainedPath(root: string, targetPath: string, label = 'targetPath'): string {
  const trimmed = targetPath.trim()
  if (trimmed.length === 0) {
    throw new Error(`Refusing empty ${label}`)
  }
  if (isAbsolute(trimmed)) {
    throw new Error(`Refusing absolute ${label}: ${targetPath}`)
  }

  const absolute = resolve(root, trimmed)
  const relativeToRoot = relative(root, absolute)
  if (
    relativeToRoot.length === 0 ||
    relativeToRoot === '..' ||
    relativeToRoot.startsWith(`..${sep}`) ||
    isAbsolute(relativeToRoot)
  ) {
    throw new Error(`Refusing ${label} outside dotden root: ${targetPath}`)
  }

  return absolute
}
