/**
 * RemoteClient — the V1-Lean Remote connection seam.
 *
 * dotden v1 does no Provider auth of its own: no OAuth, no GitHub App, no PAT
 * storage, no keychain writes. This client implements the pure-git floor from
 * ADR 0020: the user pastes an existing Remote URL, dotden verifies that the
 * user's normal git credentials can reach it with `git ls-remote`, then runs
 * `chezmoi init <url>` to clone/initialize the Den. The same git command and
 * process environment are used for preflight and init so SSH agents, Git
 * Credential Manager, 1Password SSH agent, Keychain, WSL bridges, and askpass
 * hooks keep working exactly as they do for the user's CLI.
 */
import { access, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CommandAbortedError,
  CommandFailedError,
  runCommand,
  type CommandResult,
} from '../platform/process.js'
import type { TraceEnvelope, PreflightResult, ConnectResult } from '../../../shared/remote.js'
import type { RemoteDiagnostics } from '../../../shared/remote.js'
import type { DiagnosticsSink } from '../diagnostics/command-log.js'

/**
 * Construction options for {@link RemoteClient}.
 *
 * The binary paths come from bundled-tool resolution in production. Tests may
 * inject {@link run} to assert the exact CLI calls without touching real Remotes
 * or credentials.
 */
export interface RemoteClientOptions {
  /** Path to the bundled chezmoi binary used for `execute-template` and `init`. */
  readonly chezmoiBin: string
  /** Fallback path to the bundled git binary when chezmoi has no configured `git.command`. */
  readonly gitBin: string
  /** Local chezmoi source-state directory where the Den is cloned/initialized. */
  readonly sourceDir: string
  /** Destination/home directory passed to chezmoi for credential-identical initialization. */
  readonly destinationDir: string
  /** Maximum time a credential preflight/init process may run before being killed. */
  readonly timeoutMs?: number
  /** Test seam for the low-level child-process runner; production uses {@link runCommand}. */
  readonly run?: typeof runCommand
  /** Optional redacted command diagnostics sink. */
  readonly diagnosticsSink?: DiagnosticsSink
}

/**
 * Thrown by {@link RemoteClient.connectExistingRemote} when preflight fails.
 *
 * Preflight itself returns an inline result for UI state machines; connect uses
 * an exception because callers asked for a committed side effect (`chezmoi init`)
 * and no partial connection should be represented as success.
 */
export class RemotePreflightError extends Error {
  /** Sanitized diagnostics suitable for UI display and local logs. */
  constructor(readonly diagnostics: RemoteDiagnostics) {
    super(diagnostics.help)
  }
}

/**
 * Thrown by {@link RemoteClient.connectExistingRemote} when `chezmoi init <url>` fails.
 *
 * Distinct from {@link RemotePreflightError}: preflight already passed (the
 * credentials reached the Remote), but the clone/initialize step itself errored.
 * Crucially, this carries the SAME sanitized {@link RemoteDiagnostics} shape as
 * preflight rather than the raw `CommandFailedError`. That raw message is
 * `<cmd> <args> exited <code>: <stderr>` — and because the pasted Remote URL is a
 * positional arg of `chezmoi init`, that message would leak the FULL URL (and any
 * unredacted token in stderr) verbatim across IPC into the UI. `super(diagnostics.help)`
 * makes `.message` the host/scheme-only, URL-free, sanitized help text instead.
 */
export class RemoteConnectError extends Error {
  /** Sanitized diagnostics suitable for UI display and local logs; never contains the raw URL. */
  constructor(readonly diagnostics: RemoteDiagnostics) {
    super(diagnostics.help)
  }
}

/**
 * Thrown by {@link RemoteClient.latestRemoteSha} when the background SHA read fails.
 *
 * The tray poller reads a STORED Remote URL every tick, so a raw `CommandFailedError` here would
 * (a) embed the full URL in `.message` (`git ls-remote <url> ... exited 128: <stderr>`) and dump
 * it into logs, and (b) lose the credential hint the interactive path already gives. This carries
 * the SAME sanitized, URL-free {@link RemoteDiagnostics} as preflight — including the
 * "Repository not found may mean no access" hint — so the poller can log a concise, actionable
 * line instead of a stack dump. `super(diagnostics.help)` makes `.message` the host-only help text.
 */
export class RemotePollError extends Error {
  /** Sanitized diagnostics suitable for log display; never contains the raw URL. */
  constructor(readonly diagnostics: RemoteDiagnostics) {
    super(diagnostics.help)
  }
}

/**
 * Provider-agnostic Remote connector for dotden's V1-Lean auth model.
 *
 * Public methods map directly to the underlying git/chezmoi primitives:
 * - {@link preflightRemote} → `<git.command> ls-remote <url>`
 * - {@link connectExistingRemote} → successful preflight, then `chezmoi init <url>`
 * - {@link latestRemoteSha} → `<git.command> ls-remote <url> refs/heads/<branch>`
 *
 * The class never writes credentials, never talks to a Provider API, and never
 * overrides the user's credential environment.
 *
 * Safety valve: every operation passes both a timeout and optional AbortSignal to
 * {@link runCommand}. The renderer cannot send an AbortSignal through structured-clone IPC, so
 * `ipc-bridge.ts` owns the trace-id keyed AbortController registry and passes the signal here.
 */
export class RemoteClient {
  private readonly run: typeof runCommand
  private readonly timeoutMs: number

  /**
   * Create a RemoteClient bound to one environment's source/destination dirs.
   *
   * @param options Binary paths, chezmoi dirs, timeout, and optional test process runner.
   */
  constructor(private readonly options: RemoteClientOptions) {
    this.run = options.run ?? runCommand
    this.timeoutMs = options.timeoutMs ?? 30_000
  }

  /**
   * Verify that a pasted Remote URL is reachable with the user's existing git credentials.
   *
   * Maps to `<git.command> ls-remote <url>`, where `git.command` is resolved via
   * chezmoi first and falls back to dotden's bundled git. The process inherits
   * the parent environment unchanged: no `GIT_SSH_COMMAND`, `SSH_AUTH_SOCK`,
   * `HOME`, credential-helper, or askpass overrides are injected.
   *
   * @param url HTTPS, SSH, scp-like, or file Remote URL supplied by the user.
   * @param request IPC trace envelope, plus an optional `signal` that is a
   *   test/future seam (not plumbed through IPC; timeout is the wired guarantee).
   * @returns Reachability plus either the git command used or sanitized diagnostics.
   */
  async preflightRemote(
    url: string,
    request: { readonly _trace: TraceEnvelope; readonly signal?: AbortSignal },
  ): Promise<PreflightResult> {
    // Defense in depth: reject empty/leading-dash URLs BEFORE spawning git, so git can never
    // reinterpret the user URL as an option flag (see {@link isPlausibleRemoteUrl}).
    if (!isPlausibleRemoteUrl(url)) {
      return {
        reachable: false,
        gitCommand: this.options.gitBin,
        diagnostics: {
          ...parseRemoteLocation(url),
          stderr: '',
          help: 'That does not look like a valid git Remote URL — paste an HTTPS or SSH URL.',
        },
      }
    }
    const gitCommand = await this.effectiveGitCommand(request.signal)
    try {
      // `--end-of-options` belt-and-suspenders: even with the validator above, this forces git to
      // treat the URL positional as data, never as a flag, for any future URL shape.
      await this.runGit(gitCommand, ['ls-remote', '--end-of-options', url], request.signal)
      return { reachable: true, gitCommand }
    } catch (error) {
      const diagnostics = diagnosticsFromError(url, error)
      return { reachable: false, gitCommand, diagnostics }
    }
  }

  /**
   * Initialize the local Den from an existing, user-owned Remote.
   *
   * Maps to `chezmoi init <url>` after {@link preflightRemote} succeeds. The
   * source and destination dirs are passed explicitly so the initialized Den is
   * isolated to dotden's environment-local source state while applying against
   * the real home/destination dir.
   *
   * @param url Remote URL already checked or about to be checked by preflight.
   * @param request IPC trace envelope, plus an optional `signal` that is a
   *   test/future seam (not plumbed through IPC; timeout is the wired guarantee).
   * @returns The initialized source-state dir and git command that passed preflight.
   * @throws RemotePreflightError when credentials/reachability fail before init.
   * @throws RemoteConnectError when `chezmoi init` itself fails; the message and
   *   diagnostics are sanitized and URL-free, mirroring the preflight failure path.
   */
  async connectExistingRemote(
    url: string,
    request: { readonly _trace: TraceEnvelope; readonly signal?: AbortSignal },
  ): Promise<ConnectResult> {
    const preflight = await this.preflightRemote(url, request)
    if (!preflight.reachable) {
      if (!preflight.diagnostics) throw new Error('Remote preflight failed without diagnostics')
      throw new RemotePreflightError(preflight.diagnostics)
    }

    await resetSourceDir(this.options.sourceDir)
    await mkdir(this.options.destinationDir, { recursive: true })
    try {
      await this.run(
        this.options.chezmoiBin,
        [
          // Pin chezmoi's two trees: source state is the local Den clone, destination is the real home.
          '--source',
          this.options.sourceDir,
          '--destination',
          this.options.destinationDir,
          // No TTY and force keep the init path non-interactive; credential prompts still belong to git.
          '--no-tty',
          '--force',
          'init',
          url,
        ],
        {
          timeoutMs: this.timeoutMs,
          signal: request.signal,
          ...(this.options.diagnosticsSink
            ? { diagnosticsSink: this.options.diagnosticsSink }
            : {}),
        },
      )
    } catch (error) {
      await resetSourceDir(this.options.sourceDir)
      // `chezmoi init` puts the URL in argv, so the raw CommandFailedError.message embeds the full
      // URL (and any token in stderr). Route through the same sanitizer the preflight path uses so the
      // surfaced error is host/scheme-only with redacted stderr — never the raw URL/token — across IPC.
      throw new RemoteConnectError(diagnosticsFromError(url, error, 'init'))
    }
    const repositoryKind = await classifyInitializedSource(this.options.sourceDir)
    if (repositoryKind === 'foreign-chezmoi') await resetSourceDir(this.options.sourceDir)
    return {
      gitCommand: preflight.gitCommand,
      sourceDir: this.options.sourceDir,
      repositoryKind,
    }
  }

  /**
   * Read the latest commit SHA advertised by a Remote branch without fetching.
   *
   * Maps to `<git.command> ls-remote <url> refs/heads/<branch>`. This is the
   * cheap Provider-agnostic primitive the tray poller will use to decide whether
   * a fetch is worth doing; it never calls GitHub/GitLab/etc. APIs and never
   * clones the Remote.
   *
   * @param url Remote URL to inspect.
   * @param branch Branch name to inspect, defaulting to `main`.
   * @param request IPC trace envelope, plus an optional `signal` that is a
   *   test/future seam (not plumbed through IPC; timeout is the wired guarantee).
   * @returns The full 40-character SHA, or null if the branch has no advertised ref.
   * @throws Error('Invalid Remote URL') when `url` fails the plausibility guard.
   */
  async latestRemoteSha(
    url: string,
    branch = 'main',
    request: { readonly _trace: TraceEnvelope; readonly signal?: AbortSignal },
  ): Promise<string | null> {
    // The poller passes a stored URL, but defense in depth: a leading-dash URL with two positionals
    // can smuggle `--upload-pack=<local-script>` and execute code on the local/file transport.
    if (!isPlausibleRemoteUrl(url)) throw new Error('Invalid Remote URL')
    const gitCommand = await this.effectiveGitCommand(request.signal)
    let result: CommandResult
    try {
      result = await this.runGit(
        gitCommand,
        ['ls-remote', '--end-of-options', url, `refs/heads/${branch}`],
        request.signal,
      )
    } catch (error) {
      // The poller passes a stored URL, so a raw CommandFailedError would leak that URL into logs
      // and drop the credential hint. Route through the shared sanitizer so the surfaced error is
      // host/scheme-only and carries the "Repository not found may mean no access" guidance.
      throw new RemotePollError(diagnosticsFromError(url, error))
    }
    const [sha] = result.stdout.trim().split(/\s+/)
    return isFullSha(sha) ? sha : null
  }

  /**
   * Resolve chezmoi's effective git command, falling back to dotden's bundled git.
   *
   * Maps to `chezmoi execute-template '{{ .chezmoi.config.git.command }}'`.
   * If the user has configured chezmoi to use a custom git wrapper, preflight
   * uses that exact command so credential identity matches `chezmoi init`.
   */
  private async effectiveGitCommand(signal?: AbortSignal): Promise<string> {
    try {
      const result = await this.run(
        this.options.chezmoiBin,
        ['--no-tty', 'execute-template', '{{ .chezmoi.config.git.command }}'],
        {
          timeoutMs: this.timeoutMs,
          signal,
          ...(this.options.diagnosticsSink
            ? { diagnosticsSink: this.options.diagnosticsSink }
            : {}),
        },
      )
      const configured = result.stdout.trim()
      if (configured && configured !== '<no value>') return configured
    } catch {
      // A missing host chezmoi config is not fatal; the bundled git binary is dotden's v1 floor.
    }
    return this.options.gitBin
  }

  /** Run the resolved git command with timeout/cancel but without environment overrides. */
  private runGit(
    command: string,
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    // Intentionally omit `env`: runCommand will inherit process.env unchanged, preserving credential hooks.
    return this.run(command, args, {
      timeoutMs: this.timeoutMs,
      signal,
      ...(this.options.diagnosticsSink ? { diagnosticsSink: this.options.diagnosticsSink } : {}),
    })
  }
}

/**
 * Classify the just-initialized source dir for ADR 0022's post-clone branch.
 *
 * This intentionally checks for dotden's synced `.dotden/` first: a dotden Den can still contain
 * normal chezmoi source files, but `.dotden/` is the v1 proof that this repo is ours.
 */
async function classifyInitializedSource(
  sourceDir: string,
): Promise<ConnectResult['repositoryKind']> {
  if (await exists(join(sourceDir, '.dotden'))) return 'dotden'

  const entries = await readdir(sourceDir, { withFileTypes: true })
  const visible = entries.filter((entry) => entry.name !== '.git')

  if (visible.some((entry) => isForeignChezmoiEntry(entry.name))) {
    return 'foreign-chezmoi'
  }

  return 'greenfield'
}

/** True when the source entry is a chezmoi feature dotden v1 does not adopt. */
function isForeignChezmoiEntry(name: string): boolean {
  return (
    name === '.chezmoiroot' ||
    name === '.chezmoiexternal' ||
    name.startsWith('dot_') ||
    name.startsWith('run_') ||
    name.endsWith('.tmpl') ||
    name.includes('.age')
  )
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function resetSourceDir(sourceDir: string): Promise<void> {
  await rm(sourceDir, { recursive: true, force: true })
  await mkdir(sourceDir, { recursive: true })
}

/**
 * Convert process failures into safe, Provider-agnostic UI diagnostics.
 *
 * Shared by both the `git ls-remote` preflight path and the `chezmoi init` connect path so the
 * URL/token redaction is symmetric: whatever step failed, the surfaced diagnostics carry only
 * host/scheme + sanitized stderr, never the raw URL. `stage` only tunes the help wording.
 *
 * @param url The pasted Remote URL (used solely to derive host/scheme; never surfaced raw).
 * @param error The thrown {@link CommandFailedError}/{@link CommandAbortedError} or other value.
 * @param stage `'preflight'` (the credential check) or `'init'` (the clone/initialize step).
 */
function diagnosticsFromError(
  url: string,
  error: unknown,
  stage: 'preflight' | 'init' = 'preflight',
): RemoteDiagnostics {
  const location = parseRemoteLocation(url)
  const help = stage === 'init' ? initHelp(location.host) : credentialHelp(location.host)
  if (error instanceof CommandFailedError) {
    return {
      ...location,
      exitCode: error.result.exitCode,
      stderr: sanitizeStderr(error.result.stderr),
      help,
    }
  }
  if (error instanceof CommandAbortedError) {
    return {
      ...location,
      exitCode: error.result.exitCode,
      stderr: sanitizeStderr(error.result.stderr),
      help:
        stage === 'init'
          ? `Timed out while initializing from ${location.host}. Check your connection and git credentials for ${location.host}, then try again.`
          : `Timed out while checking ${location.host}. Set up your git credentials (SSH key or token) for ${location.host}, then try again.`,
    }
  }
  return { ...location, stderr: '', help }
}

/** Build the V1-Lean auth failure copy: guide the user; never ask for/stash a token. */
function credentialHelp(host: string): string {
  return `Set up your git credentials (SSH key or token) for ${host}, then try again. If this is a private repo and the Provider says “Repository not found”, your credentials may not have access.`
}

/**
 * Failure copy for the `chezmoi init` step (preflight already passed).
 *
 * Distinct wording from {@link credentialHelp}: reachability was already proven, so the likely
 * causes shift to a chezmoi/clone-level problem rather than missing credentials. Still
 * host/scheme-only and URL-free.
 */
function initHelp(host: string): string {
  return `Couldn’t initialize your Den from ${host}. The Remote was reachable but the clone/initialize step failed — check that the repository is a valid chezmoi/dotfiles source, then try again.`
}

/**
 * Parse Provider host and scheme from both URL-form and scp-like git Remotes.
 *
 * Supports `https://github.com/org/repo.git`, `ssh://git@example/repo.git`, and
 * scp-like `git@github.com:org/repo.git`. If parsing fails, diagnostics still
 * return a generic host so UI copy remains actionable.
 *
 * Exported so the Account tab's data seam ({@link import('../den-service/den-service.js').DenService.connectedRemote})
 * can derive the SAME host/scheme the preflight diagnostics use, keeping "what Provider is this"
 * consistent between the connected-Remote display and a credential-failure message (issue 2-11).
 */
export function parseRemoteLocation(remoteUrl: string): {
  readonly host: string
  readonly scheme: string
} {
  try {
    const parsed = new URL(remoteUrl)
    return { host: parsed.hostname, scheme: parsed.protocol.replace(':', '') }
  } catch {
    const scpLike = /^(?:[^@]+@)?([^:]+):/.exec(remoteUrl)
    return { host: scpLike?.[1] ?? 'this Remote', scheme: remoteUrl.includes(':') ? 'ssh' : 'file' }
  }
}

/**
 * Redact obvious credential material from stderr before it crosses into UI/logs.
 *
 * This is intentionally conservative/best-effort and paired with a length cap. It is NOT a
 * secret-scanner replacement; it covers the common auth-token-in-error cases across the
 * Providers dotden has shipped against since v1 while preserving enough context for
 * support/debugging. Covered shapes:
 * - scheme-agnostic basic-auth in any URL (`http(s)://user:pass@`, `ssh://`, …) — the old
 *   rule hardcoded `https://`, so `http://user:pass@` slipped straight through;
 * - `x-access-token:<tok>@` (GitHub App / Actions ephemeral token form);
 * - GitHub (`ghp_/gho_/ghu_/ghs_/ghr_…`, `github_pat_…`) and GitLab (`glpat-…`, `glptt-…`)
 *   token shapes;
 * - `Authorization: Bearer|Basic <token>` headers echoed into curl/transport errors.
 */
function sanitizeStderr(stderr: string): string {
  return (
    stderr
      // Scheme-agnostic basic-auth credentials in any URL; keep the scheme, drop user:pass.
      .replaceAll(/([a-z][a-z0-9+.-]*):\/\/[^\s:@/]+:[^\s@/]+@/gi, '$1://<redacted>@')
      // GitHub App / Actions ephemeral token embedded as the username component.
      .replaceAll(/x-access-token:[^\s@/]+@/gi, 'x-access-token:<redacted>@')
      // Provider token shapes: GitHub PATs/OAuth tokens and GitLab personal/trigger tokens.
      .replaceAll(/gh[pousr]_[A-Za-z0-9_]+/g, '<redacted-token>')
      .replaceAll(/github_pat_[\w]+/g, '<redacted-token>')
      .replaceAll(/glpat-[\w-]+/g, '<redacted-token>')
      .replaceAll(/glptt-[\w-]+/g, '<redacted-token>')
      // Authorization headers leaked into transport/curl errors; keep the scheme word.
      .replaceAll(/Authorization:\s*(Bearer|Basic)\s+\S+/gi, 'Authorization: $1 <redacted>')
      .slice(0, 2_000)
  )
}

/** True when `git ls-remote` returned a full object id rather than empty/malformed output. */
function isFullSha(value: string | undefined): value is string {
  return /^[0-9a-f]{40}$/i.test(value ?? '')
}

/**
 * Cheap argv-injection guard for a user-supplied Remote URL.
 *
 * `runCommand` uses `shell:false`, which stops SHELL injection — but NOT git's own option
 * parser. A URL passed as a leading positional to `git ls-remote <url>` / `chezmoi init <url>`
 * is parsed as a flag when it starts with `-`; with two positionals (`ls-remote <url> <ref>`)
 * a `--upload-pack=<local-script>` URL executes code on the local/file transport. This guard
 * rejects exactly the dangerous shapes — empty/blank or leading-dash — and nothing else.
 *
 * It is deliberately PERMISSIVE everywhere else: scp-like (`git@github.com:owner/repo.git`),
 * https/ssh, and bare local paths must all pass, since v1 supports any URL the user's git
 * already reaches. The `--end-of-options` sentinel on the `ls-remote` calls is the belt to this
 * suspenders; `chezmoi init` (which may not forward the sentinel) relies on this guard alone.
 *
 * @param url The pasted Remote URL.
 * @returns false only when `url` is empty/blank or its trimmed form starts with `-`.
 */
export function isPlausibleRemoteUrl(url: string): boolean {
  const trimmed = url.trim()
  return trimmed.length > 0 && !trimmed.startsWith('-')
}
