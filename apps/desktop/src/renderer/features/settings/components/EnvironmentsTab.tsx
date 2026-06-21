import { useEffect, useState } from 'react'
import { Check, Loader2, Monitor, MoreHorizontal, Pencil, Shuffle, Trash2, X } from 'lucide-react'
import { Menu } from '@base-ui/react/menu'
import type { EnvironmentWithAttribution } from '@shared/environments'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'

/**
 * EnvironmentsTab — the Settings → Environments tab (issue 2-15, stories 45–51; design:
 * screens/settings.md "Environments").
 *
 * The registry + lifecycle surface over the synced environment registry `{ id, label, os,
 * subscribedWorkspaces }` (ADR 0024). It lists every environment in the Den so the user knows
 * which computers participate, and exposes the three lifecycle operations that mutate that synced
 * registry:
 *
 * - **Rename** — edit an environment's friendly label (a one-line registry diff; the stable id is
 *   untouched, so identity and git-log attribution survive — ADR 0024). Available on EVERY entry.
 * - **Reassign / merge** — fold a mistaken duplicate entry into the correct one (the keeper inherits
 *   the UNION of both subscriptions; dotden never auto-merges — the user picks which folds in).
 * - **Retire / remove** — drop a decommissioned environment from the registry (a Destructive confirm;
 *   refused for THIS running environment by the registry owner).
 *
 * Each row's **status Pill** and "last active" line are DERIVED FROM GIT LOG on read and never
 * stored in the registry (ADR 0024) — routine activity never churns the synced file. The status is
 * a presentation join, not a persisted field: "This environment" (the one you are using), "Active"
 * (has git-log activity), or "No activity yet".
 *
 * Reassign/retire live in each row's `⋯` menu (design: settings.md "Environments"). The whole tab
 * never fails silently: a failed load/op surfaces inline and leaves the surface recoverable.
 */
export function EnvironmentsTab() {
  const [environments, setEnvironments] = useState<readonly EnvironmentWithAttribution[] | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** The id currently being inline-renamed (null = none editing). */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  /** The entry queued for a Retire confirm (null = dialog closed). */
  const [retiring, setRetiring] = useState<EnvironmentWithAttribution | null>(null)
  /** The entry queued for a Reassign target-pick (null = picker closed). */
  const [reassigning, setReassigning] = useState<EnvironmentWithAttribution | null>(null)

  // Load every environment (joined with git-log attribution) once on mount. env:list also
  // idempotently ensures THIS environment is registered, so the surface always has a self row.
  useEffect(() => {
    let alive = true
    window.dotden.environment
      .list()
      .then((list) => {
        if (alive) setEnvironments(list)
      })
      .catch((caught: unknown) => {
        if (alive) setError(messageOf(caught, 'Could not load your environments.'))
      })
    return () => {
      alive = false
    }
  }, [])

  /** Persist an inline label rename, then adopt the refreshed list the main process returns. */
  async function rename(label: string) {
    const trimmed = label.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      // rename returns the renamed self entry; re-list so every row reflects the synced file.
      await window.dotden.environment.rename(trimmed)
      setEnvironments(await window.dotden.environment.list())
      setEditingId(null)
    } catch (caught) {
      setError(messageOf(caught, 'Could not rename this environment.'))
    } finally {
      setBusy(false)
    }
  }

  /** Retire (remove) a decommissioned environment; adopts the refreshed list it returns. */
  async function retire(envId: string) {
    setBusy(true)
    setError(null)
    try {
      setEnvironments(await window.dotden.environment.retire(envId))
    } catch (caught) {
      setError(messageOf(caught, 'Could not retire this environment.'))
    } finally {
      setBusy(false)
    }
  }

  /** Reassign/merge a duplicate (`fromId`) into the keeper (`intoId`); adopts the refreshed list. */
  async function reassign(fromId: string, intoId: string) {
    setBusy(true)
    setError(null)
    try {
      setEnvironments(await window.dotden.environment.reassign(fromId, intoId))
      setReassigning(null)
    } catch (caught) {
      setError(messageOf(caught, 'Could not reassign this environment.'))
    } finally {
      setBusy(false)
    }
  }

  if (!environments) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-8 text-sm">
        {error ? (
          <span className="text-dd-red-400" role="alert">
            {error}
          </span>
        ) : (
          <>
            <Loader2 className="size-4 animate-spin" /> Loading environments…
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex max-w-2xl flex-col gap-8 p-8">
      <header className="space-y-1">
        <h2 className="text-foreground text-xl font-semibold tracking-tight">Environments</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Every computer that participates in your Den. Rename a machine to something friendlier,
          fold a duplicate into the right one, or retire a computer you no longer use. Who changed
          what is read live from your Den’s history — never stored here.
        </p>
      </header>

      {error ? (
        <p className="text-dd-red-400 text-xs" role="alert">
          {error}
        </p>
      ) : null}

      {/* The registry list — one row per environment (design: settings.md "Environments"). */}
      <div className="border-border bg-card divide-border divide-y rounded-lg border">
        {environments.map((env) => (
          <EnvironmentRow
            key={env.id}
            env={env}
            busy={busy}
            editing={editingId === env.id}
            draft={draft}
            // Reassign needs at least one OTHER environment to fold into.
            canReassign={environments.length > 1}
            onStartRename={() => {
              setDraft(env.label)
              setEditingId(env.id)
            }}
            onCancelRename={() => setEditingId(null)}
            onDraftChange={setDraft}
            onSubmitRename={() => void rename(draft)}
            onReassign={() => setReassigning(env)}
            onRetire={() => setRetiring(env)}
          />
        ))}
      </div>

      {/* Retire — Destructive confirm (drops the entry from the synced registry). */}
      <ConfirmDialog
        open={retiring !== null}
        onOpenChange={(open) => {
          if (!open) setRetiring(null)
        }}
        tone="destructive"
        title={`Retire ${retiring?.label ?? 'this environment'}?`}
        body={
          <>
            This removes <span className="text-foreground font-medium">{retiring?.label}</span> from
            your Den’s list of environments. Your Den’s history stays intact — anything this
            computer committed in the past is still there. If this computer comes back online and
            syncs, it will reappear. Use this for a machine you’ve decommissioned.
          </>
        }
        confirmLabel="Retire environment"
        confirmDisabled={busy}
        onConfirm={() => {
          if (retiring) void retire(retiring.id)
        }}
      />

      {/* Reassign — fold this (duplicate) environment INTO another. The user picks the keeper. */}
      {reassigning ? (
        <ReassignDialog
          duplicate={reassigning}
          targets={environments.filter((e) => e.id !== reassigning.id)}
          busy={busy}
          onCancel={() => setReassigning(null)}
          onConfirm={(intoId) => void reassign(reassigning.id, intoId)}
        />
      ) : null}
    </div>
  )
}

/** One environment row: label (inline-editable), OS, status Pill, last-active line, and a ⋯ menu. */
function EnvironmentRow({
  env,
  busy,
  editing,
  draft,
  canReassign,
  onStartRename,
  onCancelRename,
  onDraftChange,
  onSubmitRename,
  onReassign,
  onRetire,
}: {
  env: EnvironmentWithAttribution
  busy: boolean
  editing: boolean
  draft: string
  canReassign: boolean
  onStartRename: () => void
  onCancelRename: () => void
  onDraftChange: (value: string) => void
  onSubmitRename: () => void
  onReassign: () => void
  onRetire: () => void
}) {
  const status = statusOf(env)
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <Monitor className="text-muted-foreground size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault()
              onSubmitRename()
            }}
          >
            <input
              autoFocus
              className="border-input bg-background text-foreground min-w-0 flex-1 rounded border px-2 py-1 text-sm"
              value={draft}
              disabled={busy}
              aria-label="Environment label"
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onCancelRename()
              }}
            />
            <button
              type="submit"
              className="text-foreground hover:text-dd-ember-500 p-1"
              disabled={busy || !draft.trim()}
              aria-label="Save label"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground p-1"
              onClick={onCancelRename}
              aria-label="Cancel rename"
            >
              <X className="size-3.5" />
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-foreground truncate text-sm font-medium">{env.label}</span>
            <span className="text-muted-foreground text-xs">· {env.os}</span>
          </div>
        )}
        {/* Attribution derived from git log on read — never stored in the registry (ADR 0024). */}
        {!editing ? (
          <span className="text-muted-foreground block text-xs">
            {env.attribution.lastActivityAt
              ? `Last active ${new Date(env.attribution.lastActivityAt).toLocaleString()} · ${env.attribution.commitCount} commit${env.attribution.commitCount === 1 ? '' : 's'}`
              : 'No activity yet'}
          </span>
        ) : null}
      </div>

      {/* Status Pill — a presentation join over git-log attribution, never a persisted field. */}
      <span
        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}
      >
        {status.label}
      </span>

      {/* The ⋯ menu — Rename / Reassign / Retire (reassign+retire per the design spec). */}
      <Menu.Root>
        <Menu.Trigger
          className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-1 disabled:opacity-50"
          disabled={busy || editing}
          aria-label={`Actions for ${env.label}`}
        >
          <MoreHorizontal className="size-4" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
            <Menu.Popup className="border-border bg-popover text-popover-foreground min-w-44 rounded-md border p-1 shadow-lg">
              <Menu.Item
                className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none select-none"
                onClick={onStartRename}
              >
                <Pencil className="size-3.5" /> Rename…
              </Menu.Item>
              <Menu.Item
                className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                disabled={!canReassign}
                onClick={onReassign}
              >
                <Shuffle className="size-3.5" /> Reassign / merge…
              </Menu.Item>
              <Menu.Separator className="bg-border my-1 h-px" />
              {/* Retire reads destructive (red) + is separated from the safe actions above. */}
              <Menu.Item
                className="text-dd-red-400 hover:bg-dd-red-950 flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                disabled={env.isSelf}
                onClick={onRetire}
              >
                <Trash2 className="size-3.5" /> Retire…
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  )
}

/**
 * The Reassign/merge target-picker — choose WHICH environment this duplicate folds into. dotden
 * never auto-merges (ADR 0024): the user explicitly picks the keeper. The keeper inherits the union
 * of both subscriptions; the duplicate is then dropped. Built on the same Default-tone confirm
 * pattern (this is a registry fix, not a destruction — the files on disk are untouched).
 */
function ReassignDialog({
  duplicate,
  targets,
  busy,
  onCancel,
  onConfirm,
}: {
  duplicate: EnvironmentWithAttribution
  targets: readonly EnvironmentWithAttribution[]
  busy: boolean
  onCancel: () => void
  onConfirm: (intoId: string) => void
}) {
  const [intoId, setIntoId] = useState<string>(targets[0]?.id ?? '')
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      tone="default"
      badge={<Shuffle className="size-5" />}
      title={`Reassign ${duplicate.label}`}
      body={
        <div className="space-y-3">
          <p>
            Fold <span className="text-foreground font-medium">{duplicate.label}</span> into the
            correct environment. The kept environment will subscribe to everything both of them
            subscribed to, and{' '}
            <span className="text-foreground font-medium">{duplicate.label}</span> will be removed
            from the list. Nothing on disk changes — this only fixes a duplicate entry.
          </p>
          <label className="block">
            <span className="text-foreground mb-1 block text-xs font-medium">Keep this one</span>
            <select
              className="border-input bg-background text-foreground w-full rounded border px-2 py-1.5 text-sm"
              value={intoId}
              disabled={busy}
              aria-label="Environment to keep"
              onChange={(event) => setIntoId(event.target.value)}
            >
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label} · {target.os}
                </option>
              ))}
            </select>
          </label>
        </div>
      }
      confirmLabel="Reassign"
      confirmDisabled={busy || !intoId}
      onConfirm={() => {
        if (intoId) onConfirm(intoId)
      }}
    />
  )
}

/** Derive the row's status Pill from git-log attribution — a presentation join, never persisted. */
function statusOf(env: EnvironmentWithAttribution): { label: string; className: string } {
  // The machine you are using right now — ember, the sole interactive/identity hue.
  if (env.isSelf)
    return { label: 'This environment', className: 'bg-dd-ember-950 text-dd-ember-400' }
  // Any git-log activity reads as a live, participating environment — green (functional status).
  if (env.attribution.commitCount > 0) {
    return { label: 'Active', className: 'bg-dd-green-950 text-dd-green-400' }
  }
  // Registered but never committed here — muted, so it never reads as a problem.
  return { label: 'No activity', className: 'bg-dd-ink-850 text-dd-ink-300' }
}

/** Pull a human message off an unknown thrown value, falling back to `fallback`. */
function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback
}
