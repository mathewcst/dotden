/**
 * Offline detection — classify a failed transport (`git push`/`git fetch`) as a
 * **network-offline** failure vs a genuine, non-network failure (issue 1-16).
 *
 * This is the load-bearing decision behind dotden's offline behavior (ADR 0006): a
 * Commit is a LOCAL operation that must succeed with no network, and a push that cannot
 * reach the Remote because the machine is **offline** is **queued + retried**, never
 * surfaced as a hard error that loses the user's recorded work. The opposite — a push
 * that reached the Remote and was **rejected** (non-fast-forward, auth denied, no such
 * repo) — is a real failure the user must act on, and must NOT be silently swallowed as
 * "we'll retry when you reconnect" (that would hide a problem the retry can never fix).
 *
 * So the queue's retry-on-reconnect contract hinges on telling these two apart. We key
 * off git's own transport-layer diagnostics rather than guessing:
 *
 * - a **spawn-level** error (the git binary could not even be launched) is NOT offline —
 *   it is a wiring failure (`isOfflineError` only ever inspects git's own output);
 * - git's HTTP/SSH transports emit a stable family of "could not reach the server"
 *   messages when the network is down (`Could not resolve host`, `Failed to connect`,
 *   `Couldn't connect to server`, `unable to access … Connection timed out`, SSH's
 *   `Could not read from remote repository` paired with a connection error, …). These
 *   are the offline signature.
 *
 * Anything else (a `! [rejected]` non-fast-forward, `Authentication failed`, `Repository
 * not found`) is a server-reached rejection and is left to surface (never fail silently).
 *
 * It is pure + Electron-free (ADR 0023): it inspects only the captured stderr of a
 * {@link CommandFailedError}, so the whole classification is unit-testable in plain Node.
 */
import { CommandAbortedError, CommandFailedError } from './process.js'

/**
 * Stderr fragments git's transports print when the **network is unreachable** — i.e. the
 * push/fetch never reached the Remote at all. Matched case-insensitively against the
 * failed command's stderr. Kept deliberately to the connection-establishment family so a
 * server-reached rejection (auth denied, non-fast-forward, missing repo) does NOT match.
 *
 * Sourced from git's real output across DNS failure, refused/timed-out TCP connect, and
 * the SSH transport's reset — verified against the bundled git in this repo:
 * - `Could not resolve host: <host>`            — DNS lookup failed (classic offline).
 * - `Failed to connect to <host> port <n>`      — TCP connect failed/timed out.
 * - `Couldn't connect to server`                — libcurl could not reach the server.
 * - `Connection timed out` / `Connection refused`/`reset by peer` — transient network.
 * - `Network is unreachable` / `Temporary failure in name resolution` — OS-level offline.
 * - `unable to access` is git's HTTP-transport prefix for the above; on its own it is a
 *   weak signal, so it only counts toward offline alongside one of the connection phrases.
 */
const OFFLINE_STDERR_PATTERNS: readonly RegExp[] = [
  /could not resolve host/i,
  /failed to connect to .+ port/i,
  /couldn't connect to server/i,
  /connection timed out/i,
  /connection refused/i,
  /connection reset/i,
  /network is unreachable/i,
  /temporary failure in name resolution/i,
  /name or service not known/i,
  /no route to host/i,
  /ssh: connect to host .+ port .+: (connection|operation|network)/i,
]

/**
 * Whether `error` is a **network-offline** transport failure (queue + retry), as opposed
 * to a server-reached rejection (surface) or a non-transport error (rethrow).
 *
 * Used by {@link import('./den-service.js').DenService} to decide whether a failed
 * `git push` should be **queued** (offline → retry on reconnect/next Sync) or surfaced as
 * a hard error. Only a {@link CommandFailedError} whose captured stderr matches the
 * offline family counts; a {@link CommandAbortedError} (timeout/cancel) is explicitly NOT
 * offline (a hung credential prompt is not "no network"), and a raw spawn error (missing
 * git binary) is NOT offline either — both must surface as their real cause.
 *
 * @param error The thrown error from a transport call (push/fetch).
 * @returns `true` only when git's own stderr says it could not reach the Remote.
 */
export function isOfflineError(error: unknown): boolean {
  // A caller-driven abort (timeout / cancel) is a different failure mode than "offline":
  // the network may be fine and a credential prompt simply hung. Never treat it as offline.
  if (error instanceof CommandAbortedError) return false
  // Only git's own non-zero-exit output is evidence of offline-ness. A spawn-level Node
  // error (ENOENT for a missing binary) is a wiring bug, not a network outage.
  if (!(error instanceof CommandFailedError)) return false
  const stderr = error.result.stderr
  return OFFLINE_STDERR_PATTERNS.some((pattern) => pattern.test(stderr))
}
