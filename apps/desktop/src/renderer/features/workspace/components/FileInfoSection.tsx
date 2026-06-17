import { useDenSession } from '@/features/shell/components/DenSessionProvider'

/**
 * FileInfoSection — the inspector's per-File "FILE" details (signature screen): the selected File's
 * Workspace, effective OS Scope (out-of-this-OS / a narrowed set / Every OS), path, and status.
 * Reads the selected File (env A) or incoming item (env B) from the scoped den-session store.
 */
export function FileInfoSection() {
  const selected = useDenSession((s) => s.selected)
  const files = useDenSession((s) => s.files)
  const incoming = useDenSession((s) => s.incoming)
  const workspaces = useDenSession((s) => s.workspaces)

  const selectedFile = files.find((f) => f.targetPath === selected)
  const selectedIncoming = incoming.find((i) => i.targetPath === selected)
  const workspaceLabel = workspaces[0]?.label ?? 'Personal'

  return (
    <section>
      <h2 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide">FILE</h2>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs">
        <dt className="text-muted-foreground">Workspace</dt>
        <dd className="text-right">
          {selectedIncoming?.workspaceId ??
            workspaces.find((w) => w.id === selectedFile?.workspaceId)?.label ??
            workspaceLabel}
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
    </section>
  )
}
