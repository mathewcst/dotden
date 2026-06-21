import { cn } from '@/shared/lib/utils'
import { Minus, Square, X } from 'lucide-react'
import { useState, type CSSProperties, type ReactNode } from 'react'

export const windowDragRegionStyle = {
  appRegion: 'drag',
  WebkitAppRegion: 'drag',
} as CSSProperties

export const windowNoDragRegionStyle = {
  appRegion: 'no-drag',
  WebkitAppRegion: 'no-drag',
} as CSSProperties

export type WindowControlsPlatform = 'darwin' | 'win32' | 'linux'

/**
 * WindowTitleBar — shared draggable row for every frameless full-window route.
 *
 * Each surface can provide its own route content, but drag/no-drag behavior and native window
 * actions stay one implementation so boot, setup, settings, and app routes keep parity.
 */
export function WindowTitleBar({
  children,
  className,
  macControlsClassName,
  windowsControlsClassName,
}: {
  children?: ReactNode
  className?: string
  macControlsClassName?: string
  windowsControlsClassName?: string
}) {
  const platform = window.dotden.platform
  const isMac = platform === 'darwin'
  const controlsPlatform: WindowControlsPlatform = platform === 'win32' ? 'win32' : 'linux'

  return (
    <header
      className={cn('border-border bg-sidebar flex h-10 items-center border-b px-3', className)}
      style={windowDragRegionStyle}
    >
      {isMac ? <WindowControls platform="darwin" className={macControlsClassName} /> : null}
      {children ?? <div className="h-px flex-1" />}
      {!isMac ? (
        <WindowControls platform={controlsPlatform} className={windowsControlsClassName} />
      ) : null}
    </header>
  )
}

/**
 * WindowControls — real minimize/maximize/close buttons for dotden's frameless BrowserWindow.
 *
 * The renderer owns OS-specific layout, but native effects stay behind the preload bridge. macOS
 * uses left-side traffic lights; Windows/Linux use the right-side rectangular controls.
 */
export function WindowControls({
  platform,
  className,
}: {
  platform: WindowControlsPlatform
  className?: string
}) {
  const [isMaximized, setIsMaximized] = useState(false)

  async function toggleMaximize() {
    setIsMaximized(await window.dotden.window.toggleMaximize())
  }

  if (platform === 'darwin') {
    return (
      <div
        className={cn('flex shrink-0 items-center gap-1.5', className)}
        style={windowNoDragRegionStyle}
      >
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
          onClick={() => void toggleMaximize()}
        />
      </div>
    )
  }

  return (
    <div className={cn('flex shrink-0 items-stretch', className)} style={windowNoDragRegionStyle}>
      <WindowsWindowButton
        label="minimize window"
        onClick={() => void window.dotden.window.minimize()}
      >
        <Minus />
      </WindowsWindowButton>
      <WindowsWindowButton
        label={isMaximized ? 'restore window' : 'maximize window'}
        onClick={() => void toggleMaximize()}
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
      style={windowNoDragRegionStyle}
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
      style={windowNoDragRegionStyle}
    >
      {children}
    </button>
  )
}
