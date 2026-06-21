import { useEffect, useRef, useState } from 'react'
import { GitCommitHorizontal, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/ui/button'
import {
  COMMIT_TEMPLATE_VARIABLES,
  DEFAULT_COMMIT_MESSAGE_TEMPLATE,
  renderCommitTemplate,
  type CommitTemplateData,
} from '../../../../shared/commit-template'

/**
 * CommitTab — the Settings → Commit tab (issue 2-09, stories 34–36; design: screens/settings.md
 * "Commit").
 *
 * Lets the user author the message every **Commit** carries — mapping to chezmoi's
 * `git.commitMessageTemplate` so their `git log` reads the way they want. It surfaces:
 *
 * - a **mono editor** for the template text (`[$os-sync-$year-$month-$day]` by default);
 * - the closed set of **insertable variable chips** ({@link COMMIT_TEMPLATE_VARIABLES}) — clicking
 *   one inserts its `$token` at the cursor, with a `Kbd`-style hint of each variable's meaning;
 * - a **live preview** that renders the current template exactly as a real Commit would, so the
 *   user sees the result as they type;
 * - a one-click **Reset to default** that restores `[$os-sync-$year-$month-$day]`.
 *
 * The template is **user-authored organization-of-presentation**, so it syncs as a default through
 * `.dotden/` (ADR 0024); saving Commits the change LOCALLY (ADR 0006) and it travels on the next Sync.
 *
 * **No shell reachable from the renderer (the load-bearing privacy rule, scope-v1):** the preview
 * is rendered by the SHARED pure {@link renderCommitTemplate} — the same function the real Commit
 * message uses. `$os`/`$arch`/`$hostname` come from chezmoi template data fetched once over IPC
 * ({@link window.dotden.den.commitTemplate}); `$year`…`$time` come from the **app runtime clock**
 * (`new Date()`), never an OS `date` command. The renderer never shells out.
 *
 * Saving is optimistic-then-authoritative, mirroring the Sync tab: edits flip the field
 * immediately; Save writes via IPC and re-renders from the returned source of truth; a failed write
 * surfaces an inline error and never fails silently.
 */
export function CommitTab() {
  // The persisted (last-saved) template + the chezmoi-sourced preview facts, loaded once.
  const [data, setData] = useState<CommitTemplateData | null>(null)
  const [environment, setEnvironment] = useState('')
  const [savedTemplate, setSavedTemplate] = useState<string | null>(null)
  // The in-progress edit (what the editor + preview show); diverges from `savedTemplate` while dirty.
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  // A single clock instant for the preview's date/time fields. Captured ONCE on mount (lazy state
  // initializer, not per-render) so the preview is stable while editing — it is the **app runtime
  // clock**, the cross-OS-safe date/time source (never an OS `date` command), and is illustrative
  // rather than a live ticking clock.
  const [previewNow] = useState(() => new Date())

  // Load this environment's current template + the preview facts (os/arch/hostname/label) once.
  useEffect(() => {
    let alive = true
    window.dotden.den
      .commitTemplate()
      .then((state) => {
        if (!alive) return
        setSavedTemplate(state.template)
        setDraft(state.template)
        setData(state.data)
        setEnvironment(state.environment)
      })
      .catch((caught: unknown) => {
        if (alive) setError(messageOf(caught, 'Could not load your commit-message template.'))
      })
    return () => {
      alive = false
    }
  }, [])

  /** Persist `next` as the template, adopting the returned state as the new source of truth. */
  async function save(next: string) {
    setSaving(true)
    setError(null)
    try {
      const state = await window.dotden.den.setCommitTemplate(next)
      setSavedTemplate(state.template)
      setDraft(state.template)
      setData(state.data)
      setEnvironment(state.environment)
    } catch (caught) {
      setError(messageOf(caught, 'Could not save your commit-message template.'))
    } finally {
      setSaving(false)
    }
  }

  /** Insert a `$variable` token at the editor's caret (or append when it isn't focused). */
  function insertVariable(name: string) {
    const token = `$${name}`
    const field = editorRef.current
    if (!field) {
      setDraft((current) => current + token)
      return
    }
    const start = field.selectionStart ?? draft.length
    const end = field.selectionEnd ?? draft.length
    const next = draft.slice(0, start) + token + draft.slice(end)
    setDraft(next)
    // Restore focus + place the caret right after the inserted token (next paint).
    requestAnimationFrame(() => {
      field.focus()
      const caret = start + token.length
      field.setSelectionRange(caret, caret)
    })
  }

  if (savedTemplate === null || !data) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-8 text-sm">
        {error ? (
          <span className="text-dd-red-400" role="alert">
            {error}
          </span>
        ) : (
          <>
            <Loader2 className="size-4 animate-spin" /> Loading commit template…
          </>
        )}
      </div>
    )
  }

  // The live preview — rendered by the SAME pure function the real Commit message uses, with
  // chezmoi-sourced os/arch/hostname + the app clock (never a shell). `fileCount: 1` is the
  // single-File illustration the design's sample preview uses.
  const preview = renderCommitTemplate(draft, {
    data,
    environment,
    fileCount: 1,
    now: previewNow,
  })
  const dirty = draft !== savedTemplate
  const isDefault = draft === DEFAULT_COMMIT_MESSAGE_TEMPLATE

  return (
    <div className="flex max-w-2xl flex-col gap-8 p-8">
      <header className="space-y-1">
        <h2 className="text-foreground text-xl font-semibold tracking-tight">Commit message</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          How each save reads in your history. dotden writes this for every{' '}
          <span className="text-foreground font-medium">Commit</span>; edit it to taste. This is a{' '}
          <span className="text-foreground font-medium">shared default</span> — it syncs to your
          other computers.
        </p>
      </header>

      {error ? (
        <p className="text-dd-red-400 text-xs" role="alert">
          {error}
        </p>
      ) : null}

      {/* The mono editor (design: settings.md "Commit" — mono field + Reset to default). */}
      <div className="space-y-2">
        <label htmlFor="commit-template" className="text-foreground block text-sm font-medium">
          Template
        </label>
        <textarea
          id="commit-template"
          ref={editorRef}
          value={draft}
          spellCheck={false}
          rows={2}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          className="border-border bg-background text-foreground focus-visible:outline-ring w-full resize-y rounded-md border px-3 py-2 font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
        />
      </div>

      {/* Insertable variable chips (design: settings.md "Commit" — variable Kbd chips). Each chip
          inserts its $token at the caret; the hint explains where the value comes from. */}
      <div className="space-y-2">
        <p className="text-foreground text-sm font-medium">Variables</p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Click to insert. <span className="text-foreground font-medium">os</span>,{' '}
          <span className="text-foreground font-medium">arch</span> and{' '}
          <span className="text-foreground font-medium">hostname</span> come from chezmoi; the date
          and time come from this computer’s clock.
        </p>
        <div className="flex flex-wrap gap-2">
          {COMMIT_TEMPLATE_VARIABLES.map((variable) => (
            <button
              key={variable.name}
              type="button"
              disabled={saving}
              title={variable.description}
              onClick={() => insertVariable(variable.name)}
              className="border-border bg-secondary/40 text-foreground hover:border-dd-ember-700 hover:bg-dd-ember-950 inline-flex items-center rounded-md border px-2 py-1 font-mono text-xs transition-colors disabled:opacity-50"
            >
              ${variable.name}
            </button>
          ))}
        </div>
      </div>

      {/* Live preview — rendered by the shared pure renderer (no shell), exactly like a real Commit. */}
      <div className="border-dd-ember-900 bg-dd-ember-950 flex items-start gap-3 rounded-lg border p-4">
        <GitCommitHorizontal className="text-dd-ember-400 mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="text-foreground text-sm font-medium">Preview</p>
          <p className="text-foreground font-mono text-xs break-all">{preview}</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            What your next Commit message will look like.
          </p>
        </div>
      </div>

      {/* Save + Reset (design: settings.md "Commit" — Reset to default). */}
      <div className="flex items-center gap-3">
        <Button type="button" disabled={saving || !dirty} onClick={() => void save(draft)}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={saving || isDefault}
          onClick={() => setDraft(DEFAULT_COMMIT_MESSAGE_TEMPLATE)}
        >
          <RotateCcw className="size-4" />
          Reset to default
        </Button>
        {dirty ? <span className="text-muted-foreground text-xs">Unsaved changes</span> : null}
      </div>
    </div>
  )
}

/** Pull a human message off an unknown thrown value, falling back to `fallback`. */
function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback
}
