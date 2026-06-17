import { useDenSession } from '@/features/shell/components/DenSessionProvider'

/**
 * GroupSection — the inspector's "GROUP" organize control (issue 1-14): file the selected File into
 * a Group within its Workspace. Pure organization — this never changes the File's access
 * (Workspace) or its on-disk path. Only shown for a managed File on env A; the Workspace owns the
 * Groups, so the menu lists only its own (a Group belongs to exactly one Workspace, ADR 0005).
 */
export function GroupSection() {
  const role = useDenSession((s) => s.role)
  const selected = useDenSession((s) => s.selected)
  const files = useDenSession((s) => s.files)
  const workspaces = useDenSession((s) => s.workspaces)
  const busy = useDenSession((s) => s.busy)
  const moveSelectedToGroup = useDenSession((s) => s.moveSelectedToGroup)

  const selectedFile = files.find((f) => f.targetPath === selected)
  // The Groups available for filing the selected File — those of its OWN Workspace.
  const selectedFileGroups =
    workspaces.find((w) => w.id === selectedFile?.workspaceId)?.groups ?? []

  if (!(role === 'a' && selectedFile)) return null

  return (
    <section className="border-border bg-card rounded-md border p-3">
      <h2 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide">GROUP</h2>
      {selectedFileGroups.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No Groups yet in this Workspace. Add one in the sidebar to organize Files — Groups never
          change where a File lands or which environments apply it.
        </p>
      ) : (
        <select
          className="border-input bg-background w-full rounded-md border px-2 py-1 text-xs"
          value={selectedFile.groupId ?? ''}
          disabled={busy !== null}
          onChange={(event) => moveSelectedToGroup(event.target.value || null)}
        >
          <option value="">— No Group (Workspace root) —</option>
          {selectedFileGroups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.label}
            </option>
          ))}
        </select>
      )}
    </section>
  )
}
