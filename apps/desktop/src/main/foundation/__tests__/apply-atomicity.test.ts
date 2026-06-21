/**
 * Per-file Apply atomicity — the load-bearing Review & Apply logic (issue 1-09).
 *
 * The Review & Apply contract is that each incoming File **applies independently**:
 * one File failing must NOT block the others, the failure is reported with a reason,
 * and a retry re-runs only the failures (per-file atomicity, matching chezmoi's
 * per-path model — ADR 0003). That isolation lives in {@link DenService.applyIncoming}'s
 * per-File loop, so it is tested here directly.
 *
 * The seam under test is the loop, not chezmoi itself — so we drive a real DenService
 * (with a real synced `.dotden/` so the witness gate is genuine) but swap the
 * ChezmoiAdapter's `apply` for a stub that fails for ONE chosen path. That proves the
 * loop continues past a failure, records the right per-File outcomes, and re-applies
 * just the failed path on retry — without depending on a flaky way to make real chezmoi
 * fail mid-batch.
 */
/* eslint-disable turbo/no-undeclared-env-vars -- integration test discovers local chezmoi/git binaries. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DenService } from '../den-service.js'
import { GitTransport } from '../git-transport.js'
import { DenStore } from '../den-store.js'
import { OperationTracer } from '../platform/operation-tracer.js'
import { runCommand } from '../platform/process.js'

let root: string
let chezmoiBin: string
let gitBin: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dotden-apply-'))
  chezmoiBin = await requireTool('chezmoi', 'DOTDEN_CHEZMOI_BIN')
  gitBin = await requireTool('git', 'DOTDEN_GIT_BIN')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('applyIncoming per-file atomicity (issue 1-09)', () => {
  it('applies each File independently: one failure does NOT block the others, and is reported retryable', async () => {
    const env = await seedTwoFileDen()

    // Make `chezmoi apply` fail for exactly ONE of the two Files; the other still writes.
    const realApply = env.chezmoiApply
    const calls: string[][] = []
    stubApply(env.service, async (paths) => {
      calls.push([...paths])
      if (paths.includes('.broken')) throw new Error('chezmoi: simulated apply failure for .broken')
      await realApply(paths)
    })

    const result = await env.service.applyIncoming(['.zshrc', '.broken'], 'trace-apply-all')

    // Each File was applied in its OWN invocation (per-file atomicity, not one batch).
    expect(calls).toEqual([['.zshrc'], ['.broken']])
    // The good File succeeded; the bad one failed — and the failure did NOT block the good one.
    expect(result.applied).toEqual(['.zshrc'])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({
      targetPath: '.broken',
      outcome: 'error',
      retryable: true,
    })
    expect(result.failed[0]?.reason).toContain('simulated apply failure')
    // Every File has a per-File outcome recorded (nothing silently skipped).
    expect(result.results.map((r) => r.targetPath).sort()).toEqual(['.broken', '.zshrc'])
    // The Apply Operation reports `error` because a File failed (partial Apply, honestly).
    expect(
      env.tracer
        .events()
        .filter((e) => e.kind === 'apply')
        .at(-1)?.outcome,
    ).toBe('error')
  })

  it('retry re-runs ONLY the previously-failed File and succeeds once its cause is fixed', async () => {
    const env = await seedTwoFileDen()

    // First Apply: `.broken` fails, `.zshrc` succeeds.
    const realApply = env.chezmoiApply
    let failBroken = true
    const calls: string[][] = []
    stubApply(env.service, async (paths) => {
      calls.push([...paths])
      if (failBroken && paths.includes('.broken')) throw new Error('transient failure')
      await realApply(paths)
    })

    const first = await env.service.applyIncoming(['.zshrc', '.broken'], 'trace-apply-1')
    expect(first.applied).toEqual(['.zshrc'])
    expect(first.failed.map((f) => f.targetPath)).toEqual(['.broken'])

    // The user fixes the cause; retry passes ONLY the failed path (not the whole batch).
    failBroken = false
    calls.length = 0
    const retry = await env.service.applyIncoming(['.broken'], 'trace-apply-retry')

    // Only the failed File was re-applied — the already-applied File is not touched again.
    expect(calls).toEqual([['.broken']])
    expect(retry.applied).toEqual(['.broken'])
    expect(retry.failed).toEqual([])
    // The retry Apply Operation is `ok` (no remaining failures).
    expect(
      env.tracer
        .events()
        .filter((e) => e.kind === 'apply')
        .at(-1)?.outcome,
    ).toBe('ok')
  })

  it('a path that turned non-applicable is reported as a non-retryable failure, not silently dropped', async () => {
    const env = await seedTwoFileDen()
    // Narrow this environment's subscription so `.broken` no longer applies here.
    const store = new DenStore(env.source)
    await store.registerEnvironment({
      id: 'env-self',
      label: 'this-mac',
      os: process.platform,
      subscribedWorkspaces: ['personal'],
    })
    // Re-place `.broken` into a Workspace this environment does NOT subscribe to.
    await store.createWorkspace('Work')
    const work = (await store.readWorkspaces()).workspaces.find((w) => w.label === 'Work')!
    await store.setFileWorkspace('.broken', work.id)

    const result = await env.service.applyIncoming(['.zshrc', '.broken'], 'trace-apply')

    // The applicable File still applies; the non-applicable one is a surfaced, non-retryable failure.
    expect(result.applied).toEqual(['.zshrc'])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({
      targetPath: '.broken',
      outcome: 'error',
      retryable: false,
    })
  })
})

/**
 * Seed a Den (env A) with two Tracked Files (`.zshrc`, `.broken`) so applyIncoming has
 * two witness-backed, applicable paths to apply per-File. Returns the service, its
 * tracer, the source dir, and a handle to the REAL chezmoi `apply` for the stub to defer to.
 */
async function seedTwoFileDen() {
  const remote = join(root, 'remote.git')
  await runCommand(gitBin, ['init', '--bare', remote])
  const home = join(root, 'home')
  const source = join(root, 'source')
  await mkdir(home, { recursive: true })
  await initSourceRepo(source, remote)
  const tracer = new OperationTracer()
  const service = new DenService({
    chezmoiBin,
    gitBin,
    sourceDir: source,
    destinationDir: home,
    environment: { id: 'env-self', label: 'this-mac', os: process.platform },
    tracer,
  })
  await writeFile(join(home, '.zshrc'), 'export EDITOR=nvim\n')
  await service.trackFile('.zshrc', 'seed-1')
  await writeFile(join(home, '.broken'), 'broken=true\n')
  await service.trackFile('.broken', 'seed-2')
  await service.commitTracked(['.zshrc', '.broken'], 'seed-commit')

  // Capture the REAL chezmoi.apply NOW (before any stub) and bind it to its adapter, so
  // a later stub can defer to it for the good paths without recursing into itself.
  const chezmoi = (
    service as unknown as { chezmoi: { apply(paths: readonly string[]): Promise<void> } }
  ).chezmoi
  const realApply = chezmoi.apply.bind(chezmoi)
  return {
    service,
    tracer,
    source,
    chezmoiApply: realApply,
  }
}

/** Replace the DenService's private ChezmoiAdapter `apply` with a stub, for the per-File seam. */
function stubApply(service: DenService, fn: (paths: readonly string[]) => Promise<void>): void {
  ;(service as unknown as { chezmoi: { apply: typeof fn } }).chezmoi.apply = fn
}

async function initSourceRepo(sourceDir: string, remote: string): Promise<void> {
  await mkdir(sourceDir, { recursive: true })
  const git = new GitTransport({ gitBin, repoDir: sourceDir })
  await git.init()
  await runCommand(gitBin, ['config', 'user.name', 'dotden tests'], { cwd: sourceDir })
  await runCommand(gitBin, ['config', 'user.email', 'dotden@example.invalid'], { cwd: sourceDir })
  await runCommand(gitBin, ['config', 'commit.gpgsign', 'false'], { cwd: sourceDir })
  await git.addRemote('origin', remote)
}

async function requireTool(name: string, envName: string): Promise<string> {
  const fromEnv = process.env[envName]
  if (fromEnv) return fromEnv
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, name)
    try {
      await runCommand(candidate, ['--version'])
      return candidate
    } catch {
      // keep probing PATH
    }
  }
  throw new Error(`${name} binary not found. Set ${envName}.`)
}
