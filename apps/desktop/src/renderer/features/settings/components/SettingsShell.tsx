import { Suspense, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { WindowTitleBar, windowNoDragRegionStyle } from '@/components/den/window-controls'
import { cn } from '@/lib/utils'
import { DEFAULT_SETTINGS_TAB_ID, SETTINGS_TABS, type SettingsTab } from '../lib/tabs'

/**
 * SettingsShell — the Settings window shell: a shared titlebar, a 248px nav rail, and a content
 * area that swaps the active tab's content (issue 2-08; design: screens/settings.md).
 *
 * It follows the **same instance-swap pattern as the OnboardingShell**: a fixed left rail + a
 * content slot that swaps per active tab, edited once. The rail and the content both render
 * straight from the {@link SETTINGS_TABS} registry — the shell knows nothing tab-specific, so a
 * later tab slice appends ONE registry entry and shows up here with no shell change (the "clean
 * extensible tab registry" this issue establishes).
 *
 * Only `live` tabs are clickable; `placeholder` tabs render **inert/disabled** in the rail and,
 * if somehow selected, show a neutral "coming soon" empty state (a first-class fallback, not a
 * blank — never fail silently). The shell opens on the first live tab (Sync today).
 *
 * @param onClose Return to the main app (the titlebar's back affordance). The Settings surface is
 *   a route the app shows over the Workspace, mirroring how onboarding/returning are full-window
 *   routes; closing flips back to the Workspace.
 */
export function SettingsShell({ onClose }: { onClose: () => void }) {
  // The active tab id is the only state the shell owns (the OnboardingShell step analogue).
  const [activeId, setActiveId] = useState<string>(DEFAULT_SETTINGS_TAB_ID)
  // The active tab; the default id always resolves to a registry entry, so this never falls
  // through, but the explicit guard keeps the render type-safe under noUncheckedIndexedAccess.
  const active: SettingsTab | undefined = SETTINGS_TABS.find((tab) => tab.id === activeId)

  return (
    <div className="bg-background text-foreground grid h-screen grid-rows-[auto_1fr]">
      {/* Shared Titlebar — back to the app + the Settings heading (design: settings.md Titlebar). */}
      <WindowTitleBar className="gap-3 px-4 py-2 text-sm" windowsControlsClassName="-mr-4 h-10">
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground hover:bg-secondary/40 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs"
          style={windowNoDragRegionStyle}
        >
          <ArrowLeft className="size-4" /> Back
        </button>
        <span className="text-foreground font-medium">Settings</span>
        <div className="h-px flex-1" />
      </WindowTitleBar>

      <div className="grid min-h-0 grid-cols-[248px_1fr]">
        {/* 248px nav rail — a SETTINGS eyebrow + one SidebarItem per registered tab. */}
        <nav className="bg-sidebar border-border flex flex-col gap-0.5 overflow-y-auto border-r px-3 py-4">
          <p className="text-muted-foreground px-2 pt-1 pb-2 text-[10px] font-semibold tracking-widest uppercase">
            Settings
          </p>
          {SETTINGS_TABS.map((tab) => (
            <SidebarItem
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              onSelect={() => setActiveId(tab.id)}
            />
          ))}
        </nav>

        {/* Content area — swaps the active tab's content instance (the instance-swap seam). */}
        <main className="min-h-0 overflow-y-auto">
          {active && active.status === 'live' && active.Content ? (
            // Key by id so switching tabs remounts the content (fresh state per tab), exactly
            // like the OnboardingShell keys its step content — the instance-swap pattern.
            <Suspense fallback={<TabLoading label={active.label} />}>
              <active.Content key={active.id} />
            </Suspense>
          ) : (
            <PlaceholderTab label={active?.label ?? 'Settings'} />
          )}
        </main>
      </div>
    </div>
  )
}

/**
 * One nav-rail row (design-system `SidebarItem`). A `live` tab is interactive (ember-tinted when
 * active); a `placeholder` tab is rendered **disabled** with a faint "Soon" marker, so the rail
 * shows the full v1 shape without pretending an unbuilt tab works.
 */
function SidebarItem({
  tab,
  active,
  onSelect,
}: {
  tab: SettingsTab
  active: boolean
  onSelect: () => void
}) {
  const Icon = tab.icon
  const isPlaceholder = tab.status === 'placeholder'
  return (
    <button
      type="button"
      // Inert until its slice ships (never offer UI that does not exist — never fail silently).
      disabled={isPlaceholder}
      aria-current={active ? 'page' : undefined}
      onClick={onSelect}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
        active && 'bg-sidebar-accent text-foreground font-medium',
        !active && !isPlaceholder && 'text-sidebar-foreground hover:bg-sidebar-accent/50',
        isPlaceholder && 'text-muted-foreground/50 cursor-not-allowed',
      )}
    >
      <Icon className={cn('size-4 shrink-0', active && 'text-dd-ember-400')} />
      <span className="flex-1">{tab.label}</span>
      {isPlaceholder ? (
        <span className="border-border text-muted-foreground/60 rounded border px-1 text-[9px] font-medium tracking-wide uppercase">
          Soon
        </span>
      ) : null}
    </button>
  )
}

/**
 * The inert placeholder content shown for a not-yet-built tab — an honest empty state (a
 * first-class fallback, never a blank screen), explaining the tab is coming in a later slice.
 */
function TabLoading({ label }: { label: string }) {
  return <p className="text-muted-foreground p-8 text-sm">Loading {label} settings…</p>
}

function PlaceholderTab({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-2 p-8">
      <h2 className="text-foreground text-xl font-semibold tracking-tight">{label}</h2>
      <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
        This tab isn’t built yet — it arrives in a later release. For now, the{' '}
        <span className="text-foreground font-medium">Sync</span> tab is live.
      </p>
    </div>
  )
}
