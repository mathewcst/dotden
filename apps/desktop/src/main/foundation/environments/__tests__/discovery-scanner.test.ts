/**
 * DiscoveryScanner — first-run tool-catalog scan (issue 1-06).
 *
 * Proves the scan is **grounded in the catalog** (feature-detection, not a blind
 * directory sweep, ADR 0022): only catalog-known paths that actually exist surface,
 * each attributed to its tool; Folders are distinguished from Files; and the
 * drag-in/browse path lets the user reach Files the catalog missed while still
 * refusing paths outside the home dir.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_TOOL_CATALOG, DiscoveryScanner, type CatalogTool } from '../discovery-scanner.js'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dotden-discover-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('DiscoveryScanner.scan', () => {
  it('suggests only catalog-known config Files that exist on disk', async () => {
    // A real config the catalog knows…
    await writeFile(join(home, '.zshrc'), 'export EDITOR=nvim\n')
    // …and a file the catalog does NOT list (must be ignored — grounded, not a sweep).
    await writeFile(join(home, '.some-random-rc'), 'noise\n')

    const { suggestions } = await new DiscoveryScanner({ homeDir: home }).scan()

    const paths = suggestions.map((s) => s.targetPath)
    expect(paths).toContain('.zshrc')
    expect(paths).not.toContain('.some-random-rc')
  })

  it('attributes each suggestion to its catalog tool, for grouping', async () => {
    await writeFile(join(home, '.zshrc'), 'z\n')
    await writeFile(join(home, '.gitconfig'), 'g\n')

    const { suggestions } = await new DiscoveryScanner({ homeDir: home }).scan()
    const zsh = suggestions.find((s) => s.targetPath === '.zshrc')
    const git = suggestions.find((s) => s.targetPath === '.gitconfig')

    expect(zsh?.toolId).toBe('zsh')
    expect(zsh?.toolLabel).toBe('Zsh')
    expect(git?.toolId).toBe('git')
    expect(git?.isFolder).toBe(false)
    expect(zsh?.sizeBytes).toBeGreaterThan(0)
  })

  it('distinguishes a Folder from a File (CONTEXT.md File vs Folder)', async () => {
    await mkdir(join(home, '.config', 'nvim'), { recursive: true })
    await writeFile(join(home, '.config', 'nvim', 'init.lua'), 'vim.opt.number = true\n')

    const { suggestions } = await new DiscoveryScanner({ homeDir: home }).scan()
    const nvim = suggestions.find((s) => s.targetPath === '.config/nvim')

    expect(nvim).toBeDefined()
    expect(nvim?.isFolder).toBe(true)
    // A Folder reports 0 bytes for its own "config size" (its contents are managed recursively).
    expect(nvim?.sizeBytes).toBe(0)
  })

  it('returns no suggestions on a pristine home dir (empty/fallback is a real state)', async () => {
    const { suggestions } = await new DiscoveryScanner({ homeDir: home }).scan()
    expect(suggestions).toEqual([])
  })

  it('honors an injected catalog so the set is configurable', async () => {
    await writeFile(join(home, '.zshrc'), 'z\n')
    await writeFile(join(home, '.foorc'), 'f\n')
    const catalog: readonly CatalogTool[] = [{ id: 'foo', label: 'Foo', candidates: ['.foorc'] }]

    const { suggestions } = await new DiscoveryScanner({ homeDir: home, catalog }).scan()

    // Only the injected tool's path surfaces — `.zshrc` is not in THIS catalog.
    expect(suggestions.map((s) => s.targetPath)).toEqual(['.foorc'])
  })

  it('de-duplicates a path two catalog tools both claim', async () => {
    await writeFile(join(home, '.profile'), 'p\n')
    const catalog: readonly CatalogTool[] = [
      { id: 'sh-a', label: 'Shell A', candidates: ['.profile'] },
      { id: 'sh-b', label: 'Shell B', candidates: ['.profile'] },
    ]

    const { suggestions } = await new DiscoveryScanner({ homeDir: home, catalog }).scan()

    expect(suggestions).toHaveLength(1)
    // Attributed to the FIRST tool that listed it.
    expect(suggestions[0]?.toolId).toBe('sh-a')
  })

  it('ships a non-empty default catalog grounded in well-known tools', () => {
    expect(DEFAULT_TOOL_CATALOG.length).toBeGreaterThan(5)
    expect(DEFAULT_TOOL_CATALOG.some((t) => t.id === 'zsh')).toBe(true)
    expect(DEFAULT_TOOL_CATALOG.some((t) => t.id === 'git')).toBe(true)
  })
})

describe('DiscoveryScanner.inspectCustomPath (drag-in / browse — manage anything)', () => {
  it('accepts a path the catalog missed but that exists under home', async () => {
    await writeFile(join(home, '.tool-the-catalog-forgot'), 'x\n')
    const scanner = new DiscoveryScanner({ homeDir: home })

    const suggestion = await scanner.inspectCustomPath('.tool-the-catalog-forgot')

    expect(suggestion).not.toBeNull()
    expect(suggestion?.targetPath).toBe('.tool-the-catalog-forgot')
    // Tagged as a user-added custom pick so it renders in the same list.
    expect(suggestion?.toolId).toBe('custom')
  })

  it('returns null for a non-existent path (never fail silently — caller surfaces it)', async () => {
    const scanner = new DiscoveryScanner({ homeDir: home })
    expect(await scanner.inspectCustomPath('.does-not-exist')).toBeNull()
  })

  it('normalizes an absolute path under home to a Track target', async () => {
    await writeFile(join(home, '.zshrc'), 'z\n')
    const scanner = new DiscoveryScanner({ homeDir: home })

    const suggestion = await scanner.inspectCustomPath(join(home, '.zshrc'))

    expect(suggestion?.targetPath).toBe('.zshrc')
  })

  it('refuses an absolute path outside the home dir', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'dotden-outside-'))
    await writeFile(join(outside, '.zshrc'), 'z\n')
    const scanner = new DiscoveryScanner({ homeDir: home })
    try {
      expect(await scanner.inspectCustomPath(join(outside, '.zshrc'))).toBeNull()
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('refuses a path escaping the home dir', async () => {
    const scanner = new DiscoveryScanner({ homeDir: home })
    expect(await scanner.inspectCustomPath('../../etc/passwd')).toBeNull()
  })
})
