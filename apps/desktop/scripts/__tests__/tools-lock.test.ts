/**
 * Contract tests for the PINNED tool manifest (issue 3-19) —
 * `resources/bin/tools.lock.json`, the single source of truth that makes the bundled
 * chezmoi + git reproducible per release.
 *
 * These run hermetically (no network): they validate the lock's shape, that every tool
 * pins every target with a real sha256, and — load-bearing — that the paths the lock
 * promises line up with where `src/main/foundation/platform/tools.ts` actually resolves the
 * binaries. A drift between the two would ship an installer whose tools the app can't find.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveBundledTools } from '../../src/main/foundation/platform/tools.js'
import { createExecutableStub } from '../../src/main/foundation/__tests__/temp-git-repo.fixture.js'

// __dirname is valid here: under NodeNext with no package "type":"module", vitest compiles
// these .ts test files as CommonJS (where import.meta is disallowed). Resolve from it.
const lockPath = join(__dirname, '..', '..', 'resources', 'bin', 'tools.lock.json')

interface ToolTarget {
  asset: string
  archive: string
  sha256: string
  member?: string
  launcher?: string
}
interface ToolSpec {
  version: string
  repo: string
  releaseTag: string
  urlTemplate: string
  extract: 'file' | 'raw' | 'tree'
  treeDest?: string
  targets: Record<string, ToolTarget>
}
interface Lock {
  chezmoi: ToolSpec
  git: ToolSpec
}

const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as Lock

/** A hex sha256 is 64 lowercase hex chars — guards against a truncated/typo'd checksum. */
const SHA256 = /^[0-9a-f]{64}$/

/** Every platform/arch target a release must cover (mirrors the dmg/NSIS/AppImage matrix). */
const REQUIRED_TARGETS = [
  'linux/x64',
  'linux/arm64',
  'darwin/x64',
  'darwin/arm64',
  'win32/x64',
] as const

describe('tools.lock.json (pinned bundle manifest)', () => {
  it('pins both tools to an exact semver version', () => {
    expect(lock.chezmoi.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(lock.git.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  for (const toolName of ['chezmoi', 'git'] as const) {
    describe(toolName, () => {
      const tool = lock[toolName]

      it('covers every release target (dmg/NSIS/AppImage matrix)', () => {
        for (const target of REQUIRED_TARGETS) {
          expect(tool.targets[target], `${toolName} missing target ${target}`).toBeDefined()
        }
      })

      it('pins a real sha256 + a resolvable download URL per target', () => {
        for (const [key, target] of Object.entries(tool.targets)) {
          expect(target.sha256, `${toolName}/${key} sha256`).toMatch(SHA256)
          const url = tool.urlTemplate.replace('${asset}', target.asset)
          // Fully substituted (no leftover ${asset}) and points at the pinned GitHub release.
          expect(url).not.toContain('${asset}')
          expect(url).toContain(target.asset)
          expect(url).toContain(`/${tool.releaseTag}/`)
        }
      })
    })
  }

  it('chezmoi extracts a single binary member; git extracts the dugite tree', () => {
    expect(lock.chezmoi.extract === 'file' || lock.chezmoi.extract === 'raw').toBe(true)
    for (const target of Object.values(lock.chezmoi.targets)) {
      expect(target.member, 'chezmoi target needs a member name').toBeTruthy()
    }

    expect(lock.git.extract).toBe('tree')
    expect(lock.git.treeDest).toBeTruthy()
    for (const target of Object.values(lock.git.targets)) {
      // The post-extraction launcher must live under the git-dist tree the resolver probes.
      expect(target.launcher).toMatch(new RegExp(`^${lock.git.treeDest}/`))
    }
  })
})

/**
 * The lock's promised on-disk layout MUST be the layout `resolveBundledTools` probes —
 * otherwise the bundle and the resolver silently disagree. We stage executable stubs at
 * the lock's chezmoi `member` + git `launcher` paths for a given target and assert the
 * resolver finds exactly them.
 */
describe('lock layout ↔ tools.ts resolver agreement', () => {
  // Use the host target so the stub names match the resolver's platform-conditioned probe.
  const targetKey = `${process.platform}/${process.arch}`
  const chezmoiTarget = lock.chezmoi.targets[targetKey]
  const gitTarget = lock.git.targets[targetKey]

  it.runIf(chezmoiTarget && gitTarget)(
    `resolves the lock's ${targetKey} chezmoi + git-dist launcher paths`,
    async () => {
      // runIf already guarantees both are present; assert to narrow for the type-checker.
      const chezmoiMember = chezmoiTarget?.member
      const gitLauncher = gitTarget?.launcher
      expect(chezmoiMember).toBeTruthy()
      expect(gitLauncher).toBeTruthy()

      const resources = await mkdtemp(join(tmpdir(), 'dotden-lock-'))
      try {
        const destDir = join(resources, 'bin', process.platform, process.arch)

        // chezmoi: a single binary at bin/<p>/<a>/<member>.
        const chezmoi = join(destDir, chezmoiMember as string)
        await mkdir(dirname(chezmoi), { recursive: true })
        await createExecutableStub(chezmoi)

        // git: the launcher inside the extracted git-dist tree at bin/<p>/<a>/<launcher>.
        const git = join(destDir, gitLauncher as string)
        await mkdir(dirname(git), { recursive: true })
        await createExecutableStub(git)

        await expect(resolveBundledTools(resources)).resolves.toEqual({ chezmoi, git })
      } finally {
        await rm(resources, { recursive: true, force: true })
      }
    },
  )
})
