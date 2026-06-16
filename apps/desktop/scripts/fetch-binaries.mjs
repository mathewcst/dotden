/**
 * Fetch the PINNED chezmoi + git binaries dotden bundles, into the exact layout
 * src/main/foundation/tools.ts resolves at runtime (issue 3-19).
 *
 * Reads the single source of truth — resources/bin/tools.lock.json — and for each
 * requested target (the host platform/arch by default, or `--all` for every pinned
 * target, or `--target=<platform>/<arch>`):
 *   1. downloads the pinned release asset,
 *   2. verifies its sha256 against the lock (fail loud on mismatch — never ship the
 *      wrong/corrupted tool silently),
 *   3. extracts it into resources/bin/<platform>/<arch>/ —
 *        - chezmoi: a single static binary  -> bin/<p>/<a>/chezmoi[.exe]
 *        - git (dugite-native): a whole tree -> bin/<p>/<a>/git-dist/  (launcher at
 *          git-dist/bin/git or git-dist/cmd/git.exe),
 *   4. asserts the resulting launcher is executable — a smoke that the bundle is real.
 *
 * Idempotent: a target whose checksum + layout already match is skipped (pass
 * `--force` to re-download). This is the script electron-builder's beforePack hook
 * (scripts/before-pack.mjs) calls so a `pnpm package` always has a populated bin/.
 *
 * Pure Node 24 (global fetch) + the host `tar`/`unzip`; no runtime npm deps so it
 * runs in CI before install completes.
 *
 * Usage:
 *   node scripts/fetch-binaries.mjs                 # host platform/arch
 *   node scripts/fetch-binaries.mjs --all           # every pinned target (CI matrix)
 *   node scripts/fetch-binaries.mjs --target=darwin/arm64
 *   node scripts/fetch-binaries.mjs --force         # ignore the up-to-date check
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = join(here, '..')
const binRoot = join(desktopRoot, 'resources', 'bin')
const lockPath = join(binRoot, 'tools.lock.json')

/** Tools the lock pins, in the order tools.ts needs them. */
const TOOLS = /** @type {const} */ (['chezmoi', 'git'])

/** Parse `--all` / `--target=<p>/<a>` / `--force` flags from argv. */
function parseArgs(argv) {
  const flags = { all: false, force: false, target: null }
  for (const arg of argv) {
    if (arg === '--all') flags.all = true
    else if (arg === '--force') flags.force = true
    else if (arg.startsWith('--target=')) flags.target = arg.slice('--target='.length)
  }
  return flags
}

/** The host's lock target key, e.g. `darwin/arm64` (Node platform/arch). */
function hostTarget() {
  return `${process.platform}/${process.arch}`
}

/** SHA-256 of a Buffer as lowercase hex — the checksum we compare against the lock. */
function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Download `url` to a Buffer, following redirects (GitHub release assets 302 to a CDN). */
async function download(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`download failed: ${url} -> HTTP ${response.status} ${response.statusText}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

/** Run a command, throwing with stderr on a non-zero exit (extraction must fail loud). */
function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: ['ignore', 'inherit', 'pipe'], ...opts })
  if (result.status !== 0) {
    const stderr = result.stderr ? result.stderr.toString() : ''
    throw new Error(`\`${cmd} ${args.join(' ')}\` failed (exit ${result.status}): ${stderr}`)
  }
}

/** Is `path` an existing executable for this process? (the resolver's own test). */
async function isExecutable(path) {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Extract one pinned asset into `destDir` (bin/<platform>/<arch>/) per its `extract` mode:
 *  - `raw`  : the asset IS the binary (chezmoi's windows .exe) → write as `member`.
 *  - `file` : a tar.gz containing the single binary `member` → extract just that file.
 *  - `tree` : a tar.gz whose `treeRoot/` subtree is the whole git distribution → extract
 *             it and move `treeRoot/` to `treeDest/` (git-dist), preserving structure.
 * Returns the absolute path to the runnable launcher to chmod + smoke-assert.
 */
async function extractAsset(tool, target, assetBytes, destDir) {
  const mode = tool.extract
  if (mode === 'raw') {
    const out = join(destDir, target.member)
    await writeFile(out, assetBytes)
    return out
  }

  const scratch = await mkdtemp(join(tmpdir(), 'dotden-fetch-'))
  try {
    const archivePath = join(scratch, target.asset)
    await writeFile(archivePath, assetBytes)

    if (mode === 'file') {
      // Pull the single binary member out of the tar.gz straight into destDir.
      run('tar', ['-xzf', archivePath, '-C', destDir, target.member])
      return join(destDir, target.member)
    }

    if (mode === 'tree') {
      // The dugite-native archive IS the whole git distribution at its root (./bin, ./cmd,
      // ./libexec/git-core, ./templates, …). Unpack it directly into git-dist/, preserving
      // structure so the launcher resolves its own libexec/templates relative to itself.
      const treeDest = join(destDir, tool.treeDest)
      await rm(treeDest, { recursive: true, force: true })
      await mkdir(treeDest, { recursive: true })
      run('tar', ['-xzf', archivePath, '-C', treeDest])
      return join(destDir, target.launcher)
    }

    throw new Error(`unknown extract mode '${mode}' for ${tool.name}`)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

/** Fetch + verify + extract every pinned tool for one target key (e.g. `linux/x64`). */
async function fetchTarget(lock, targetKey, force) {
  const [platform, arch] = targetKey.split('/')
  const destDir = join(binRoot, platform, arch)
  await mkdir(destDir, { recursive: true })

  for (const toolName of TOOLS) {
    const tool = lock[toolName]
    const target = tool.targets[targetKey]
    if (!target) {
      throw new Error(
        `tools.lock.json pins no ${toolName} for target '${targetKey}'. ` +
          `Add it (with its sha256) or build a supported target.`,
      )
    }
    tool.name = toolName

    const launcher =
      tool.extract === 'tree' ? join(destDir, target.launcher) : join(destDir, target.member)

    // Idempotent: skip a target already laid down runnable (unless --force).
    if (!force && (await isExecutable(launcher))) {
      console.log(`✓ ${toolName} ${targetKey} already present (${launcher})`)
      continue
    }

    const url = tool.urlTemplate.replace('${asset}', target.asset)
    console.log(`↓ ${toolName} ${target.version ?? tool.version} ${targetKey} — ${target.asset}`)
    const bytes = await download(url)

    const got = sha256(bytes)
    if (got !== target.sha256) {
      throw new Error(
        `checksum mismatch for ${toolName} ${targetKey} (${target.asset}):\n` +
          `  expected ${target.sha256}\n  got      ${got}\n` +
          `Refusing to bundle an unverified ${toolName} (never fail silently).`,
      )
    }

    const out = await extractAsset(tool, target, bytes, destDir)
    await chmod(out, 0o755)

    if (!(await isExecutable(out))) {
      throw new Error(`extracted ${toolName} is not executable at ${out}`)
    }
    console.log(`✓ ${toolName} ${targetKey} -> ${out}`)
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  const lock = JSON.parse(await readFile(lockPath, 'utf8'))

  let targets
  if (flags.all) {
    // The union of every target key any tool pins (chezmoi + git pin the same set today).
    targets = [...new Set(TOOLS.flatMap((t) => Object.keys(lock[t].targets)))]
  } else if (flags.target) {
    targets = [flags.target]
  } else {
    targets = [hostTarget()]
  }

  console.log(
    `Fetching pinned chezmoi ${lock.chezmoi.version} + git ${lock.git.version} for: ${targets.join(', ')}`,
  )
  for (const targetKey of targets) {
    await fetchTarget(lock, targetKey, flags.force)
  }
  console.log('Done. Bundled tools are in resources/bin/<platform>/<arch>/.')
}

main().catch((error) => {
  console.error(`[fetch-binaries] ${error.message}`)
  process.exit(1)
})
