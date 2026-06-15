# 0007 — Observability: wide canonical events + local span traces, two egress paths

> Status: accepted. Builds on [ADR 0001](./0001-pure-git-github-no-backend.md) (no backend) and the privacy/telemetry stance in `CONTEXT.md`.

**Decision:** dotden's observability model is **one wide, canonical structured event per operation** (a Commit, Sync now, Apply, onboarding step, or poll), not many scattered log lines. From distributed tracing we borrow **only** the span-tree and a `trace_id` that propagates across **two** boundaries — renderer↔main (the `IpcBridge` envelope) and Electron→relay (a `traceparent`-shaped HTTP header). A trace is a **local correlation construct by default**; it becomes an **egress** construct only on the two opt-in paths (Sentry crash reporting, and the scrubbed-log attachment in feedback).

Three modules own this, matching the pure-core/effectful-shell split:

- **`OperationTracer`** _(pure-domain, zero I/O)_ — starts a root trace per operation, opens/closes child spans, accumulates the single wide event (outcome, per-span timings, typed error chain, allowlisted counters), and decides sampling disposition at `span.end` once the outcome is known (a true tail decision). Produces an immutable value; holds no transport.
- **`TelemetrySink`** _(effectful adapter)_ — receives finished wide events and fans out to **local** destinations: always appends to a bounded ring buffer; forwards error events to Sentry **only if opted in**; maps a small allowlisted subset to Umami **only if opted in**. `write()` never throws and never blocks the operation.
- **`TraceContextCodec`** _(pure)_ — the single definition of the trace-context wire shape, serialized onto the IPC envelope (`_trace`) and the relay header so renderer and main can't drift.

**Why:** The "logging sucks" wide-event model turns debugging from text archaeology into structured queries, and a request that fans through `IpcBridge` → `SyncEngine` → `ChezmoiAdapter`/`GitTransport`/`RemoteClient` is a real causal chain worth correlating as spans. But dotden is a single-user, mostly-offline desktop app with **no server**: full distributed tracing is the wrong size.

**What we explicitly reject (and why):** an OTLP collector, a Jaeger/Tempo tracing backend, W3C trace-header fan-out to N services, and distributed clock-skew reconciliation — there is nothing on the other end to receive any of it (ADR 0001). Importing that machinery would be ceremony with no payoff.

**Privacy is structural, not hoped-for:** the wide event carries only an **allowlisted attribute-key type** (counts and enums like `fileCount`, `outcome`, `errorClass`, `chezmoiExitCode`, `durationMs`, `automationLevel`). Paths, file contents, secrets, `op://` references, repo URLs, and hostnames are **not representable by construction** — the same discipline as `CommitMessageRenderer`'s no-shell-reachable rule. Because `OperationTracer` is pure with zero I/O, **nothing reaches the network except through `TelemetrySink`'s consent gate**, which is off by default.

**Consequences:**

- The bounded local ring buffer is the **only always-on observability sink**, and it _is_ the source of the scrubbed-log attachment already described in the feedback flow.
- **Tail sampling** (keep 100% of errors + slow ops, sample fast successes at 1–5%) governs **ring-buffer size**, not a cloud bill, and guarantees a failing trace is present when a user files feedback.
- `FeedbackTelemetryRelay` **consumes** observability (it ships the opt-in subset); it does not generate it.
- For id generation: ride the Sentry SDK where Sentry is active; use a minimal local id source where it is off (ids only need to correlate lines within one local ring buffer).
- Environment-local, never-synced state gains: the observability ring buffer + telemetry sampling-disposition state.
