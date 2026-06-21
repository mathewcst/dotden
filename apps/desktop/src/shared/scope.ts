/**
 * Scope — the OS-applicability model, shared across the IPC boundary.
 *
 * **Scope** is "the set of OSes where a File or Folder applies" (CONTEXT.md "Scope").
 * The types live here, in the cross-process contract (`src/shared`), because both the
 * main process (which compiles Scope into native `.chezmoiignore` rules — see
 * `foundation/platform/os-scope.ts`) and the renderer (the Scope editor UI) speak them.
 * Keeping them in the Electron-free, node-free contract is what lets the renderer import
 * the Scope vocabulary without reaching into `main/**` (ADR 0031) or pulling in node types.
 *
 * The operations on these types (`intersectScope`, `effectiveScope`, `scopedOutPaths`, …)
 * stay in `foundation/platform/os-scope.ts`: they are main-side behavior, not contract.
 */

/**
 * The OS values dotden scopes to — the platform identifiers a File/Folder can apply on.
 *
 * Structurally a subset of Node's `process.platform` union (mirrors {@link import('./ipc-api.js').Platform});
 * declared as a plain string union so this contract module needs no `@types/node` and the
 * renderer can import the type without pulling in node types. dotden's v1 cares about the
 * three desktop OSes, but the model is the full string union so an unusual `process.platform`
 * is never silently dropped.
 */
export type Os =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd'

/**
 * A **Scope**: the set of OSes a File or Folder applies on, or `null` for the universal
 * (unrestricted) Scope.
 *
 * The distinction is deliberate and load-bearing:
 * - `null` ⇒ **applies everywhere** (the default for a freshly Tracked File — dotden never
 *   silently scopes a File out). It is the identity for intersection: narrowing anything by
 *   `null` leaves it unchanged, and a child under a `null`-Scoped Folder inherits no
 *   restriction.
 * - a concrete array ⇒ **applies only on these OSes** (a narrowing). An **empty** array is
 *   a real, representable Scope meaning "applies nowhere" — the floor a narrowing can reach
 *   (e.g. a Linux-only child under a Windows-only Folder), never a silent error.
 *
 * Stored as a plain readonly array (not a Set) so it serializes directly into the synced
 * `.dotden/` JSON (ADR 0024) and produces small, human-readable git diffs.
 */
export type Scope = readonly Os[] | null
