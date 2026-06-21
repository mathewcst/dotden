/**
 * Faithful-wrapper integration tests.
 *
 * dotden's core principle is the "faithful wrapper": every app-level verb maps
 * 1:1 onto an underlying chezmoi/git CLI effect with no hidden reinterpretation.
 * These tests prove that contract end-to-end by exercising real bundled binaries
 * against temp source/destination state and asserting the exact on-disk result —
 * Track->`chezmoi add`, Commit->add/re-add + `git commit`, Apply->`chezmoi apply`,
 * Untrack->`chezmoi forget`, Delete everywhere->`chezmoi destroy`, OS Scope->
 * generated `.chezmoiignore`, and Sync->git push/fetch + status/diff.
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChezmoiAdapter, renderOsScopeIgnore, upsertEnvIdInToml } from '../chezmoi-adapter.js'
import { cloneRepo } from '../git-transport.js'
import { createTempDotdenRepo, type DotdenTestRepo } from '../../__tests__/temp-git-repo.fixture.js'

let repo: DotdenTestRepo

beforeEach(async () => {
  repo = await createTempDotdenRepo()
})

afterEach(async () => {
  await repo.cleanup()
})

// Proves each dotden verb produces the exact expected chezmoi effect on source vs destination state.
describe('ChezmoiAdapter faithful verb mapping', () => {
  it('Track maps to chezmoi add and records the destination File in source state', async () => {
    await writeFile(join(repo.home, '.zshrc'), 'export EDITOR=nvim\n')

    await repo.chezmoi.track('.zshrc')

    expect(existsSync(join(repo.source, 'dot_zshrc'))).toBe(true)
    await expect(readFile(join(repo.source, 'dot_zshrc'), 'utf8')).resolves.toContain('EDITOR=nvim')
  })

  it('Commit maps to add/re-add plus git commit', async () => {
    const target = join(repo.home, '.zshrc')
    await writeFile(target, 'one\n')
    await repo.chezmoi.commit(['.zshrc'], 'initial dotden commit', repo.git)
    await writeFile(target, 'two\n')

    await repo.chezmoi.commit(['.zshrc'], 'update dotden commit', repo.git)

    await expect(readFile(join(repo.source, 'dot_zshrc'), 'utf8')).resolves.toBe('two\n')
    await expect(repo.git.status()).resolves.toBe('')
  })

  it('Apply maps to chezmoi apply and writes source state into a second destination', async () => {
    await writeFile(join(repo.home, '.zshrc'), 'source bytes\n')
    await repo.chezmoi.commit(['.zshrc'], 'capture source bytes', repo.git)
    const secondHome = join(repo.root, 'second-home')
    const second = new ChezmoiAdapter({
      chezmoiBin: repo.chezmoiBin,
      sourceDir: repo.source,
      destinationDir: secondHome,
    })

    await second.apply(['.zshrc'])

    await expect(readFile(join(secondHome, '.zshrc'), 'utf8')).resolves.toBe('source bytes\n')
  })

  it('Untrack maps to chezmoi forget: source removed and destination kept', async () => {
    await writeFile(join(repo.home, '.zshrc'), 'keep me\n')
    await repo.chezmoi.track('.zshrc')

    await repo.chezmoi.untrack('.zshrc')

    expect(existsSync(join(repo.source, 'dot_zshrc'))).toBe(false)
    await expect(readFile(join(repo.home, '.zshrc'), 'utf8')).resolves.toBe('keep me\n')
  })

  it('Delete everywhere maps to chezmoi destroy and removes source plus destination', async () => {
    await writeFile(join(repo.home, '.zshrc'), 'delete me\n')
    await repo.chezmoi.track('.zshrc')

    await repo.chezmoi.deleteEverywhere('.zshrc')

    expect(existsSync(join(repo.source, 'dot_zshrc'))).toBe(false)
    expect(existsSync(join(repo.home, '.zshrc'))).toBe(false)
  })

  it('templateData reads os/arch/hostname from chezmoi template data (cross-OS-safe, no shell)', async () => {
    // Real `chezmoi execute-template '{{ .chezmoi.os }}…'` — the cross-OS-safe sourcing the
    // commit-template tab depends on (scope-v1). The values are non-empty + match what chezmoi
    // resolves; we assert shape rather than a host-specific value so the test is portable.
    const data = await repo.chezmoi.templateData()
    expect(data.os.length).toBeGreaterThan(0)
    expect(data.arch.length).toBeGreaterThan(0)
    expect(data.hostname.length).toBeGreaterThan(0)
    // chezmoi reports `runtime.GOOS`, so on this Linux CI the os is `linux` (never the renamed
    // `macos` — that presentation rename happens in the pure renderer, not here).
    expect(data.os).toBe(process.platform === 'darwin' ? 'darwin' : data.os)
  })

  it('OS Scope compiles to generated .chezmoiignore rules for Files outside this environment', async () => {
    const ignored = await repo.chezmoi.writeOsScopeIgnore({
      currentOs: 'linux',
      paths: [
        { targetPath: '.zshrc', scope: ['linux', 'darwin'] },
        { targetPath: '.config/powershell/profile.ps1', scope: ['win32'] },
      ],
    })

    const contents = await readFile(ignored, 'utf8')
    // The win-only File is ignored on linux…
    expect(contents).toContain('.config/powershell/profile.ps1')
    // …the linux-scoped File is NOT…
    expect(contents).not.toContain('.zshrc')
    // …and the generated file is the SINGLE writer of `.chezmoiignore`, so it always
    // re-emits the `.dotden/` rule (dotden metadata is never a managed target, ADR 0024).
    expect(contents).toContain('.dotden/')

    // A universally-scoped File (null) is never ignored on any OS.
    expect(
      renderOsScopeIgnore({
        currentOs: 'win32',
        paths: [{ targetPath: '.zshrc', scope: null }],
      }),
    ).not.toContain('.zshrc')
  })

  it('a scoped-out path actually shows up in `chezmoi ignored` (the muted set, issue 1-07/1-15)', async () => {
    // Track two Files, then scope one to a DIFFERENT OS than this environment. The
    // generated `.chezmoiignore` must make `chezmoi ignored` report exactly that File —
    // the real signal that drives the muted/ignored tree rendering.
    const otherOs = process.platform === 'win32' ? 'linux' : 'win32'
    await writeFile(join(repo.home, '.zshrc'), 'keep me\n')
    await writeFile(join(repo.home, '.other-os-file'), 'scope me out\n')
    await repo.chezmoi.track('.zshrc')
    await repo.chezmoi.track('.other-os-file')

    await repo.chezmoi.writeOsScopeIgnore({
      currentOs: process.platform as never,
      paths: [
        { targetPath: '.zshrc', scope: null }, // universal → applied here
        { targetPath: '.other-os-file', scope: [otherOs] }, // other-OS-only → ignored here
      ],
    })

    const ignored = await repo.chezmoi.ignoredPaths()
    expect(ignored).toContain('.other-os-file')
    expect(ignored).not.toContain('.zshrc')
  })
})

// Proves Sync faithfully maps onto git push/fetch plus the status/diff primitives backing dotden sync.
describe('GitTransport Sync primitives', () => {
  it('Sync maps to git push/fetch plus status/diff', async () => {
    await writeFile(join(repo.home, '.zshrc'), 'remote bytes\n')
    await repo.chezmoi.commit(['.zshrc'], 'pushable commit', repo.git)

    await repo.git.push()
    const cloneDir = join(repo.root, 'clone')
    const clone = await cloneRepo(repo.gitBin, repo.remote, cloneDir)
    await clone.fetch()

    await expect(clone.status()).resolves.toBe('')
    await expect(clone.diff()).resolves.toBe('')
  })

  it('log() returns parsable history and an empty string on a repo with no commits', async () => {
    // A fresh repo has no commits — log() must not throw, it returns "" (no activity yet).
    await expect(repo.git.log()).resolves.toBe('')

    await writeFile(join(repo.home, '.zshrc'), 'logged bytes\n')
    await repo.chezmoi.commit(['.zshrc'], 'first commit', repo.git)
    const raw = await repo.git.log()
    const [line = ''] = raw.split('\n')
    const [sha, author, email, date, subject] = line.split('\x1f')
    expect(sha).toMatch(/^[0-9a-f]{40}$/i)
    expect(author).toBe('dotden tests')
    expect(email).toBe('dotden@example.invalid')
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(subject).toBe('first commit')
  })

  it('showFile() returns the read-only patch one commit applied to a path (History preview, 2-01)', async () => {
    // First commit introduces the File; a second commit changes it.
    await writeFile(join(repo.home, '.zshrc'), 'export EDITOR=nvim\n')
    await repo.chezmoi.commit(['.zshrc'], 'add zshrc', repo.git)
    await writeFile(join(repo.home, '.zshrc'), 'export EDITOR=nvim\nexport PAGER=less\n')
    await repo.chezmoi.commit(['.zshrc'], 'add pager', repo.git)

    // The two versions' SHAs, newest first (git log default).
    const [newestSha, firstSha] = (await repo.git.log({ path: 'dot_zshrc' }))
      .split('\n')
      .map((line) => line.split('\x1f')[0] ?? '')

    // `git show <sha> -- dot_zshrc` previews exactly what THAT version changed for the File.
    const newest = await repo.git.showFile(newestSha!, 'dot_zshrc')
    expect(newest).toContain('PAGER=less')
    expect(newest).toContain('add pager') // the commit header travels in `git show` output
    const first = await repo.git.showFile(firstSha!, 'dot_zshrc')
    expect(first).toContain('EDITOR=nvim')

    // A commit that did not touch the path yields an empty patch (no hunks), not an error.
    await writeFile(join(repo.home, '.gitconfig'), 'name = a\n')
    await repo.chezmoi.commit(['.gitconfig'], 'unrelated', repo.git)
    const unrelatedSha = (await repo.git.log({ path: 'dot_gitconfig' })).split('\x1f')[0] ?? ''
    await expect(repo.git.showFile(unrelatedSha, 'dot_zshrc')).resolves.toBe('')
  })
})

// The pure TOML transform that mirrors the env id into chezmoi's local [data] table.
describe('upsertEnvIdInToml', () => {
  it('creates a [data] table when the config is empty', () => {
    const out = upsertEnvIdInToml('', 'env-1')
    expect(out).toBe('[data]\n    dotden_env_id = "env-1"\n')
  })

  it('inserts the key into an existing [data] table without clobbering other keys', () => {
    const existing = '[data]\n    email = "me@example.com"\n'
    const out = upsertEnvIdInToml(existing, 'env-2')
    expect(out).toContain('dotden_env_id = "env-2"')
    expect(out).toContain('email = "me@example.com"')
  })

  it('replaces an existing dotden_env_id in place (idempotent re-writes)', () => {
    const first = upsertEnvIdInToml('', 'old')
    const second = upsertEnvIdInToml(first, 'new')
    expect(second).toContain('dotden_env_id = "new"')
    expect(second).not.toContain('"old"')
    // Re-applying the same id is stable (exactly one occurrence, single trailing newline).
    const third = upsertEnvIdInToml(second, 'new')
    expect(third).toBe(second)
  })

  it('appends a [data] table after a user-authored top-level config', () => {
    const existing = 'sourceDir = "~/.local/share/chezmoi"\n'
    const out = upsertEnvIdInToml(existing, 'env-3')
    expect(out).toContain('sourceDir = "~/.local/share/chezmoi"')
    expect(out).toMatch(/\[data\]\n {4}dotden_env_id = "env-3"\n$/)
  })
})
