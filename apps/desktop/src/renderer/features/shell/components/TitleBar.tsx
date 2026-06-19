import { IconButton } from '@/ui/icon-button'
import { useDenSession } from '@/features/shell/components/DenSessionProvider'
import { ArrowDownUp, Bell, ChevronDown, Folder, Search, Settings2 } from 'lucide-react'

/**
 * TitleBar — the den window's top bar (signature screen, Figma `Titlebar` 516:1424): the Workspace
 * switcher · centered ⌘K search · sync status · bell · settings · avatar. The `flex-1` spacers on
 * either side of the search keep it optically centered regardless of the side clusters.
 *
 * The search opens the tree's built-in search session, so `onSearch` + `searchDisabled` are handed
 * down from the shell (which owns the `@pierre/trees` model); everything else reads the store.
 */
export function TitleBar({
  onSearch,
  searchDisabled,
  onOpenSettings,
}: {
  onSearch: () => void
  searchDisabled: boolean
  onOpenSettings?: () => void
}) {
  const role = useDenSession((s) => s.role)
  const workspaces = useDenSession((s) => s.workspaces)
  const remoteAxis = useDenSession((s) => s.remoteAxis)

  const workspaceLabel = workspaces[0]?.label ?? 'Personal'
  // How many changes are incoming for THIS environment (issue 1-09).
  const incomingCount = remoteAxis.size

  return (
    <header className="border-border bg-sidebar flex items-center gap-2 border-b px-3 py-2.5 text-sm">
      {/* Desktop window chrome from the Figma shell. Electron owns the real controls; these keep the
          custom dark titlebar visually aligned across platforms. */}
      <div className="mr-2 flex shrink-0 items-center gap-1.5" aria-hidden>
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#ffbd2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
      </div>

      {/* Workspace switcher — folder + label + chevron. Presentational for now: the single-pane
          shell shows every Workspace in the tree, so there is no per-pane switch to wire yet (the
          chevron previews the post-v1 Workspace picker). */}
      <div className="text-foreground flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5">
        <Folder className="text-muted-foreground size-4" aria-hidden />
        <span className="text-[13px] font-medium">{workspaceLabel}</span>
        <ChevronDown className="text-muted-foreground size-4" aria-hidden />
      </div>

      <div className="h-px flex-1" />

      {/* Centered ⌘K search — opens the tree's built-in search session (issue 1-07). */}
      <button
        type="button"
        className="bg-secondary text-muted-foreground hover:text-foreground flex w-[420px] shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]"
        onClick={onSearch}
        disabled={searchDisabled}
      >
        <Search className="size-3.5" />
        <span>Search files &amp; workspaces…</span>
        <kbd className="border-border text-muted-foreground ml-auto rounded border px-1.5 py-0.5 font-mono text-[11px]">
          ⌘K
        </kbd>
      </button>

      <div className="h-px flex-1" />

      {/* Right cluster — sync status · bell · settings · avatar. */}
      <div className="flex shrink-0 items-center gap-1">
        <span className="text-muted-foreground mr-1 flex items-center gap-1 pr-1 text-xs">
          <ArrowDownUp className="size-3" aria-hidden />
          {role === 'a' && incomingCount > 0 ? `${incomingCount} incoming` : 'Up to date'}
        </span>
        <IconButton aria-label="notifications">
          <Bell />
        </IconButton>
        {/* Open the Settings surface (issue 2-08): the app shows it over the Workspace. */}
        <IconButton aria-label="settings" onClick={onOpenSettings} disabled={!onOpenSettings}>
          <Settings2 />
        </IconButton>
        {/* User avatar — initials placeholder (no account model in v1). */}
        <span
          className="bg-background text-foreground ml-1 inline-flex size-7 items-center justify-center rounded-full text-xs font-medium"
          aria-hidden
        >
          {workspaceLabel.charAt(0).toUpperCase()}
        </span>
      </div>
    </header>
  )
}
