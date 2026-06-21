import { useDenSession } from '@/features/shell/components/DenSessionProvider'
import { useEffect, useState } from 'react'
import type { EnvironmentWithAttribution } from '@shared/environments'
import type { FileVersion } from '@shared/history'
import type { SecretFinding } from '@shared/secrets'

interface InspectorDetails {
  readonly targetPath: string
  readonly findings: readonly SecretFinding[]
  readonly versions: readonly FileVersion[]
  readonly environments: readonly EnvironmentWithAttribution[]
}

interface InspectorError {
  readonly targetPath: string
  readonly message: string
}

/**
 * FileInfoSection — the inspector's per-File "FILE" details (signature screen): the selected File's
 * Workspace, effective OS Scope (out-of-this-OS / a narrowed set / Every OS), path, and status.
 * Reads the selected File (env A) or incoming item (env B) from the scoped den-session store.
 */
export function FileInfoSection() {
  const role = useDenSession((s) => s.role)
  const selected = useDenSession((s) => s.selected)
  const files = useDenSession((s) => s.files)
  const incoming = useDenSession((s) => s.incoming)
  const workspaces = useDenSession((s) => s.workspaces)
  const busy = useDenSession((s) => s.busy)
  const moveSelectedToWorkspace = useDenSession((s) => s.moveSelectedToWorkspace)

  const selectedFile = files.find((f) => f.targetPath === selected)
  const selectedIncoming = incoming.find((i) => i.targetPath === selected)
  const workspaceLabel = workspaces[0]?.label ?? 'Personal'
  const canMoveWorkspace = role === 'a' && selectedFile && workspaces.length > 1
  const detailPath = role === 'a' ? selectedFile?.targetPath : undefined
  const [details, setDetails] = useState<InspectorDetails | null>(null)
  const [detailsLoadingPath, setDetailsLoadingPath] = useState<string | null>(null)
  const [detailsError, setDetailsError] = useState<InspectorError | null>(null)

  useEffect(() => {
    if (!detailPath) return

    let active = true
    const targetPath = detailPath
    async function load() {
      await Promise.resolve()
      if (!active) return
      setDetailsLoadingPath(targetPath)
      setDetailsError(null)
      try {
        const [findings, versions, environments] = await Promise.all([
          window.dotden.den.scanCommit([targetPath]),
          window.dotden.den.fileHistory(targetPath),
          window.dotden.environment.list(),
        ])
        if (!active) return
        setDetails({ targetPath, findings, versions: versions.slice(0, 3), environments })
      } catch (caught) {
        if (!active) return
        setDetailsError({ targetPath, message: messageOf(caught, 'Could not read File details.') })
      } finally {
        if (active) {
          setDetailsLoadingPath((current) => (current === targetPath ? null : current))
        }
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [detailPath])

  const visibleDetails = details?.targetPath === detailPath ? details : null
  const visibleError =
    detailsError && detailsError.targetPath === detailPath ? detailsError.message : null
  const detailsLoading = detailsLoadingPath === detailPath

  return (
    <section>
      <h2 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide">FILE</h2>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs">
        <dt className="text-muted-foreground">Workspace</dt>
        <dd className="text-right">
          {canMoveWorkspace ? (
            <select
              aria-label="Move File to Workspace"
              className="border-input bg-background max-w-full rounded-md border px-2 py-1 text-xs"
              value={selectedFile.workspaceId}
              disabled={busy !== null}
              onChange={(event) => moveSelectedToWorkspace(event.target.value)}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.label}
                </option>
              ))}
            </select>
          ) : (
            selectedIncoming?.workspaceId ??
            workspaces.find((w) => w.id === selectedFile?.workspaceId)?.label ??
            workspaceLabel
          )}
        </dd>
        <dt className="text-muted-foreground">Scope</dt>
        <dd className="text-right">
          {selectedFile?.muted ? (
            // Scoped out of THIS OS → chezmoi ignores it here; the tree dims the row.
            <span className="border-border text-muted-foreground rounded border px-1.5 py-0.5">
              out of this OS
            </span>
          ) : selectedFile && selectedFile.scope !== null ? (
            // In scope here, but narrowed to a specific OS set (the effective Scope).
            <span className="text-muted-foreground">{selectedFile.scope.join(', ')}</span>
          ) : (
            // The universal Scope (null) applies on every OS.
            <span className="text-muted-foreground">Every OS</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Path</dt>
        <dd className="text-right font-mono break-all">{selected ?? '—'}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd className="text-right">
          {selectedFile?.status ?? (selectedIncoming ? 'incoming' : 'unchanged')}
        </dd>
      </dl>
      {detailPath ? (
        <div className="border-border mt-3 space-y-3 border-t pt-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Secrets</span>
            <SecretStatus
              loading={detailsLoading}
              error={visibleError}
              findings={visibleDetails?.findings ?? []}
            />
          </div>

          <div>
            <h3 className="text-muted-foreground mb-1 font-medium">Recent commits</h3>
            {detailsLoading ? (
              <p className="text-muted-foreground">Reading history...</p>
            ) : visibleDetails?.versions.length ? (
              <ul className="space-y-1">
                {visibleDetails.versions.map((version) => (
                  <li key={version.sha} className="text-muted-foreground min-w-0">
                    <span className="text-foreground font-mono">{version.shortSha}</span>{' '}
                    <span className="break-words">{version.message}</span>
                    <span className="block">{formatDate(version.committedAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                {visibleError ? 'History unavailable.' : 'No commits yet.'}
              </p>
            )}
          </div>

          <div>
            <h3 className="text-muted-foreground mb-1 font-medium">Environments</h3>
            {detailsLoading ? (
              <p className="text-muted-foreground">Reading environments...</p>
            ) : visibleDetails?.environments.length ? (
              <ul className="space-y-1">
                {visibleDetails.environments.map((environment) => {
                  const status = environmentStatus(environment)
                  return (
                    <li
                      key={environment.id}
                      className="grid min-w-0 grid-cols-[auto_1fr] items-center gap-x-2"
                    >
                      <span className={`size-2 rounded-full ${status.dotClassName}`} />
                      <span className="min-w-0">
                        <span className="text-foreground truncate">{environment.label}</span>
                        <span className="text-muted-foreground"> · {status.label}</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                {visibleError ? 'Environments unavailable.' : 'No environments registered.'}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function SecretStatus({
  loading,
  error,
  findings,
}: {
  readonly loading: boolean
  readonly error: string | null
  readonly findings: readonly SecretFinding[]
}) {
  if (loading) {
    return <span className="text-muted-foreground shrink-0">Checking...</span>
  }

  if (error) {
    return (
      <span className="bg-dd-red-950 text-dd-red-400 shrink-0 rounded-full px-2 py-0.5">
        Unavailable
      </span>
    )
  }

  if (findings.length > 0) {
    return (
      <span className="bg-dd-ember-950 text-dd-ember-400 shrink-0 rounded-full px-2 py-0.5">
        {findings.length} warning{findings.length === 1 ? '' : 's'}
      </span>
    )
  }

  return (
    <span className="bg-dd-green-950 text-dd-green-400 shrink-0 rounded-full px-2 py-0.5">
      Clear
    </span>
  )
}

function environmentStatus(env: EnvironmentWithAttribution): {
  readonly label: string
  readonly dotClassName: string
} {
  if (env.isSelf) {
    return { label: 'This environment', dotClassName: 'bg-dd-ember-500' }
  }
  if (env.attribution.commitCount > 0) {
    return { label: 'Active', dotClassName: 'bg-dd-green-500' }
  }
  return { label: 'No activity', dotClassName: 'bg-dd-ink-400' }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback
}
