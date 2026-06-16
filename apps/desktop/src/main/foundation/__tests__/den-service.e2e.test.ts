/**
 * DenService end-to-end thread — the issue 1-04 tracer bullet, with REAL binaries.
 *
 * Drives the whole MVP sync loop across TWO environments against real chezmoi/git
 * and disposable temp state, proving the acceptance criteria are wired end to end:
 *
 *   env A:  Track a File → Commit (templated message, LOCAL until pushed) → Sync push
 *   env B:  clone the Den → list incoming (incoming-clean only) → Apply → File on disk
 *
 * It also asserts the two cross-cutting properties this slice stands up: the synced
 * `.myenv/` (default Workspace + environment registry) travels through the Remote,
 * and a non-applicable File is never applied on env B.
 */
/* eslint-disable turbo/no-undeclared-env-vars -- integration test discovers local chezmoi/git binaries. */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cloneRepo, GitTransport } from '../git-transport.js'
import { DenService } from '../den-service.js'
import { MyenvStore } from '../myenv-store.js'
import { OperationTracer } from '../operation-tracer.js'
import { parseIncomingDeletions } from '../chezmoi-status.js'
import { runCommand } from '../process.js'

let root: string
let chezmoiBin: string
let gitBin: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dotden-e2e-'))
  chezmoiBin = await requireTool('chezmoi', 'DOTDEN_CHEZMOI_BIN')
  gitBin = await requireTool('git', 'DOTDEN_GIT_BIN')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('DenService end-to-end thread (real chezmoi/git)', () => {
  it('threads Track → Commit (local) → Sync push → clone → list incoming → Apply across two environments', async () => {
    // ── Shared bare Remote (the Den's only shared storage, ADR 0001) ──
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    // ── Environment A: its source repo is the Den, its home is the fake dotfiles ──
    const aHome = join(root, 'a-home')
    const aSource = join(root, 'a-source')
    await mkdir(aHome, { recursive: true })
    await initSourceRepo(aSource, remote)
    const tracerA = new OperationTracer()
    const envA = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: aSource,
      destinationDir: aHome,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
      tracer: tracerA,
    })

    // A user edits a real dotfile and Tracks it.
    await writeFile(join(aHome, '.zshrc'), 'export EDITOR=nvim\n')
    await envA.trackFile('.zshrc', 'trace-track')

    // Commit — LOCAL until pushed (ADR 0006). The result carries the templated
    // message and which template produced it (the Commit UI surface).
    const commit = await envA.commitTracked(['.zshrc'], 'trace-commit')
    expect(commit.pushed).toBe(false)
    expect(commit.templateId).toBe('default')
    expect(commit.message).toBe('Commit 1 file(s) from this-mac: .zshrc')
    expect(commit.committedFiles).toEqual(['.zshrc'])

    // The synced .myenv/ exists in the Den BEFORE pushing.
    const aStore = new MyenvStore(aSource)
    expect((await aStore.readEnvironments()).environments.map((e) => e.id)).toEqual(['env-a'])
    expect((await aStore.readWorkspaces()).placements).toContainEqual({
      targetPath: '.zshrc',
      workspaceId: 'personal',
      // A freshly Tracked File sits directly under its Workspace (no Group yet, 1-14)…
      groupId: null,
      // …and is universally scoped (applies on every OS) until the user narrows it (1-15).
      scope: null,
    })

    // Sync now: push the local Commit to the Remote — now it is shared.
    await envA.syncPush('trace-push')

    // A wide event landed for each Operation in env A's ring buffer (ADR 0007).
    expect(tracerA.events().map((e) => e.kind)).toEqual(
      expect.arrayContaining(['track', 'commit', 'sync']),
    )

    // ── Environment B: clone the Den from the Remote (fresh, empty home) ──
    const bHome = join(root, 'b-home')
    const bSource = join(root, 'b-source')
    await mkdir(bHome, { recursive: true })
    await cloneRepo(gitBin, remote, bSource)
    const envB = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: bSource,
      destinationDir: bHome,
      environment: { id: 'env-b', label: 'work-laptop', os: process.platform },
      tracer: new OperationTracer(),
    })

    // The synced model travelled through the Remote: env B sees env A's registry
    // entry, the default Workspace, and the File placement — this is how a second
    // environment reconstructs the Den (ADR 0024).
    const bStore = new MyenvStore(bSource)
    expect((await bStore.readEnvironments()).environments[0]?.id).toBe('env-a')
    expect((await bStore.readWorkspaces()).workspaces[0]?.id).toBe('personal')

    // List incoming for a reviewed Apply — incoming-clean only (no local copy).
    expect(existsSync(join(bHome, '.zshrc'))).toBe(false)
    const incoming = await envB.listIncomingClean('trace-list')
    // Each incoming File carries its Remote-axis marker (↓ incoming for the clean path, 1-09)
    // plus the planner's kind/confirm verdict (a clean create needs no confirmation, 1-10).
    expect(incoming).toEqual([
      {
        targetPath: '.zshrc',
        workspaceId: 'personal',
        marker: 'incoming',
        kind: 'create',
        requiresConfirmation: false,
      },
    ])

    // Apply writes the File to env B's disk with the exact source bytes.
    const applied = await envB.applyIncoming(['.zshrc'], 'trace-apply')
    expect(applied.applied).toEqual(['.zshrc'])
    await expect(readFile(join(bHome, '.zshrc'), 'utf8')).resolves.toBe('export EDITOR=nvim\n')
  })

  it('fileTree() reads managed Files with their placement, local status, and diff (issue 1-07)', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    const home = join(root, 'home')
    const source = join(root, 'source')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source, remote)
    const env = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })

    // Track + Commit one File so it is managed and clean, then a second File that we
    // leave dirty on disk so the tree shows a real local-axis status letter.
    await writeFile(join(home, '.zshrc'), 'export EDITOR=nvim\n')
    await env.trackFile('.zshrc', 'trace-track-1')
    await env.commitTracked(['.zshrc'], 'trace-commit-1')
    await writeFile(join(home, '.gitconfig'), 'name = a\n')
    await env.trackFile('.gitconfig', 'trace-track-2')
    await env.commitTracked(['.gitconfig'], 'trace-commit-2')

    // Now edit .zshrc on disk WITHOUT committing — it must show as a local modification.
    await writeFile(join(home, '.zshrc'), 'export EDITOR=nvim\nexport PAGER=less\n')

    const view = await env.fileTree()
    const byPath = new Map(view.files.map((f) => [f.targetPath, f]))
    // Both Tracked Files appear, placed in the default Workspace.
    expect(byPath.get('.zshrc')?.workspaceId).toBe('personal')
    expect(byPath.get('.gitconfig')?.workspaceId).toBe('personal')
    // The edited File carries a real local-axis status; the untouched one is clean.
    expect(byPath.get('.zshrc')?.status).toBe('modified')
    expect(byPath.get('.gitconfig')?.status).toBeNull()
    // Neither File is OS-scoped-out, so neither is muted.
    expect(byPath.get('.zshrc')?.muted).toBe(false)
    // The default Workspace travels in the view so the tree can section by Workspace.
    expect(view.workspaces[0]?.id).toBe('personal')

    // fileDiff() returns chezmoi's real unified diff for the edited File…
    const diff = await env.fileDiff('.zshrc')
    expect(diff).toContain('PAGER=less')
    // …and an empty diff for the clean File (no fabricated patch).
    await expect(env.fileDiff('.gitconfig')).resolves.toBe('')
  })

  it('env B never applies a File outside its subscription (invariant #3 end-to-end)', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    const aHome = join(root, 'a-home')
    const aSource = join(root, 'a-source')
    await mkdir(aHome, { recursive: true })
    await initSourceRepo(aSource, remote)
    const envA = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: aSource,
      destinationDir: aHome,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })

    await writeFile(join(aHome, '.zshrc'), 'subscribed bytes\n')
    await envA.trackFile('.zshrc', 'trace-track')
    await envA.commitTracked(['.zshrc'], 'trace-commit')
    await envA.syncPush('trace-push')

    // Env B clones, but we narrow its subscription to a Workspace that does NOT own
    // the File, then ask it to apply the path directly — it must refuse to write.
    const bHome = join(root, 'b-home')
    const bSource = join(root, 'b-source')
    await mkdir(bHome, { recursive: true })
    await cloneRepo(gitBin, remote, bSource)
    const bStore = new MyenvStore(bSource)
    // Register env B subscribed to a different Workspace than the File's ('personal').
    await bStore.registerEnvironment({
      id: 'env-b',
      label: 'work-laptop',
      os: process.platform,
      subscribedWorkspaces: ['work'],
    })
    const envB = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: bSource,
      destinationDir: bHome,
      environment: { id: 'env-b', label: 'work-laptop', os: process.platform },
    })

    // listIncomingClean must NOT surface the non-subscribed File…
    expect(await envB.listIncomingClean('trace-list')).toEqual([])
    // …and a direct apply of the path is refused (witness never minted) — File stays absent.
    const applied = await envB.applyIncoming(['.zshrc'], 'trace-apply')
    expect(applied.applied).toEqual([])
    expect(existsSync(join(bHome, '.zshrc'))).toBe(false)
  })
})

// The destructive/lifecycle verbs (issue 1-08): Untrack (`forget`) keeps the File on
// disk everywhere; Delete everywhere (`destroy`) removes it from the Den AND disk; the
// blast-radius query names every environment subscribed to the File's Workspace.
describe('DenService Untrack / Delete everywhere verbs (issue 1-08)', () => {
  it('untrackFile maps to forget: source + placement removed, but the File STAYS on disk', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    const home = join(root, 'home')
    const source = join(root, 'source')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source, remote)
    const tracer = new OperationTracer()
    const env = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
      tracer,
    })

    // Track + Commit a File so it is managed and placed in the synced `.myenv/`.
    await writeFile(join(home, '.zshrc'), 'keep me on disk\n')
    await env.trackFile('.zshrc', 'trace-track')
    await env.commitTracked(['.zshrc'], 'trace-commit')
    const store = new MyenvStore(source)
    expect((await store.readWorkspaces()).placements).toContainEqual({
      targetPath: '.zshrc',
      workspaceId: 'personal',
      groupId: null,
      scope: null,
    })

    await env.untrackFile('.zshrc', 'trace-untrack')

    // forget removes the source-state entry…
    expect(existsSync(join(source, 'dot_zshrc'))).toBe(false)
    // …the synced placement is dropped so env B stops seeing it as incoming…
    expect((await store.readWorkspaces()).placements).toEqual([])
    // …and the real File is UNTOUCHED on disk (the non-destructive Untrack contract).
    await expect(readFile(join(home, '.zshrc'), 'utf8')).resolves.toBe('keep me on disk\n')
    // The Untrack is a recorded Operation (a wide event landed for it).
    expect(tracer.events().map((e) => e.kind)).toContain('untrack')
    // It is committed LOCALLY (ADR 0006): nothing dirty left in the source tree.
    await expect(new GitTransport({ gitBin, repoDir: source }).status()).resolves.toBe('')
  })

  it('deleteEverywhereFile maps to destroy: File removed from the Den AND from disk', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    const home = join(root, 'home')
    const source = join(root, 'source')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source, remote)
    const tracer = new OperationTracer()
    const env = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
      tracer,
    })

    await writeFile(join(home, '.zshrc'), 'delete me everywhere\n')
    await env.trackFile('.zshrc', 'trace-track')
    await env.commitTracked(['.zshrc'], 'trace-commit')

    await env.deleteEverywhereFile('.zshrc', 'trace-delete')

    // destroy removes BOTH the source-state entry and the destination copy here…
    expect(existsSync(join(source, 'dot_zshrc'))).toBe(false)
    expect(existsSync(join(home, '.zshrc'))).toBe(false)
    // …and the File leaves the synced `.myenv/` entirely so the deletion travels.
    expect((await new MyenvStore(source).readWorkspaces()).placements).toEqual([])
    // It is a recorded Operation, committed LOCALLY (clean source tree after).
    expect(tracer.events().map((e) => e.kind)).toContain('delete-everywhere')
    await expect(new GitTransport({ gitBin, repoDir: source }).status()).resolves.toBe('')
  })

  it('Delete everywhere TRAVELS: after Sync, a second environment no longer receives the File', async () => {
    // The whole point of `destroy` over `forget` is that the removal reaches every
    // environment. This proves the source-file deletion is actually committed + pushed
    // (the bug a path-scoped commit would hide), so env B clones a Den without the File.
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    const aHome = join(root, 'a-home')
    const aSource = join(root, 'a-source')
    await mkdir(aHome, { recursive: true })
    await initSourceRepo(aSource, remote)
    const envA = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: aSource,
      destinationDir: aHome,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })

    // env A Tracks + Commits + Syncs a File, then Deletes it everywhere and Syncs again.
    await writeFile(join(aHome, '.zshrc'), 'doomed bytes\n')
    await envA.trackFile('.zshrc', 'trace-track')
    await envA.commitTracked(['.zshrc'], 'trace-commit')
    await envA.syncPush('trace-push-1')
    await envA.deleteEverywhereFile('.zshrc', 'trace-delete')
    await envA.syncPush('trace-push-2')

    // env B clones the Den AFTER the deletion travelled — it must not see the File at all.
    const bSource = join(root, 'b-source')
    await cloneRepo(gitBin, remote, bSource)
    const bStore = new MyenvStore(bSource)
    // The placement is gone from the synced model…
    expect((await bStore.readWorkspaces()).placements).toEqual([])
    // …and the source-state file itself is absent from the cloned Den (the deletion
    // was committed, not left dangling), so it can never be applied on env B.
    expect(existsSync(join(bSource, 'dot_zshrc'))).toBe(false)
  })

  it('affectedEnvironments names EVERY environment subscribed to the File’s Workspace', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    const home = join(root, 'home')
    const source = join(root, 'source')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source, remote)
    const env = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })

    // Track a File (placed in the default 'personal' Workspace) and register a SECOND
    // environment that also subscribes to it, plus a THIRD that does NOT — only the
    // subscribers are in the destructive verb's blast radius (their access boundary).
    await writeFile(join(home, '.zshrc'), 'shared bytes\n')
    await env.trackFile('.zshrc', 'trace-track')
    const store = new MyenvStore(source)
    await store.registerEnvironment({
      id: 'env-b',
      label: 'work-laptop',
      os: process.platform,
      subscribedWorkspaces: ['personal'],
    })
    await store.registerEnvironment({
      id: 'env-c',
      label: 'home-pc',
      os: process.platform,
      // Subscribed to a DIFFERENT Workspace, so the File does not apply here.
      subscribedWorkspaces: ['work'],
    })

    const affected = await env.affectedEnvironments('.zshrc')
    const labels = affected.map((a) => a.label)

    // Both subscribers are named; the non-subscriber is NOT (it would not lose the File).
    expect(labels).toEqual(expect.arrayContaining(['this-mac', 'work-laptop']))
    expect(labels).not.toContain('home-pc')
    // The environment the user is acting from is surfaced first AND flagged isSelf.
    expect(affected[0]).toMatchObject({ id: 'env-a', label: 'this-mac', isSelf: true })
    expect(affected.filter((a) => a.isSelf)).toHaveLength(1)
  })
})

// Workspaces (access boundary) + nested Groups (organization), issue 1-14. Proves the
// user-authored organization layer is real end to end: a created Workspace/Group is
// persisted in the synced `.myenv/`, travels through the Remote to a second
// environment, and — the load-bearing invariant — filing a File into a Group changes
// NEITHER its access (Workspace) NOR its on-disk path.
describe('DenService Workspaces + nested Groups (issue 1-14)', () => {
  it('creates a Workspace + nested Groups, files a File into a Group, and it all travels through Sync', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    const aHome = join(root, 'a-home')
    const aSource = join(root, 'a-source')
    await mkdir(aHome, { recursive: true })
    await initSourceRepo(aSource, remote)
    const envA = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: aSource,
      destinationDir: aHome,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })

    // Track a File (auto-placed in the default 'personal' Workspace, no Group).
    await writeFile(join(aHome, '.zshrc'), 'export EDITOR=nvim\n')
    await envA.trackFile('.zshrc', 'trace-track')

    // Capture the File's on-disk path + access BEFORE any organization.
    const store = new MyenvStore(aSource)
    const before = (await store.readWorkspaces()).placements.find((p) => p.targetPath === '.zshrc')!
    expect(before).toMatchObject({ workspaceId: 'personal', groupId: null })

    // Create a nested Group ("Shell" → "zsh") inside the default Workspace, then file
    // the File under the child Group — a pure organization move.
    const shell = await envA.createGroup('personal', 'Shell', null, 'trace-grp-1')
    const zsh = await envA.createGroup('personal', 'zsh', shell.id, 'trace-grp-2')
    await envA.moveFileToGroup('.zshrc', zsh.id, 'trace-move')

    const after = (await store.readWorkspaces()).placements.find((p) => p.targetPath === '.zshrc')!
    // Only the Group changed — access boundary + on-disk path are byte-for-byte the same.
    expect(after.groupId).toBe(zsh.id)
    expect(after.workspaceId).toBe(before.workspaceId) // access UNCHANGED
    expect(after.targetPath).toBe(before.targetPath) // path UNCHANGED

    // The File's source-state file (its real on-disk encoding) is exactly where it was:
    // a Group is metadata, so `dot_zshrc` never moved.
    expect(existsSync(join(aSource, 'dot_zshrc'))).toBe(true)

    // Create a second Workspace too (this is what reveals the concept in the UI).
    const work = await envA.createWorkspace('Work', 'trace-ws')
    expect(work.id).not.toBe('personal')

    // Commit the File + Sync so the whole organization tree travels to a second env.
    await envA.commitTracked(['.zshrc'], 'trace-commit')
    await envA.syncPush('trace-push')

    // ── env B clones and reconstructs the SAME Workspace/Group tree from `.myenv/`. ──
    const bSource = join(root, 'b-source')
    await cloneRepo(gitBin, remote, bSource)
    const bDoc = await new MyenvStore(bSource).readWorkspaces()

    // Both Workspaces travelled…
    expect(bDoc.workspaces.map((w) => w.label).sort()).toEqual(['Personal', 'Work'])
    // …the nested Groups travelled with their parent links intact…
    const personal = bDoc.workspaces.find((w) => w.id === 'personal')!
    expect(personal.groups.map((g) => g.label)).toEqual(['Shell', 'zsh'])
    expect(personal.groups.find((g) => g.label === 'zsh')?.parentId).toBe(shell.id)
    // …and the File is still filed under the child Group, with unchanged access + path.
    expect(bDoc.placements).toContainEqual({
      targetPath: '.zshrc',
      workspaceId: 'personal',
      groupId: zsh.id,
      scope: null,
    })
  })

  it('the fileTree view carries each File’s Group + the Workspaces’ Group trees (issue 1-14)', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    const home = join(root, 'home')
    const source = join(root, 'source')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source, remote)
    const env = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })

    await writeFile(join(home, '.zshrc'), 'export EDITOR=nvim\n')
    await env.trackFile('.zshrc', 'trace-track')
    await env.commitTracked(['.zshrc'], 'trace-commit')
    const shell = await env.createGroup('personal', 'Shell', null, 'trace-grp')
    await env.moveFileToGroup('.zshrc', shell.id, 'trace-move')

    const view = await env.fileTree()
    // The tree row knows its Group so the renderer can nest it under "Shell".
    expect(view.files.find((f) => f.targetPath === '.zshrc')?.groupId).toBe(shell.id)
    // The Workspace carries its Group tree so the renderer can render the sections.
    expect(view.workspaces.find((w) => w.id === 'personal')?.groups.map((g) => g.label)).toEqual([
      'Shell',
    ])
  })
})

// Review & Apply surface (issue 1-09): the incoming summary names the SOURCE
// environment for the "N incoming from <env>" entry, each incoming File carries its
// Remote-axis marker (↓), the incoming diff previews a File before Apply, and Apply is
// per-File atomic across the real two-environment thread.
describe('DenService Review & Apply surface (issue 1-09)', () => {
  it('incomingSummary names the source environment + marks each incoming File; incomingDiff previews it; Apply writes it', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    // ── env A Tracks + Commits + Syncs a File (the source environment "this-mac"). ──
    const aHome = join(root, 'a-home')
    const aSource = join(root, 'a-source')
    await mkdir(aHome, { recursive: true })
    await initSourceRepo(aSource, remote)
    const envA = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: aSource,
      destinationDir: aHome,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })
    await writeFile(join(aHome, '.zshrc'), 'export EDITOR=nvim\nexport PAGER=less\n')
    await envA.trackFile('.zshrc', 'trace-track')
    await envA.commitTracked(['.zshrc'], 'trace-commit')
    await envA.syncPush('trace-push')

    // ── env B clones the Den and registers itself, so the registry has BOTH envs. ──
    const bHome = join(root, 'b-home')
    const bSource = join(root, 'b-source')
    await mkdir(bHome, { recursive: true })
    await cloneRepo(gitBin, remote, bSource)
    await new MyenvStore(bSource).registerEnvironment({
      id: 'env-b',
      label: 'work-laptop',
      os: process.platform,
      subscribedWorkspaces: ['personal'],
    })
    const envB = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: bSource,
      destinationDir: bHome,
      environment: { id: 'env-b', label: 'work-laptop', os: process.platform },
    })

    // The summary names where the incoming change came FROM (the OTHER environment)…
    const summary = await envB.incomingSummary('trace-summary')
    expect(summary.fromEnvironmentLabel).toBe('this-mac')
    // …and each incoming File carries its Remote-axis marker (↓ incoming for clean) plus
    // the planner's create/no-confirm verdict (1-10).
    expect(summary.items).toEqual([
      {
        targetPath: '.zshrc',
        workspaceId: 'personal',
        marker: 'incoming',
        kind: 'create',
        requiresConfirmation: false,
      },
    ])

    // The user can REVIEW the incoming change as a diff BEFORE applying anything.
    const preview = await envB.incomingDiff('.zshrc')
    expect(preview).toContain('PAGER=less')
    // Nothing is on disk yet — review precedes Apply.
    expect(existsSync(join(bHome, '.zshrc'))).toBe(false)

    // Apply writes the File with per-File outcomes (one File, one ok result).
    const result = await envB.applyIncoming(['.zshrc'], 'trace-apply')
    expect(result.applied).toEqual(['.zshrc'])
    expect(result.failed).toEqual([])
    expect(result.results).toEqual([{ targetPath: '.zshrc', outcome: 'ok' }])
    await expect(readFile(join(bHome, '.zshrc'), 'utf8')).resolves.toBe(
      'export EDITOR=nvim\nexport PAGER=less\n',
    )
  })

  it('incomingSummary falls back to a neutral source label when no other environment is recorded', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])
    const home = join(root, 'home')
    const source = join(root, 'source')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source, remote)
    const env = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-solo', label: 'this-mac', os: process.platform },
    })
    // Only this environment is registered → the source label must not be a blank.
    await env.registerEnvironment('trace-register')
    const summary = await env.incomingSummary('trace-summary')
    expect(summary.fromEnvironmentLabel).toBe('another environment')
  })
})

describe('DenService ApplyPlanner invariants end-to-end (issue 1-10, real chezmoi/git)', () => {
  it('invariant #2: an incoming Apply is BLOCKED when the File has an uncommitted local edit (never silently overwritten)', async () => {
    // Two environments share a File. env B applies it, then HAND-EDITS the real File on
    // disk (drift outside dotden) WITHOUT committing. Meanwhile env A changes the same
    // File and syncs. env B's Apply of the incoming change must be refused, because writing
    // it would silently throw away env B's in-progress local edit (invariant #2).
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    const aHome = join(root, 'a-home')
    const aSource = join(root, 'a-source')
    await mkdir(aHome, { recursive: true })
    await initSourceRepo(aSource, remote)
    const envA = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: aSource,
      destinationDir: aHome,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })

    // env A: Track + Commit + Sync a File.
    await writeFile(join(aHome, '.zshrc'), 'export EDITOR=nvim\n')
    await envA.trackFile('.zshrc', 'trace-track')
    await envA.commitTracked(['.zshrc'], 'trace-commit')
    await envA.syncPush('trace-push-1')

    // env B: clone + apply the File so it exists on disk and is managed.
    const bHome = join(root, 'b-home')
    const bSource = join(root, 'b-source')
    await mkdir(bHome, { recursive: true })
    await cloneRepo(gitBin, remote, bSource)
    const envB = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: bSource,
      destinationDir: bHome,
      environment: { id: 'env-b', label: 'work-laptop', os: process.platform },
    })
    await envB.applyIncoming(['.zshrc'], 'trace-apply-initial')
    await expect(readFile(join(bHome, '.zshrc'), 'utf8')).resolves.toBe('export EDITOR=nvim\n')

    // env B: the user HAND-EDITS .zshrc on disk (uncommitted local drift, outside dotden).
    await writeFile(join(bHome, '.zshrc'), 'export EDITOR=nvim\n# my in-progress local tweak\n')

    // env A: change the same File and Sync, so there is an incoming change for env B.
    await writeFile(join(aHome, '.zshrc'), 'export EDITOR=vim\n')
    await envA.commitTracked(['.zshrc'], 'trace-commit-2')
    await envA.syncPush('trace-push-2')
    await envB.listIncomingClean('trace-list') // fetch the incoming change into env B.

    // env B Applies — the guard BLOCKS it: the local edit is never silently overwritten.
    const result = await envB.applyIncoming(['.zshrc'], 'trace-apply-blocked')
    expect(result.applied).toEqual([])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({
      targetPath: '.zshrc',
      outcome: 'error',
      refusal: 'blocked-uncommitted-edit',
      retryable: true,
    })
    // The user's in-progress edit is INTACT on disk — nothing was overwritten.
    await expect(readFile(join(bHome, '.zshrc'), 'utf8')).resolves.toBe(
      'export EDITOR=nvim\n# my in-progress local tweak\n',
    )
  })

  it('invariant #2 atomic re-check: a File dirtied AFTER review is still refused by the write-path guard (no TOCTOU)', async () => {
    // Even if the plan was built when the File was clean, ChezmoiAdapter re-checks at the
    // instant of the write. We drive that directly: apply a clean File, then dirty it, then
    // applyGuarded must throw — proving the guarantee is the write-path re-check, not the plan.
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])
    const home = join(root, 'home')
    const source = join(root, 'source')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source, remote)
    const env = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })
    await writeFile(join(home, '.zshrc'), 'export EDITOR=nvim\n')
    await env.trackFile('.zshrc', 'trace-track')
    await env.commitTracked(['.zshrc'], 'trace-commit')

    // Reach the adapter's write-path guard directly (the authoritative re-check).
    const chezmoi = (env as unknown as { chezmoi: ChezmoiHandle }).chezmoi
    // Clean now → guarded apply is allowed.
    await chezmoi.applyGuarded('.zshrc')
    // The user dirties the File AFTER any plan would have been built.
    await writeFile(join(home, '.zshrc'), 'export EDITOR=nvim\n# drift\n')
    // The atomic write-path re-check refuses — no plan→apply TOCTOU window.
    await expect(chezmoi.applyGuarded('.zshrc')).rejects.toThrow(/uncommitted local edits/i)
  })

  it('invariant #4: a REAL incoming deletion is refused needs-confirmation (File NOT deleted); confirming it removes the File', async () => {
    // A genuine incoming deletion travels: env A Tracks + Commits + Syncs a File, env B
    // Applies it (so it is managed + on disk), then env A REMOVES the File from the Den
    // (the source-state file is deleted AND a `.chezmoiremove` directive is added — the
    // faithful "the source removed it, so Apply will delete it here" signal) and Syncs.
    // After env B merges that incoming commit, `chezmoi status` reports ` D .zshrc`
    // (column Y=D) — exactly what parseIncomingDeletions detects. An Apply WITHOUT
    // confirmation must REFUSE (the destination File is never silently deleted); only
    // WITH the path confirmed does the destination File get removed (invariant #4).
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    const aHome = join(root, 'a-home')
    const aSource = join(root, 'a-source')
    await mkdir(aHome, { recursive: true })
    await initSourceRepo(aSource, remote)
    const envA = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: aSource,
      destinationDir: aHome,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })

    // env A: Track + Commit + Sync a File.
    await writeFile(join(aHome, '.zshrc'), 'export EDITOR=nvim\n')
    await envA.trackFile('.zshrc', 'trace-track')
    await envA.commitTracked(['.zshrc'], 'trace-commit')
    await envA.syncPush('trace-push-1')

    // env B: clone + Apply so the File is managed and present on disk.
    const bHome = join(root, 'b-home')
    const bSource = join(root, 'b-source')
    await mkdir(bHome, { recursive: true })
    await cloneRepo(gitBin, remote, bSource)
    const envB = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: bSource,
      destinationDir: bHome,
      environment: { id: 'env-b', label: 'work-laptop', os: process.platform },
    })
    await envB.applyIncoming(['.zshrc'], 'trace-apply-initial')
    expect(existsSync(join(bHome, '.zshrc'))).toBe(true)

    // env A: remove the File from the Den — delete its source-state file and add a
    // `.chezmoiremove` directive so Apply actively removes it on every environment — and Sync.
    await runCommand(gitBin, ['rm', '-q', 'dot_zshrc'], { cwd: aSource })
    await writeFile(join(aSource, '.chezmoiremove'), '.zshrc\n')
    await runCommand(gitBin, ['add', '-A'], { cwd: aSource })
    await runCommand(gitBin, ['commit', '-qm', 'Remove .zshrc from the Den'], { cwd: aSource })
    await envA.syncPush('trace-push-2')

    // env B: fetch + merge the incoming deletion into its source working tree (the apply-half
    // of a Sync brings the removed source-state + the `.chezmoiremove` directive into place).
    await new GitTransport({ gitBin, repoDir: bSource }).fetch()
    await runCommand(gitBin, ['merge', '--ff-only', 'origin/main'], { cwd: bSource })

    // `chezmoi status` now reports the incoming deletion (column Y=D) — the real signal.
    expect(parseIncomingDeletions(await readChezmoiStatus(bSource, bHome))).toContain('.zshrc')

    // UNCONFIRMED: the incoming deletion is REFUSED — the destination File survives untouched.
    const unconfirmed = await envB.applyIncoming(['.zshrc'], 'trace-apply-unconfirmed')
    expect(unconfirmed.applied).toEqual([])
    expect(unconfirmed.failed).toHaveLength(1)
    expect(unconfirmed.failed[0]).toMatchObject({
      targetPath: '.zshrc',
      outcome: 'error',
      refusal: 'needs-confirmation',
      retryable: true,
    })
    // The File is STILL on disk — an unconfirmed deletion never reached `chezmoi apply`.
    expect(existsSync(join(bHome, '.zshrc'))).toBe(true)

    // CONFIRMED: passing the path in confirmedDeletions applies the deletion — File removed.
    const confirmed = await envB.applyIncoming(['.zshrc'], 'trace-apply-confirmed', ['.zshrc'])
    expect(confirmed.applied).toEqual(['.zshrc'])
    expect(confirmed.failed).toEqual([])
    expect(existsSync(join(bHome, '.zshrc'))).toBe(false)
  })
})

// Conflict resolution (issue 1-11): the cross-environment axis. Two environments Commit
// the same File so their source-state histories diverge; `git fetch` + `git merge` in the
// source repo auto-merges NON-overlapping hunks (no prompt) and leaves `<<<<<<<` markers
// only on OVERLAP. The conflict-sync-roundtrip spike the issue requires before build, and
// the load-bearing proof that resolution writes ONLY the user's chosen bytes (ADR 0008 #1).
describe('DenService conflict resolution (issue 1-11, real chezmoi/git)', () => {
  it('auto-merges non-overlapping edits to the same File WITHOUT asking the user to resolve', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    // env A: Track + Commit + Sync a multi-line File.
    const aHome = join(root, 'a-home')
    const aSource = join(root, 'a-source')
    await mkdir(aHome, { recursive: true })
    await initSourceRepo(aSource, remote)
    const envA = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: aSource,
      destinationDir: aHome,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })
    // A File with enough unchanged context between the two edit sites that git can
    // auto-merge them: env A edits near the TOP, env B near the BOTTOM, with many
    // untouched lines in between so the hunks never overlap.
    const base = ['top', '', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', '', 'bottom', ''].join('\n')
    await writeFile(join(aHome, '.zshrc'), base)
    await envA.trackFile('.zshrc', 'trace-track')
    await envA.commitTracked(['.zshrc'], 'trace-commit')
    await envA.syncPush('trace-push-1')

    // env B: clone, then change the BOTTOM region and Commit + Sync.
    const bHome = join(root, 'b-home')
    const bSource = join(root, 'b-source')
    await mkdir(bHome, { recursive: true })
    await cloneRepo(gitBin, remote, bSource)
    await configureIdentity(bSource)
    const envB = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: bSource,
      destinationDir: bHome,
      environment: { id: 'env-b', label: 'work-laptop', os: process.platform },
    })
    await envB.applyIncoming(['.zshrc'], 'trace-apply')
    await writeFile(join(bHome, '.zshrc'), base.replace('bottom', 'CHANGED-BY-B'))
    await envB.commitTracked(['.zshrc'], 'trace-commit-b')
    await envB.syncPush('trace-push-b')

    // env A: change the TOP region (non-overlapping with B's bottom edit) and Commit.
    await writeFile(join(aHome, '.zshrc'), base.replace('top', 'CHANGED-BY-A'))
    await envA.commitTracked(['.zshrc'], 'trace-commit-a')

    // env A detects: git auto-merges the two non-overlapping edits — NO Conflict to resolve.
    const review = await envA.detectConflicts('trace-detect')
    expect(review.autoMerged).toBe(true)
    expect(review.conflicts).toEqual([])

    // The merged source-state File carries BOTH non-overlapping edits.
    const merged = await readFile(join(aSource, 'dot_zshrc'), 'utf8')
    expect(merged).toContain('CHANGED-BY-A')
    expect(merged).toContain('CHANGED-BY-B')
    // No conflict markers were left anywhere.
    expect(merged).not.toContain('<<<<<<<')
  })

  it('surfaces a true (overlapping) Conflict with three sides, and resolve writes ONLY the chosen bytes', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    const aHome = join(root, 'a-home')
    const aSource = join(root, 'a-source')
    await mkdir(aHome, { recursive: true })
    await initSourceRepo(aSource, remote)
    const envA = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: aSource,
      destinationDir: aHome,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })
    await writeFile(join(aHome, '.zshrc'), 'export EDITOR=base\n')
    await envA.trackFile('.zshrc', 'trace-track')
    await envA.commitTracked(['.zshrc'], 'trace-commit')
    await envA.syncPush('trace-push-1')

    // env B: clone, change the SAME line, Commit + Sync.
    const bHome = join(root, 'b-home')
    const bSource = join(root, 'b-source')
    await mkdir(bHome, { recursive: true })
    await cloneRepo(gitBin, remote, bSource)
    await configureIdentity(bSource)
    const envB = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: bSource,
      destinationDir: bHome,
      environment: { id: 'env-b', label: 'work-laptop', os: process.platform },
    })
    await envB.applyIncoming(['.zshrc'], 'trace-apply')
    await writeFile(join(bHome, '.zshrc'), 'export EDITOR=theirs\n')
    await envB.commitTracked(['.zshrc'], 'trace-commit-b')
    await envB.syncPush('trace-push-b')

    // env A: change the SAME line differently and Commit — now the histories overlap.
    await writeFile(join(aHome, '.zshrc'), 'export EDITOR=mine\n')
    await envA.commitTracked(['.zshrc'], 'trace-commit-a')

    // Detect surfaces a TRUE Conflict with all three sides for the merge view.
    const review = await envA.detectConflicts('trace-detect')
    expect(review.autoMerged).toBe(false)
    expect(review.conflicts).toHaveLength(1)
    const conflict = review.conflicts[0]!
    expect(conflict.targetPath).toBe('dot_zshrc')
    // Keep mine = ours/HEAD; Take theirs = the Remote; Open both = the marker-bearing union.
    expect(conflict.current).toContain('mine')
    expect(conflict.incoming).toContain('theirs')
    expect(conflict.both).toContain('<<<<<<<')
    expect(conflict.both).toContain('mine')
    expect(conflict.both).toContain('theirs')

    // Resolve "Take theirs" — ONLY the chosen bytes are written, then the merge completes.
    await envA.resolveConflictFile('dot_zshrc', 'incoming', 'trace-resolve')
    await envA.completeConflictResolution('trace-complete')

    // The resolved source-state File holds exactly theirs — no markers, no auto-blend.
    const resolved = await readFile(join(aSource, 'dot_zshrc'), 'utf8')
    expect(resolved).toBe('export EDITOR=theirs\n')
    expect(resolved).not.toContain('<<<<<<<')
    // The merge is committed (clean tree) and the histories are joined.
    await expect(new GitTransport({ gitBin, repoDir: aSource }).status()).resolves.toBe('')
  })

  it('Abort discards the half-merged tree and resolves NOTHING', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    const aHome = join(root, 'a-home')
    const aSource = join(root, 'a-source')
    await mkdir(aHome, { recursive: true })
    await initSourceRepo(aSource, remote)
    const envA = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: aSource,
      destinationDir: aHome,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })
    await writeFile(join(aHome, '.zshrc'), 'export EDITOR=base\n')
    await envA.trackFile('.zshrc', 'trace-track')
    await envA.commitTracked(['.zshrc'], 'trace-commit')
    await envA.syncPush('trace-push-1')

    const bSource = join(root, 'b-source')
    await cloneRepo(gitBin, remote, bSource)
    await configureIdentity(bSource)
    const envB = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: bSource,
      destinationDir: join(root, 'b-home'),
      environment: { id: 'env-b', label: 'work-laptop', os: process.platform },
    })
    await mkdir(join(root, 'b-home'), { recursive: true })
    await envB.applyIncoming(['.zshrc'], 'trace-apply')
    await writeFile(join(root, 'b-home', '.zshrc'), 'export EDITOR=theirs\n')
    await envB.commitTracked(['.zshrc'], 'trace-commit-b')
    await envB.syncPush('trace-push-b')

    await writeFile(join(aHome, '.zshrc'), 'export EDITOR=mine\n')
    await envA.commitTracked(['.zshrc'], 'trace-commit-a')

    const review = await envA.detectConflicts('trace-detect')
    expect(review.autoMerged).toBe(false)

    // Abort: the merge is undone, the tree returns to env A's own Commit, nothing resolved.
    await envA.abortConflictResolution('trace-abort')
    await expect(new GitTransport({ gitBin, repoDir: aSource }).status()).resolves.toBe('')
    const afterAbort = await readFile(join(aSource, 'dot_zshrc'), 'utf8')
    expect(afterAbort).toBe('export EDITOR=mine\n') // env A's own bytes, untouched.
    expect(afterAbort).not.toContain('<<<<<<<')
  })
})

// OS Scope + inheritance (issue 1-15): the OS-applicability axis mapped FAITHFULLY onto
// per-OS `.chezmoiignore`. Proves the whole slice end-to-end against real chezmoi/git: a
// File scoped to another OS lands in the generated `.chezmoiignore` and `chezmoi ignored`
// reports it (the muted set), the Scope intent travels through Sync to a second
// environment, and the narrowable-never-broadenable inheritance holds with real binaries.
describe('DenService OS Scope + inheritance (issue 1-15, real chezmoi/git)', () => {
  it('scopes a File out of this OS → it appears in chezmoi ignored (muted) and is not applied', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])
    const home = join(root, 'home')
    const source = join(root, 'source')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source, remote)
    const env = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })

    // Track a universal File + a File we will scope to a DIFFERENT OS than this environment.
    const otherOs = process.platform === 'win32' ? 'linux' : 'win32'
    await writeFile(join(home, '.zshrc'), 'export EDITOR=nvim\n')
    await writeFile(join(home, '.other-os-file'), 'belongs elsewhere\n')
    await env.trackFile('.zshrc', 'trace-track-1')
    await env.trackFile('.other-os-file', 'trace-track-2')
    await env.commitTracked(['.zshrc', '.other-os-file'], 'trace-commit')

    // Before scoping, neither File is muted (both apply on this OS).
    let view = await env.fileTree()
    expect(view.files.find((f) => f.targetPath === '.other-os-file')?.muted).toBe(false)

    // Scope the second File to the OTHER OS only → it does not belong here.
    const effective = await env.setFileScope('.other-os-file', [otherOs], 'trace-scope')
    expect(effective).toEqual([otherOs])

    // The FAITHFUL result: `chezmoi ignored` (over the generated `.chezmoiignore`) reports
    // exactly the out-of-OS File, so the tree renders it muted — the universal File is not.
    view = await env.fileTree()
    const scopedOut = view.files.find((f) => f.targetPath === '.other-os-file')
    expect(scopedOut?.muted).toBe(true)
    expect(scopedOut?.scope).toEqual([otherOs])
    expect(view.files.find((f) => f.targetPath === '.zshrc')?.muted).toBe(false)

    // The generated `.chezmoiignore` lists the out-of-OS File AND still keeps `.myenv/` out.
    const ignore = await readFile(join(source, '.chezmoiignore'), 'utf8')
    expect(ignore).toContain('.other-os-file')
    expect(ignore).toContain('.myenv/')
  })

  it('the OS Scope intent travels through Sync to a second environment', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])
    const aHome = join(root, 'a-home')
    const aSource = join(root, 'a-source')
    await mkdir(aHome, { recursive: true })
    await initSourceRepo(aSource, remote)
    const envA = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: aSource,
      destinationDir: aHome,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })

    const otherOs = process.platform === 'win32' ? 'linux' : 'win32'
    await writeFile(join(aHome, '.scoped-file'), 'scope me\n')
    await envA.trackFile('.scoped-file', 'trace-track')
    // Commit the File FIRST (so its source state is recorded), THEN scope it out of this OS.
    // Scoping a File OUT makes chezmoi treat it as unmanaged HERE, so it must already be
    // committed — the source state + the synced Scope intent both travel on the next Sync.
    await envA.commitTracked(['.scoped-file'], 'trace-commit')
    await envA.setFileScope('.scoped-file', [otherOs], 'trace-scope')
    await envA.syncPush('trace-push')

    // env B clones the Den — the Scope INTENT travelled in `.myenv/`, so env B reads the
    // same effective Scope (the Scope is synced user-authored data, ADR 0024).
    const bSource = join(root, 'b-source')
    await cloneRepo(gitBin, remote, bSource)
    const bDoc = await new MyenvStore(bSource).readWorkspaces()
    const placement = bDoc.placements.find((p) => p.targetPath === '.scoped-file')
    expect(placement?.scope).toEqual([otherOs])
  })

  it('a File can NARROW within its Folder but NEVER broaden past it, across the service (the invariant)', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])
    const home = join(root, 'home')
    const source = join(root, 'source')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source, remote)
    const env = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })

    await writeFile(join(home, '.zshrc'), 'export EDITOR=nvim\n')
    await env.trackFile('.zshrc', 'trace-track')
    await env.commitTracked(['.zshrc'], 'trace-commit')

    // File it under a Folder (Group) scoped to mac+linux, then…
    const desktop = await env.createGroup('personal', 'Desktop', null, 'trace-grp')
    await env.moveFileToGroup('.zshrc', desktop.id, 'trace-move')
    await env.setGroupScope('personal', desktop.id, ['darwin', 'linux'], 'trace-grp-scope')

    // …narrow the File to linux only (WITHIN the Folder) → linux.
    expect(await env.setFileScope('.zshrc', ['linux'], 'trace-narrow')).toEqual(['linux'])

    // …try to BROADEN it to include win32 (NOT in the Folder) → win32 is clamped away.
    const broadened = await env.setFileScope('.zshrc', ['linux', 'win32'], 'trace-broaden')
    expect(broadened).toEqual(['linux'])
    expect(broadened).not.toContain('win32')

    // The effective Scope the tree surfaces reflects the clamp — never the broadened request.
    const view = await env.fileTree()
    expect(view.files.find((f) => f.targetPath === '.zshrc')?.scope).toEqual(['linux'])
  })
})

/** Read raw `chezmoi status` for a source/destination pair (test setup probe only). */
async function readChezmoiStatus(sourceDir: string, destinationDir: string): Promise<string> {
  const { stdout } = await runCommand(chezmoiBin, [
    `--source=${sourceDir}`,
    `--destination=${destinationDir}`,
    'status',
  ])
  return stdout
}

/** Minimal structural view of the private ChezmoiAdapter the guard test reaches into. */
interface ChezmoiHandle {
  applyGuarded(targetPath: string): Promise<void>
}

/**
 * Initialize an env's source repo as a git working tree wired to the shared bare
 * Remote, with a deterministic commit identity (so `git commit` works without the
 * host's git config — identity is the test's concern, not production GitTransport).
 */
async function initSourceRepo(sourceDir: string, remote: string): Promise<void> {
  await mkdir(sourceDir, { recursive: true })
  const git = new GitTransport({ gitBin, repoDir: sourceDir })
  await git.init()
  await runCommand(gitBin, ['config', 'user.name', 'dotden tests'], { cwd: sourceDir })
  await runCommand(gitBin, ['config', 'user.email', 'dotden@example.invalid'], { cwd: sourceDir })
  // Hermetic sandbox: force commit signing off so the host's global `commit.gpgsign`
  // (which may target an interactive 1Password/SSH agent) can't hang/fail `git commit`.
  await runCommand(gitBin, ['config', 'commit.gpgsign', 'false'], { cwd: sourceDir })
  await git.addRemote('origin', remote)
}

/**
 * Pin a deterministic commit identity (and disable signing) on an already-cloned repo.
 *
 * A `cloneRepo` working tree inherits NO per-repo git config, so a `git commit` /
 * `git merge` there would fall back to the host's global identity (or fail/hang on a
 * signing agent). The conflict tests commit + merge in the cloned env B repo, so they
 * configure it the same hermetic way {@link initSourceRepo} does for env A.
 */
async function configureIdentity(repoDir: string): Promise<void> {
  await runCommand(gitBin, ['config', 'user.name', 'dotden tests'], { cwd: repoDir })
  await runCommand(gitBin, ['config', 'user.email', 'dotden@example.invalid'], { cwd: repoDir })
  await runCommand(gitBin, ['config', 'commit.gpgsign', 'false'], { cwd: repoDir })
}

/** Resolve a tool binary: env override wins, else first PATH hit, else throw. */
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
