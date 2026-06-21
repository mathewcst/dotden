import { ConflictCallout } from '@/features/apply/components/ConflictCallout'
import { IncomingInspectorCard } from '@/features/apply/components/IncomingInspectorCard'
import { LastCommitSection } from '@/features/commit/components/LastCommitSection'
import { ScopeEditor } from '@/features/scope/components/ScopeEditor'
import { FileInfoSection } from '@/features/workspace/components/FileInfoSection'
import { GroupSection } from '@/features/workspace/components/GroupSection'
import { useDenSession } from '@/den-session'

/**
 * RightInspector — the den window's right column. Composes the per-feature inspector sections in the
 * signature-screen order: the soft error channel, the Conflict callout (apply, env A), the incoming
 * card (apply, env B), the FILE details (workspace), the GROUP organize control (workspace), the OS
 * Scope editor (scope), and the outbound commit status (commit). Each section reads its own slice.
 */
export function RightInspector() {
  const error = useDenSession((s) => s.error)
  const role = useDenSession((s) => s.role)
  const selected = useDenSession((s) => s.selected)
  const selectedGroup = useDenSession((s) => s.selectedGroup)
  const files = useDenSession((s) => s.files)
  const workspaces = useDenSession((s) => s.workspaces)
  const busy = useDenSession((s) => s.busy)
  const scopeSelectedFile = useDenSession((s) => s.scopeSelectedFile)
  const scopeSelectedGroup = useDenSession((s) => s.scopeSelectedGroup)

  const selectedFile = files.find((f) => f.targetPath === selected)
  const scopedGroup = selectedGroup
    ? workspaces
        .find((workspace) => workspace.id === selectedGroup.workspaceId)
        ?.groups.find((group) => group.id === selectedGroup.groupId)
    : null

  return (
    <aside className="border-border bg-sidebar flex flex-col gap-4 overflow-auto border-l p-4 text-sm">
      {error ? (
        <div className="bg-dd-red-950 text-dd-red-400 rounded-md px-3 py-2 text-xs" role="alert">
          {error.message}
        </div>
      ) : null}

      {/* Conflict callout (env A) + incoming card (env B) — the review entry points. */}
      <ConflictCallout />
      <IncomingInspectorCard />

      {/* FILE info — the inspector's per-File details (signature screen). */}
      <FileInfoSection />

      {/* ORGANIZE — file the selected File into a Group within its Workspace (issue 1-14). */}
      <GroupSection />

      {/* OS SCOPE — scope the selected File or Group to specific OSes (issue 1-15). The main process
          clamps the request to inherited Scope (narrowable, never broadenable) and re-compiles the
          native `.chezmoiignore`; a scoped-out File renders muted. env A only. */}
      {role === 'a' && selectedFile ? (
        <ScopeEditor
          scope={selectedFile.scope}
          disabled={busy !== null}
          onChange={scopeSelectedFile}
        />
      ) : null}

      {role === 'a' && scopedGroup ? (
        <ScopeEditor
          scope={scopedGroup.scope}
          disabled={busy !== null}
          onChange={scopeSelectedGroup}
          subject="Group"
        />
      ) : null}

      {/* Outbound commit status — the honest "nothing to commit" notice + "Last commit" callout. */}
      <LastCommitSection />
    </aside>
  )
}
