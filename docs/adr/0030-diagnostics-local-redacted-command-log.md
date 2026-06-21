# 0030 — Diagnostics: a local, redacted command log for self-service debugging

> Status: accepted. Complements [ADR 0007](./0007-observability-wide-events-local-traces.md) (scrubbed wide events) as its deliberate counterpart, and lives within the layering of [ADR 0023](./0023-main-process-layering-electron-free-foundation.md) (Electron-free foundation). Introduces the **Diagnostics**, **Command record**, **Command log**, and **Console** terms in `CONTEXT.md`.

**Context:** dotden wraps CLIs (`chezmoi`, `git`, `gh`) on machines we neither own nor can see. When something goes wrong — `gh` authenticated as the wrong account, a `chezmoi` error, a failed push — the only thing that explains it is the **actual message** the tool printed. ADR 0007's wide events are **scrubbed by construction** (allowlisted counts/enums; paths, URLs, hostnames not representable) — exactly right for telemetry, and **useless for this**. The raw output _is_ captured today inside a thrown `CommandFailedError` at the `process.ts` seam, but it is **ephemeral** — nothing persists it, so neither the user nor a bug report can ever see it.

**Decision:** Add a user-facing **Diagnostics** capability backed by a **Command log** — a bounded, on-disk, environment-local ring buffer of **Command records** (`{ command, args, exitCode, redacted stdout/stderr, traceId, timestamp }`), one per CLI invocation, correlated to its Operation trace and wide event by the existing `traceId`. This is a **second, deliberate stream** alongside ADR 0007's scrubbed events, not a loosening of them.

Surfaced as three layered surfaces over one buffer (the prevailing pattern across GitHub Desktop / Sourcetree / GitKraken — none of which lead with an always-on console):

- **Details** _(everyday, ungated)_ — an on-error "View details" disclosure showing the Command records for the failed Operation (filtered by `traceId`). This is the load-bearing surface and embodies _never fail silently — surface what happened and the fix_.
- **Copy diagnostics** _(everyday)_ — a redacted export bundle (app version, OS, recent records) for filing a bug report.
- **Console** _(opt-in)_ — a live tail of the Command log, enabled by a Settings toggle, shown as a tab in the global bottom panel. The Console **tails completed Command records, not raw byte streams**, so a secret can never straddle a chunk boundary.

**Placement (within ADR 0023):** capture + redaction are **pure-domain in `foundation/`**, beside `OperationTracer` and reusing `SecretScanner`, written to through **one coarse diagnostics-sink port**. Only IPC surfacing and file/`shell`/`createIssue` glue live at the Electron edge. We **do not adopt `electron-log`** — it is an `import 'electron'` dependency that would violate the foundation boundary, and the existing ring-buffer pattern already covers the need.

**Redaction is at write, structure-preserving:** secrets are masked **before any byte reaches the buffer or disk**, keeping diagnostic structure: `scheme://user:[REDACTED]@host`, `op://` references kept visible with the resolved value masked, known token shapes (`ghp_…`, `Bearer …`, `Authorization:`), `$HOME`/username → `~`. Applied to `args` too. Because an **arbitrary resolved password-manager value has no pattern** to match, the guarantee does **not** rest on detection: the Command log captures the **envelope + `stderr`** reliably, and **omits `stdout` content for templated/secret-bearing commands** (`chezmoi diff`/`apply` render secrets in full) — replaced with `[rendered output omitted]`. The surface where un-patternable secrets live is therefore never captured. An **opt-in, explicitly-warned, session-scoped unredacted mode** exists as the fidelity escape hatch; it is never the default and is never persisted. **Copy diagnostics always redacts**, regardless of that toggle — the support handoff is the single highest-probability leak route.

**Why:** the user controls the failing system, not us; self-service debugging and good bug reports require the real text. Redacting only at export would protect almost none of the real threat surface — for a local-first app the log leaves the trust boundary mainly by routes we don't mediate (infostealer malware scraping `userData`, cloud-sync/backup of the folder, users emailing the whole directory to support), which is why OWASP draws no local-vs-shared exception and mature tools redact before write.

**What we explicitly reject (and why):**

- **`electron-log` / winston / pino in the foundation** — violates ADR 0023; confined-to-edge buys little over the existing pure ring buffer (ADR 0028 package-aversion).
- **Raw-at-rest, redact-on-export** — defeated by the threat model above (infostealers, sync, naive folder-sharing all bypass an export-time gate).
- **The renderer (Zustand) as the diagnostic sink** — the raw output is born in the trusted main core; continuously streaming it into the less-trusted Chromium context inverts ADR 0007's posture. The renderer keeps only correlated **breadcrumbs** (action name + `traceId` + a redacted shallow diff, no raw output) via a small custom middleware — a fast-follow.
- **A byte-stream live console** — chunk-boundary redaction hazard; per-completed-record granularity is "live enough" for short-lived CLIs.
- **Leading with the Console** — the field evidence (GitHub Desktop _rejected_ an always-on git-call console) and our own ethos put the on-error Details and the export first; the Console is the opt-in garnish.

**Consequences:**

- New **environment-local, never-synced** state: the Command log ring buffer (redacted at rest) and the session-scoped unredacted-mode flag.
- ADR 0007's structural privacy invariant is **untouched** — wide events still cannot represent raw strings. The Command log is the explicit, separately-governed exception, safe by redact-at-write + structural omission + redact-again-at-export, local-only with export as its only (double-scrubbed) egress.
- The center bottom region **graduates from a History-only diff preview into a persistent, global, VSCode-style tabbed panel** (a real shell change). The Console is one tab; the panel is reserved for future tabs.
- **"View details" is ungated** by the Console toggle — the toggle governs only the Console's standing presence; an error can always summon the panel filtered to its `traceId`. A status-bar affordance/badge is the VSCode-native discoverability path.
- Pixel-level design (Figma + a `design-system/` screen spec) is a separate pass; this ADR fixes only the architecture and where the surfaces hang.
