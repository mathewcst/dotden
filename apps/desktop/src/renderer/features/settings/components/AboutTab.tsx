import { useEffect, useState } from 'react'
import { ExternalLink, Info, Loader2, RefreshCw } from 'lucide-react'
import { Switch } from '@/ui/switch'
import {
  CHEZMOI_CREDIT,
  describeUpdateStatus,
  isUpdateCheckUnavailable,
  type AppInfo,
  type UpdateCheckResult,
  type UpdateChannel,
  type UpdateSettings,
} from '@shared/app-info'

/**
 * AboutTab — the Settings → About tab (issue 2-16, stories 52–53; design: screens/settings.md
 * "About").
 *
 * Three honest surfaces:
 *
 * - **Version** — the running build's version, read from `app.getVersion()` over the `app:get-info`
 *   IPC seam, so the user always knows exactly what they are on (with the platform as a diagnostic
 *   hint for bug reports).
 * - **Update check + preferences** — the manual check runs through electron-updater's GitHub
 *   Releases feed, and the auto-update/channel preferences stay environment-local in userData.
 * - **chezmoi credit** — the faithful-wrapper acknowledgement (ADR 0003): dotden is the GUI; the
 *   user's Den stays a plain chezmoi repository. Crediting chezmoi keeps that relationship honest
 *   and visible.
 */
export function AboutTab() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<UpdateSettings | null>(null)
  // The last update-check result; null until the user runs a check (we don't auto-check on mount,
  // so the tab never makes a network-shaped call the user didn't ask for).
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load the running build's version once on mount (cheap, local, no network).
  useEffect(() => {
    let alive = true
    Promise.all([window.dotden.app.getInfo(), window.dotden.app.getUpdateSettings()])
      .then(([loadedInfo, loadedSettings]) => {
        if (!alive) return
        setInfo(loadedInfo)
        setSettings(loadedSettings)
      })
      .catch((caught: unknown) => {
        if (alive) setError(messageOf(caught, 'Could not load the update settings.'))
      })
    return () => {
      alive = false
    }
  }, [])

  /**
   * Run the update check. The placeholder never throws for "no feed" (it returns an `unavailable`
   * result), but a genuine failure still surfaces inline rather than silently — the user always
   * learns what happened.
   */
  async function check() {
    setChecking(true)
    setError(null)
    try {
      const result = await window.dotden.app.checkForUpdates()
      setUpdate(result)
      setSettings(await window.dotden.app.getUpdateSettings())
    } catch (caught) {
      setError(messageOf(caught, 'Could not check for updates.'))
    } finally {
      setChecking(false)
    }
  }

  async function saveSettings(patch: Partial<UpdateSettings>) {
    if (!settings) return
    const previous = settings
    const next: UpdateSettings = { ...settings, ...patch }
    setSettings(next)
    setError(null)
    try {
      setSettings(await window.dotden.app.setUpdateSettings(next))
    } catch (caught) {
      setSettings(previous)
      setError(messageOf(caught, 'Could not save update settings.'))
    }
  }

  if (!info || !settings) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-8 text-sm">
        {error ? (
          <span className="text-dd-red-400" role="alert">
            {error}
          </span>
        ) : (
          <>
            <Loader2 className="size-4 animate-spin" /> Loading…
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex max-w-2xl flex-col gap-8 p-8">
      <header className="space-y-1">
        <h2 className="text-foreground text-xl font-semibold tracking-tight">About dotden</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          The version you’re running, whether you’re up to date, and what dotden is built on.
        </p>
      </header>

      {error ? (
        <p className="text-dd-red-400 text-xs" role="alert">
          {error}
        </p>
      ) : null}

      {/* Version + check card (design: settings.md "About"). */}
      <div className="border-border bg-card flex flex-col gap-4 rounded-lg border p-5">
        <div className="flex items-start gap-3">
          <Info className="text-dd-ember-400 mt-0.5 size-5 shrink-0" />
          <div className="flex-1">
            <p className="text-foreground text-sm font-medium">dotden</p>
            {/* Mono version, matching how versions read elsewhere in the app. */}
            <p className="text-muted-foreground font-mono text-xs">
              version {info.version} · {info.platform}
            </p>
          </div>
        </div>

        {/* The update-check affordance + its honest result line. */}
        <div className="border-border flex flex-wrap items-center gap-3 border-t pt-4">
          <button
            type="button"
            onClick={() => void check()}
            disabled={checking}
            className="border-border bg-background hover:bg-secondary/40 text-foreground inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60"
          >
            {checking ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {checking ? 'Checking…' : 'Check for updates'}
          </button>

          {update ? (
            <span
              className={
                isUpdateCheckUnavailable(update)
                  ? 'text-muted-foreground text-xs'
                  : 'text-foreground text-xs'
              }
            >
              {describeUpdateStatus(update)}
              {/* When the check couldn't run, say WHY (never a silent failure). */}
              {update.detail ? (
                <span className="text-muted-foreground"> {update.detail}</span>
              ) : null}
            </span>
          ) : null}
        </div>

        <div className="border-border divide-border divide-y border-t">
          <SwitchRow
            title="Automatic updates"
            sub="Download updates in the background after dotden finds one. Installing still waits for you to restart."
            checked={settings.autoUpdateEnabled}
            onCheckedChange={(autoUpdateEnabled) => void saveSettings({ autoUpdateEnabled })}
          />
          <ChannelRow
            value={settings.channel}
            onChange={(channel) => void saveSettings({ channel })}
          />
        </div>

        <p className="text-muted-foreground text-xs">
          Last checked: {formatCheckedAt(update?.checkedAt ?? settings.lastCheckedAt)}
        </p>
      </div>

      {/* The chezmoi credit — the faithful-wrapper acknowledgement (ADR 0003). */}
      <div className="border-dd-ember-900 bg-dd-ember-950 flex items-start gap-3 rounded-lg border p-4">
        <div className="space-y-1.5">
          <p className="text-foreground text-sm font-medium">Built on chezmoi</p>
          <p className="text-muted-foreground text-xs leading-relaxed">{CHEZMOI_CREDIT.blurb}</p>
          <ResourceLink href={CHEZMOI_CREDIT.url} label={`${CHEZMOI_CREDIT.name} — chezmoi.io`} />
        </div>
      </div>
    </div>
  )
}

/**
 * A trailing external resource link (design-system `SettingsRow` `Trail=Link`). Opens in the
 * default browser; private to this tab. Carries `rel="noreferrer"` so an opened page can never
 * reach back into the app (Electron security hygiene, ADR 0004).
 */
function ResourceLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-dd-ember-400 hover:text-dd-ember-300 inline-flex items-center gap-1.5 text-xs font-medium"
    >
      {label}
      <ExternalLink className="size-3" />
    </a>
  )
}

function SwitchRow({
  title,
  sub,
  checked,
  onCheckedChange,
}: {
  title: string
  sub: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-4 py-3.5">
      <span className="flex-1">
        <span className="text-foreground block text-sm font-medium">{title}</span>
        <span className="text-muted-foreground block text-xs leading-relaxed">{sub}</span>
      </span>
      <span className="pt-0.5">
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </span>
    </label>
  )
}

const UPDATE_CHANNELS: readonly { value: UpdateChannel; label: string; hint: string }[] = [
  { value: 'stable', label: 'Stable', hint: 'Only production releases.' },
  { value: 'beta', label: 'Beta', hint: 'Include prerelease builds when they are published.' },
]

function ChannelRow({
  value,
  onChange,
}: {
  value: UpdateChannel
  onChange: (channel: UpdateChannel) => void
}) {
  const activeHint = UPDATE_CHANNELS.find((option) => option.value === value)?.hint
  return (
    <div className="flex items-start gap-4 py-3.5">
      <span className="flex-1">
        <span className="text-foreground block text-sm font-medium">Update channel</span>
        <span className="text-muted-foreground block text-xs leading-relaxed">{activeHint}</span>
      </span>
      <div className="border-border bg-background flex shrink-0 items-center gap-1 rounded-md border p-0.5">
        {UPDATE_CHANNELS.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={
                selected
                  ? 'bg-primary text-primary-foreground rounded px-2.5 py-1 text-xs font-medium transition-colors'
                  : 'text-muted-foreground hover:text-foreground rounded px-2.5 py-1 text-xs font-medium transition-colors'
              }
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function formatCheckedAt(checkedAt: string | null): string {
  if (!checkedAt) return 'Never'
  const date = new Date(checkedAt)
  if (Number.isNaN(date.getTime())) return checkedAt
  return date.toLocaleString()
}

/** Pull a human message off an unknown thrown value, falling back to `fallback`. */
function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback
}
