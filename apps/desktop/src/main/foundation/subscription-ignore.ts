/**
 * subscription-ignore — the per-environment **Workspace-subscription** `.chezmoiignore`
 * template (issue 1-13, ADR 0005 / ADR 0024).
 *
 * A second environment subscribes to a SUBSET of the Den's Workspaces, so it must apply
 * only the Files inside those Workspaces. This is the realized access boundary (ADR 0005):
 * un-subscribed Workspaces' Files are listed in `.chezmoiignore`, so `chezmoi apply` skips
 * them on this environment — while ONE repo still carries every Workspace's Files.
 *
 * The seam beyond issue 1-01/1-15 (which only built the static `.dotden/` + OS-scope rules)
 * is that subscription is decided **at apply time by chezmoi's template engine**, not baked
 * in by the main process. chezmoi interprets `.chezmoiignore` as a Go template, so the file
 * can `include` the synced `.dotden/` JSON and `self-identify` via `[data].dotden_env_id`
 * (mirrored into the environment-local chezmoi config, issue 1-05). Flipping `dotden_env_id`
 * flips which Files are managed from the *same* repo — exactly what the subscription spike
 * proved (`.scratch/poc-subscription-chezmoiignore`).
 *
 * This module is the SINGLE source of the `.chezmoiignore` body: it folds together all three
 * concerns so they can never drift or clobber each other —
 * 1. the `.dotden/` rule (dotden metadata is never a managed target, ADR 0024);
 * 2. the static **OS-scope** scoped-out paths for THIS environment's OS (issue 1-15), which
 *    the main process computes per-env (chezmoi can't know the inheritance fold); and
 * 3. the dynamic **subscription** template block (this file), evaluated by chezmoi at apply.
 *
 * It is pure + Electron-free (ADR 0023): a string renderer over data, exhaustively unit-testable.
 */

/**
 * The **registry-entry guard** the spike surfaced (issue 1-13 acceptance criteria).
 *
 * Between clone and claim, a brand-new environment has **no entry** in the synced registry
 * yet, so `index registry dotden_env_id` would yield no `subscribedWorkspaces` and
 * `chezmoi apply` would error on the template. The guard is two-layered:
 *
 * - **(a) ordering is primary** — registration/claim writes this env's entry (default: all
 *   Workspaces) BEFORE any apply, so the normal flow never reaches the gap. Owned by the
 *   DenService/registry, not this template.
 * - **(b) the template fallback is fail-safe** — a missing entry (or empty subscription) is
 *   NOT an error and NOT apply-all: it degrades to **ignore-everything** (apply nothing). The
 *   template below writes a literal `*` so chezmoi ignores the entire tree rather than
 *   crashing or applying every Workspace.
 *
 * Crucially this is never silent: the *empty-Den* symptom an unregistered env would show is
 * surfaced by the DenService (`subscriptionState`) with the reason + the fix ("this
 * environment isn't registered yet"), so dotden never renders a confusing empty Den quietly.
 */

/** Marker emitted by the template when the env is unregistered/empty-subscription (the fail-safe `*`). */
export const IGNORE_EVERYTHING_RULE = '*'

/** The relative path of dotden's chezmoi-ignored synced-metadata directory (ADR 0024). */
export const DEN_IGNORE_RULE = '.dotden/'

/** Synced registry + Workspace placement file paths, as chezmoi `include`s them (source-relative). */
const REGISTRY_INCLUDE = '.dotden/environments.json'
const PLACEMENTS_INCLUDE = '.dotden/workspaces.json'

/**
 * Input to {@link renderSubscriptionIgnore}: the per-OS scoped-out paths the MAIN process
 * already computed (issue 1-15), which this renderer pastes in as static lines alongside the
 * dynamic subscription block.
 *
 * The subscription block needs no input here — it reads the synced `.dotden/` + `dotden_env_id`
 * at apply time, inside chezmoi — which is the whole point (one repo, per-env subscription).
 */
export interface SubscriptionIgnoreInput {
  /**
   * Destination-relative paths whose effective OS Scope excludes THIS environment's OS
   * (issue 1-15), pre-computed by the caller. Emitted verbatim as static ignore lines so the
   * OS-scope and subscription concerns share one generated file without clobbering each other.
   */
  readonly osScopedOutPaths: readonly string[]
}

/**
 * Render the FULL `.chezmoiignore` body — the single generated file for `.dotden/` + OS scope
 * + per-environment Workspace subscription (issue 1-13).
 *
 * The output is a chezmoi Go-template. Its static prefix carries the header, the `.dotden/`
 * rule, and the OS-scoped-out paths; its template suffix self-identifies via
 * `{{ .dotden_env_id }}`, joins it against the synced registry, and ignores every File whose
 * Workspace this environment does NOT subscribe to. The registry-entry guard degrades a
 * missing/empty subscription to **ignore-everything** (a literal `*`), never an error and
 * never apply-all (see {@link IGNORE_EVERYTHING_RULE}).
 *
 * Template walk-through (mirrors the proven spike, adapted to dotden's real `.dotden/` shape —
 * `environments.json` is an `{ environments: [{ id, subscribedWorkspaces }] }` doc and
 * `workspaces.json` an `{ placements: [{ targetPath, workspaceId }] }` doc):
 * - read both JSON docs with chezmoi's `include` + `fromJson`;
 * - find THIS environment's entry by `id == .dotden_env_id`;
 * - when there is no entry OR it subscribes to nothing → emit `*` (ignore everything, fail-safe);
 * - otherwise, for every placement whose `workspaceId` is NOT in `subscribedWorkspaces`,
 *   emit its `targetPath` (ignore that un-subscribed File).
 *
 * @param input The per-OS scoped-out paths to fold in as static lines (issue 1-15).
 * @returns The complete `.chezmoiignore` template text, newline-terminated.
 */
export function renderSubscriptionIgnore(input: SubscriptionIgnoreInput): string {
  // Static lines (header + `.dotden/` + OS scope). chezmoi forward-slashes ignore patterns
  // even on Windows; the caller passes already-relative, forward-slashed paths (issue 1-15).
  const staticLines = [
    '# Generated by dotden. Do not edit by hand.',
    '# dotden owns this file: it keeps its synced metadata out of chezmoi, lists the',
    "# Files scoped to other operating systems than this environment's, and ignores the",
    '# Files of Workspaces this environment does not subscribe to (computed below by',
    "# chezmoi from this environment's dotden_env_id + the synced registry).",
    // `.dotden/` ALWAYS first so dotden metadata is never applied (ADR 0024).
    DEN_IGNORE_RULE,
    ...input.osScopedOutPaths,
  ]

  // The dynamic subscription block — a chezmoi Go template evaluated at apply time. It is the
  // realized Workspace-access boundary (ADR 0005). The registry-entry guard lives here as the
  // fail-safe (b): a missing entry or empty subscription emits `*` (ignore everything), never
  // an error, never apply-all. `{{ .dotden_env_id }}` comes from the environment-local chezmoi
  // config (issue 1-05) so the SAME repo materializes different subsets per environment.
  const subscriptionTemplate = [
    '{{- /* dotden: per-environment Workspace subscription (issue 1-13, ADR 0005). */ -}}',
    // Read `dotden_env_id` defensively: an UNREGISTERED env (cloned, not yet claimed) may have
    // no `[data].dotden_env_id` at all. `hasKey` guards against chezmoi's "map has no entry"
    // error, degrading a missing id to "" → no matching entry → the ignore-everything fail-safe
    // below (guard b). The DenService surfaces WHY (never silent), so this is never a quiet blank.
    `{{- $envId := "" -}}`,
    `{{- if hasKey . "dotden_env_id" -}}{{- $envId = .dotden_env_id -}}{{- end -}}`,
    `{{- $registry := (include ${quote(REGISTRY_INCLUDE)} | fromJson).environments -}}`,
    `{{- $placements := (include ${quote(PLACEMENTS_INCLUDE)} | fromJson).placements -}}`,
    // Find THIS environment's registry entry by stable id (never the hostname, ADR 0024).
    '{{- $entry := dict -}}',
    '{{- range $registry -}}{{- if eq .id $envId -}}{{- $entry = . -}}{{- end -}}{{- end -}}',
    '{{- $subscribed := list -}}',
    '{{- if hasKey $entry "subscribedWorkspaces" -}}{{- $subscribed = $entry.subscribedWorkspaces -}}{{- end -}}',
    // Guard (b): no entry / empty subscription → ignore EVERYTHING (apply nothing). Fail-safe,
    // never an error, never apply-all. The DenService surfaces WHY (never silent, issue 1-13).
    '{{- if eq (len $subscribed) 0 }}',
    IGNORE_EVERYTHING_RULE,
    '{{- else -}}',
    // Ignore every File whose Workspace is NOT in this environment's subscription set.
    '{{- range $placements -}}',
    '{{- if not (has .workspaceId $subscribed) }}',
    '{{ .targetPath }}',
    '{{- end -}}',
    '{{- end -}}',
    '{{- end -}}',
  ]

  return [...staticLines, ...subscriptionTemplate, ''].join('\n')
}

/** Quote a string for embedding inside the Go template (Go template strings share JSON quoting). */
function quote(value: string): string {
  return JSON.stringify(value)
}
