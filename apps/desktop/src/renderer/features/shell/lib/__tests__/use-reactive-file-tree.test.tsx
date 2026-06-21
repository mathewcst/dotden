// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useReactiveFileTree } from '../use-reactive-file-tree'

/**
 * Regression for the "no Files after onboarding" bug: the den-session store mounts empty
 * (`files: []`) and fills asynchronously from `init()`'s `den:tree` read. `useFileTree` builds the
 * `@pierre/trees` model ONCE at construction, so without an imperative refresh the model keeps the
 * mounting render's empty path set and the tree renders blank even though the store now holds Files.
 */
describe('useReactiveFileTree', () => {
  it('reflects paths that arrive after the model was first built', () => {
    const { result, rerender } = renderHook(
      ({ paths }: { paths: readonly string[] }) =>
        useReactiveFileTree({ paths, initialExpansion: 'open' }),
      { initialProps: { paths: [] as readonly string[] } },
    )

    // Built against the store's initial empty file set (boot load before init() resolves).
    expect(result.current.model.getItem('.zshrc')).toBeNull()

    // init() fills the store; the memoized `paths` change identity on the next render.
    rerender({ paths: ['.zshrc', '.bashrc', '.config/ghostty/config'] })

    // The model must now know the freshly-loaded Files, including nested ones.
    expect(result.current.model.getItem('.zshrc')).not.toBeNull()
    expect(result.current.model.getItem('.config/ghostty/config')).not.toBeNull()
  })

  it('drops paths that disappear from the store (e.g. Untrack)', () => {
    const { result, rerender } = renderHook(
      ({ paths }: { paths: readonly string[] }) =>
        useReactiveFileTree({ paths, initialExpansion: 'open' }),
      { initialProps: { paths: ['.zshrc', '.bashrc'] as readonly string[] } },
    )

    expect(result.current.model.getItem('.bashrc')).not.toBeNull()

    rerender({ paths: ['.zshrc'] })

    expect(result.current.model.getItem('.zshrc')).not.toBeNull()
    expect(result.current.model.getItem('.bashrc')).toBeNull()
  })
})
