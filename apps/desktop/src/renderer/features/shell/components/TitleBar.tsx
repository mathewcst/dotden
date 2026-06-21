import { useDenSession } from '@/features/shell/components/DenSessionProvider'
import { cn } from '@/shared/lib/utils'
import { IconButton } from '@/ui/icon-button'
import {
  ArrowDownUp,
  Bell,
  ChevronDown,
  Folder,
  Minus,
  Search,
  Settings2,
  Square,
  X,
} from 'lucide-react'
import { useState, type CSSProperties, type ReactNode } from 'react'

const dragRegionStyle = {
  appRegion: 'drag',
  WebkitAppRegion: 'drag',
} as CSSProperties

const noDragRegionStyle = {
  appRegion: 'no-drag',
  WebkitAppRegion: 'no-drag',
} as CSSProperties

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
  const platform = window.dotden.platform
  const [isMaximized, setIsMaximized] = useState(false)

  const workspaceLabel = workspaces[0]?.label ?? 'Personal'
  // How many changes are incoming for THIS environment (issue 1-09).
  const incomingCount = remoteAxis.size
  const isMac = platform === 'darwin'

  async function toggleMaximize() {
    setIsMaximized(await window.dotden.window.toggleMaximize())
  }

  return (
    <header
      className="border-border bg-sidebar flex items-center gap-2 border-b px-3 py-2.5 text-sm"
      style={dragRegionStyle}
    >
      {isMac ? (
        <WindowControls
          platform="darwin"
          isMaximized={isMaximized}
          onToggleMaximize={toggleMaximize}
        />
      ) : null}

      {/* Workspace switcher — folder + label + chevron. Presentational for now: the single-pane
          shell shows every Workspace in the tree, so there is no per-pane switch to wire yet (the
          chevron previews the post-v1 Workspace picker). */}
      <div
        className="text-foreground flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5"
        style={noDragRegionStyle}
      >
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
        style={noDragRegionStyle}
      >
        <Search className="size-3.5" />
        <span>Search files &amp; workspaces…</span>
        <kbd className="border-border text-muted-foreground ml-auto rounded border px-1.5 py-0.5 font-mono text-[11px]">
          ⌘K
        </kbd>
      </button>

      <div className="h-px flex-1" />

      {/* Right cluster — sync status · bell · settings · avatar. */}
      <div className="flex shrink-0 items-center gap-1" style={noDragRegionStyle}>
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
      {!isMac ? (
        <WindowControls
          platform={platform === 'win32' ? 'win32' : 'linux'}
          isMaximized={isMaximized}
          onToggleMaximize={toggleMaximize}
        />
      ) : null}
    </header>
  )
}

function WindowControls({
  platform,
  isMaximized,
  onToggleMaximize,
}: {
  platform: 'darwin' | 'win32' | 'linux'
  isMaximized: boolean
  onToggleMaximize: () => void
}) {
  if (platform === 'darwin') {
    return (
      <div className="mr-2 flex shrink-0 items-center gap-1.5" style={noDragRegionStyle}>
        <MacWindowButton
          label="close window"
          className="bg-[#ff5f57]"
          onClick={() => void window.dotden.window.close()}
        />
        <MacWindowButton
          label="minimize window"
          className="bg-[#ffbd2e]"
          onClick={() => void window.dotden.window.minimize()}
        />
        <MacWindowButton
          label={isMaximized ? 'restore window' : 'maximize window'}
          className="bg-[#28c840]"
          onClick={onToggleMaximize}
        />
      </div>
    )
  }

  return (
    <div className="-my-2.5 -mr-3 ml-1 flex h-12 shrink-0 items-stretch" style={noDragRegionStyle}>
      <WindowsWindowButton
        label="minimize window"
        onClick={() => void window.dotden.window.minimize()}
      >
        <Minus />
      </WindowsWindowButton>
      <WindowsWindowButton
        label={isMaximized ? 'restore window' : 'maximize window'}
        onClick={onToggleMaximize}
      >
        <Square />
      </WindowsWindowButton>
      <WindowsWindowButton
        label="close window"
        className="hover:bg-red-500 hover:text-white"
        onClick={() => void window.dotden.window.close()}
      >
        <X />
      </WindowsWindowButton>
    </div>
  )
}

function MacWindowButton({
  label,
  className,
  onClick,
}: {
  label: string
  className: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn('size-3 rounded-full transition-opacity hover:opacity-85', className)}
      onClick={onClick}
      style={noDragRegionStyle}
    />
  )
}

function WindowsWindowButton({
  label,
  className,
  children,
  onClick,
}: {
  label: string
  className?: string
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground flex w-11 cursor-pointer items-center justify-center transition-colors [&_svg]:size-3.5',
        className,
      )}
      onClick={onClick}
      style={noDragRegionStyle}
    >
      {children}
    </button>
  )
}
