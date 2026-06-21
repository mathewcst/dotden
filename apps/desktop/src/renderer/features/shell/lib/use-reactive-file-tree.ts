import { useFileTree } from '@pierre/trees/react'
import { useEffect } from 'react'

/** The options object `@pierre/trees`' {@link useFileTree} accepts (paths, gitStatus, expansion…). */
type FileTreeOptions = Parameters<typeof useFileTree>[0]

/**
 * `useFileTree` wrapper that keeps the live `@pierre/trees` model in sync with options that
 * change AFTER the first render.
 *
 * `useFileTree` builds the model exactly once — `useState(() => new FileTree(options))` — so it
 * only ever sees the options from the mounting render. The den window mounts with an EMPTY store
 * (`files: []`, ADR 0027) and fills it asynchronously from `init()`'s `den:tree` read, so by the
 * time the real managed Files arrive the model has already been constructed around zero paths.
 * Without a refresh the tree renders blank even though the store now holds Files (the
 * "no Files after onboarding" bug): the left pane sees a non-empty `paths` and renders `<FileTree>`,
 * but the model it hands over still has none.
 *
 * The model exposes two imperative refresh seams for exactly this — `resetPaths` (the File set) and
 * `setGitStatus` (the M/A/D/R/U axis, the 1-00 spike recipe). We drive BOTH from the live options so
 * every later store change (boot load, Track, Commit, Apply, tree reload) is reflected. `resetPaths`
 * inherits the construction-time `initialExpansion` (e.g. `'open'`) and remaps the current selection,
 * so re-syncing does not collapse folders or drop the selected row.
 */
export function useReactiveFileTree(options: FileTreeOptions): {
  model: ReturnType<typeof useFileTree>['model']
} {
  const { model } = useFileTree(options)

  // Keep the File set live: push the current `paths` into the model whenever they change, because
  // `useFileTree` seeded them only at construction (when the store was still empty).
  useEffect(() => {
    model.resetPaths(options.paths ?? [])
  }, [model, options.paths])

  // Keep the git-status axis live the same way — `setGitStatus` is the model's imperative refresh,
  // since construction-time `gitStatus` is likewise frozen at mount.
  useEffect(() => {
    model.setGitStatus(options.gitStatus)
  }, [model, options.gitStatus])

  return { model }
}
