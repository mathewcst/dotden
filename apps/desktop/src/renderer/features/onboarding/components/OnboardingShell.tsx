import { useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleCheck,
  GitCommitVertical,
  Loader2,
  Lock,
  RefreshCw,
} from 'lucide-react'
import {
  WindowControls,
  windowDragRegionStyle,
  type WindowControlsPlatform,
} from '@/shared/components/WindowControls'
import { Button } from '@/ui/button'
import { OnboardingMenu } from './OnboardingMenu'
import { OBConnectUrl } from './OBConnectUrl'
import { OBDiscover } from './OBDiscover'
import { nextStep, type OnboardingStep } from '../lib/steps'
import type { CommitResult } from '@shared/den'

/**
 * OnboardingShell — the window chrome + step router for the V1-Lean first-run flow
 * (design: onboarding.md; Figma `OnboardingShell`).
 *
 * Composes a fixed {@link OnboardingMenu} rail on the left with a content slot on the
 * right that swaps per step (Welcome → Create your repo → Connect → Discover → First
 * commit → Auto-sync → Done). The flow is a faithful chezmoi wrapper end to end:
 * Connect reuses the 1-03 RemoteClient (`chezmoi init`), Discover scans + Tracks via
 * the 1-04 path (`chezmoi add`), First commit Commits + Syncs (`git commit`/`push`).
 *
 * It owns only the **step + cross-step data** (the Tracked paths, the Commit result).
 * Each step's own concern lives in its `OB*` component. On the Done step the user
 * enters the main app via {@link onComplete}, so the App router can show the Workspace.
 *
 * @param onComplete Called when onboarding finishes (the user clicks into the app),
 *   so the top-level router leaves the onboarding gate.
 */
export function OnboardingShell({
  onComplete,
  onExistingDen,
}: {
  onComplete: () => void
  onExistingDen: () => void
}) {
  const [step, setStep] = useState<OnboardingStep>('welcome')
  const [trackedPaths, setTrackedPaths] = useState<readonly string[]>([])
  const [commit, setCommit] = useState<CommitResult | null>(null)
  // The Auto-sync opt-in (issue 1-12): the checkbox state, persisted to the environment-
  // local automation level when the user finishes this step. Auto-sync auto-pushes
  // Committed changes and notifies on incoming; Apply always stays a manual review.
  const [autoSync, setAutoSync] = useState(false)
  const [busy, setBusy] = useState<null | 'commit' | 'sync' | 'auto-sync' | 'finish'>(null)
  const [error, setError] = useState<string | null>(null)
  const isMac = window.dotden.platform === 'darwin'
  const controlsPlatform: WindowControlsPlatform =
    window.dotden.platform === 'win32' ? 'win32' : 'linux'

  const advance = () => setStep((current) => nextStep(current))

  // Persist the Auto-sync opt-in (issue 1-12) THEN advance. Manual is the default, so an
  // unchecked box explicitly records `manual` (idempotent). A failure to save must not
  // trap the user in onboarding — surface it but still advance (never fail silently, but
  // never block finishing setup over a settings write).
  async function finishAutoSync() {
    setBusy('auto-sync')
    setError(null)
    try {
      await window.dotden.automation.setLevel(autoSync ? 'auto-sync' : 'manual')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your Auto-sync choice.')
    } finally {
      setBusy(null)
      advance()
    }
  }

  async function finishSetup() {
    setBusy('finish')
    setError(null)
    try {
      await window.dotden.den.registerEnvironment()
      onComplete()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Finishing setup failed.')
    } finally {
      setBusy(null)
    }
  }

  // First-commit: Commit the Tracked Files (LOCAL until pushed) then Sync push.
  async function commitAndSync() {
    setBusy('commit')
    setError(null)
    try {
      const result = await window.dotden.den.commit(trackedPaths)
      setCommit(result)
      setBusy('sync')
      await window.dotden.den.syncPush()
      advance()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Committing your Den failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="bg-background text-foreground grid h-screen grid-rows-[40px_1fr]">
      <OnboardingTitleBar isMac={isMac} controlsPlatform={controlsPlatform} />

      <div className="grid min-h-0 grid-cols-[auto_1fr]">
        <OnboardingMenu current={step} />

        {/* Content slot — swaps per step; scrolls within the window body. */}
        <main className="flex min-h-0 flex-col overflow-auto px-12 py-10">
          {step === 'welcome' ? (
            <div className="flex max-w-xl flex-col gap-6">
              <header className="space-y-3">
                <h1 className="text-foreground text-3xl font-semibold tracking-tight">
                  Welcome to dotden
                </h1>
                <p className="text-muted-foreground leading-relaxed">
                  dotden keeps your configs — your Den — in sync across every computer you work on,
                  through a private git repo you own. The loop is simple:
                </p>
              </header>
              <ol className="text-muted-foreground grid gap-3 text-sm">
                <li className="flex items-start gap-3">
                  <span className="bg-dd-ember-950 text-dd-ember-400 grid size-6 place-items-center rounded-full text-xs font-semibold">
                    1
                  </span>
                  <span>
                    <span className="text-foreground font-medium">Track</span> the config Files you
                    want to manage.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="bg-dd-ember-950 text-dd-ember-400 grid size-6 place-items-center rounded-full text-xs font-semibold">
                    2
                  </span>
                  <span>
                    <span className="text-foreground font-medium">Commit</span> them, then{' '}
                    <span className="text-foreground font-medium">Sync</span> to your repo.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="bg-dd-ember-950 text-dd-ember-400 grid size-6 place-items-center rounded-full text-xs font-semibold">
                    3
                  </span>
                  <span>
                    On your next computer,{' '}
                    <span className="text-foreground font-medium">Apply</span> them — your setup,
                    everywhere.
                  </span>
                </li>
              </ol>
              <div>
                <Button onClick={advance}>
                  Get started <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}

          {step === 'create-repo' ? (
            <div className="flex max-w-xl flex-col gap-6">
              <header className="space-y-2">
                <h1 className="text-foreground text-2xl font-semibold tracking-tight">
                  Create your repo
                </h1>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  dotden syncs through a{' '}
                  <span className="text-foreground font-medium">private git repo you own</span> — on
                  GitHub, GitLab, Bitbucket, a self-hosted instance, or a bare SSH remote. Create an{' '}
                  <span className="text-foreground font-medium">empty private repo</span> now;
                  you’ll paste its URL next.
                </p>
              </header>
              <div className="bg-dd-ember-950 text-dd-ember-300 flex items-start gap-2 rounded-md p-3 text-xs">
                <Lock className="mt-0.5 size-4 shrink-0" />
                <span>
                  Keep it <span className="font-medium">private</span> — your Den can hold secrets,
                  and a private repo is what keeps them yours.
                </span>
              </div>
              <details className="text-muted-foreground text-sm">
                <summary className="hover:text-foreground flex cursor-pointer items-center gap-1">
                  <ChevronRight className="size-4" /> How do I create a repo?
                </summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed">
                  <li>Open your git Provider and create a new repository.</li>
                  <li>Make it private and leave it empty (no README, no .gitignore).</li>
                  <li>Copy its clone URL (HTTPS or SSH).</li>
                </ol>
              </details>
              <div>
                <Button onClick={advance}>
                  I’ve created it <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}

          {step === 'connect' ? (
            <div className="flex flex-col gap-4">
              <OBConnectUrl
                onCancel={() => setError(null)}
                onConnected={(result) => {
                  setError(null)
                  if (result.repositoryKind === 'dotden') {
                    onExistingDen()
                    return
                  }
                  if (result.repositoryKind === 'foreign-chezmoi') {
                    setError(
                      'This repo already has a chezmoi setup. Full adoption is coming later; connect an empty repo for now.',
                    )
                    return
                  }
                  advance()
                }}
              />
              {error ? (
                <p className="text-dd-red-400 text-xs" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 'discover' ? (
            <OBDiscover
              onTracked={(paths) => {
                setTrackedPaths(paths)
                advance()
              }}
            />
          ) : null}

          {step === 'commit' ? (
            <div className="flex max-w-xl flex-col gap-6">
              <header className="space-y-2">
                <h1 className="text-foreground text-2xl font-semibold tracking-tight">
                  Make your first commit
                </h1>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {trackedPaths.length > 0
                    ? `Record your ${trackedPaths.length} tracked File${trackedPaths.length === 1 ? '' : 's'} into your Den and Sync them to your repo. A Commit stays local until you Sync.`
                    : 'You didn’t track any Files yet — you can do this any time from the app. Continue to finish setup.'}
                </p>
              </header>
              {trackedPaths.length > 0 ? (
                <ul className="border-border bg-card grid gap-1 rounded-md border p-3 text-xs">
                  {trackedPaths.map((path) => (
                    <li key={path} className="text-muted-foreground flex items-center gap-2">
                      <Check className="text-dd-green-400 size-3.5" />
                      <span className="font-mono">{path}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {error ? (
                <p className="text-dd-red-400 text-xs" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="flex items-center gap-3">
                {trackedPaths.length > 0 ? (
                  <Button disabled={busy !== null} onClick={() => void commitAndSync()}>
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <GitCommitVertical className="size-4" />
                    )}
                    {busy === 'sync' ? 'Syncing…' : 'Commit & Sync'}
                  </Button>
                ) : (
                  <Button onClick={advance}>
                    Continue <ArrowRight className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          ) : null}

          {step === 'auto-sync' ? (
            <div className="flex max-w-xl flex-col gap-6">
              <header className="space-y-2">
                <h1 className="text-foreground text-2xl font-semibold tracking-tight">
                  Keep it in sync
                </h1>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Turn on <span className="text-foreground font-medium">Auto-sync</span> to
                  automatically send your Committed changes and get notified about incoming ones.
                  Applying changes always stays a manual review.
                </p>
              </header>
              {/* The Auto-sync opt-in (issue 1-12): the choice is persisted to the
                environment-local automation level when the user clicks finish. */}
              <label className="border-border bg-card flex cursor-pointer items-start gap-3 rounded-md border p-4 text-sm">
                <input
                  type="checkbox"
                  className="accent-dd-ember-500 mt-0.5 size-4"
                  checked={autoSync}
                  onChange={(event) => setAutoSync(event.target.checked)}
                />
                <span>
                  <span className="text-foreground font-medium">Enable Auto-sync</span>
                  <span className="text-muted-foreground block text-xs">
                    Sends Committed changes automatically and notifies you about incoming ones.
                    Applying always stays a manual review. Change this any time in Settings.
                  </span>
                </span>
              </label>
              {error ? (
                <p className="text-dd-red-400 text-xs" role="alert">
                  {error}
                </p>
              ) : null}
              <div>
                <Button disabled={busy !== null} onClick={() => void finishAutoSync()}>
                  {busy === 'auto-sync' ? <Loader2 className="size-4 animate-spin" /> : null}
                  {autoSync ? 'Enable & finish' : 'Finish setup'} <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}

          {step === 'done' ? (
            <div className="flex max-w-xl flex-col gap-6">
              <CircleCheck className="text-dd-green-400 size-12" />
              <header className="space-y-2">
                <h1 className="text-foreground text-3xl font-semibold tracking-tight">
                  Your Den is set up
                </h1>
                <p className="text-muted-foreground leading-relaxed">
                  {commit
                    ? 'Your configs are committed and synced to your repo.'
                    : 'Your repo is connected and ready.'}{' '}
                  From here you can Track more Files, review incoming changes, and manage your
                  Workspaces.
                </p>
              </header>
              <ul className="text-muted-foreground grid gap-2 text-sm">
                <li className="flex items-center gap-2">
                  <RefreshCw className="text-dd-ember-400 size-4" /> On your next computer, connect
                  the same repo to Apply your Den there.
                </li>
                {autoSync ? (
                  <li className="flex items-center gap-2">
                    <Check className="text-dd-green-400 size-4" /> Auto-sync is on — Committed
                    changes send automatically.
                  </li>
                ) : null}
              </ul>
              <div>
                <Button disabled={busy !== null} onClick={() => void finishSetup()}>
                  {busy === 'finish' ? <Loader2 className="size-4 animate-spin" /> : null}
                  Open dotden <ArrowRight className="size-4" />
                </Button>
              </div>
              {error ? (
                <p className="text-dd-red-400 text-xs" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
}

function OnboardingTitleBar({
  isMac,
  controlsPlatform,
}: {
  isMac: boolean
  controlsPlatform: WindowControlsPlatform
}) {
  return (
    <header
      className="border-border bg-sidebar flex h-10 items-center border-b px-3"
      style={windowDragRegionStyle}
    >
      {isMac ? <WindowControls platform="darwin" /> : null}
      <div className="h-px flex-1" />
      {!isMac ? <WindowControls platform={controlsPlatform} className="-mr-3 h-10" /> : null}
    </header>
  )
}
