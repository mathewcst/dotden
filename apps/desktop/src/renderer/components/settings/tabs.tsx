/**
 * Settings tab registry — the ONE list every Settings tab registers in (issue 2-08).
 *
 * The SettingsShell renders its nav rail and its content area straight from this array, so a
 * later tab slice (Commit 2-09, Appearance 2-10, Account 2-11, Automation 2-12, Privacy 2-14,
 * Environments 2-15, About 2-16) lands with **minimal churn**: add a `SettingsContent/*` file,
 * append one
 * {@link SettingsTab} entry here, flip its `status` to `'live'`, and it appears — wired, routed,
 * and nav-listed — without touching the shell. That is the "clean extensible tab registry"
 * the issue asks for: the shell knows nothing tab-specific; this list is the single seam.
 *
 * The seven v1 tabs (design: screens/settings.md) are declared up front so the rail's SHAPE is
 * fixed and stable — but only the ones whose slice has shipped are `'live'`. The rest render as
 * **inert/disabled placeholders** (greyed, non-clickable) that light up as their slices land, so
 * the demoable surface is honestly "shell + working Sync tab", never a rail advertising six
 * unbuilt tabs (never fail silently / never promise UI that does not exist).
 */
import type { ComponentType } from 'react'
import {
  ArrowDownUp,
  Cloud,
  GitBranch,
  GitCommitHorizontal,
  Info,
  Monitor,
  Palette,
  Shield,
  type LucideIcon,
} from 'lucide-react'
import { SyncTab } from './SyncTab'
import { CommitTab } from './CommitTab'
import { AppearanceTab } from './AppearanceTab'
import { PrivacyTab } from './PrivacyTab'
import { AboutTab } from './AboutTab'

/** A tab's lifecycle: `live` = built + selectable; `placeholder` = inert until its slice ships. */
export type SettingsTabStatus = 'live' | 'placeholder'

/** One registered Settings tab — its nav metadata plus (when live) the content to render. */
export interface SettingsTab {
  /** Stable id, also the route key the shell tracks for the active tab. */
  readonly id: string
  /** Nav-rail label (dotden vocabulary; design: settings.md "The 7 tabs"). */
  readonly label: string
  /** Lucide nav icon (the per-tab glyph the spec fixes for each tab). */
  readonly icon: LucideIcon
  /** Whether this tab is built (`live`) or a disabled placeholder (`placeholder`). */
  readonly status: SettingsTabStatus
  /**
   * The content component swapped into the shell's content area when this tab is active. Present
   * only for `live` tabs; a `placeholder` has none (the shell renders the inert empty-state copy).
   */
  readonly Content?: ComponentType
}

/**
 * The seven v1 Settings tabs, in nav order (design: settings.md). Sync (2-08), Commit (2-09),
 * Appearance (2-10), Privacy (2-14), and About (2-16) are `live`; every remaining tab is a
 * `placeholder` whose slice flips it to `live` later. Icons match the spec's per-tab nav glyphs.
 */
export const SETTINGS_TABS: readonly SettingsTab[] = [
  // Automation (2-12): the risk-graded ladder. Inert until that slice ships.
  { id: 'automation', label: 'Automation', icon: ArrowDownUp, status: 'placeholder' },
  // Commit (2-09): the commit-message template editor — edit + variables + live preview + reset.
  { id: 'commit', label: 'Commit', icon: GitCommitHorizontal, status: 'live', Content: CommitTab },
  // Appearance (2-10): theme + default Apply/notification preferences (story 54's two remaining
  // synced settings). Extends Settings consistently with the design system (no dedicated Figma tab).
  { id: 'appearance', label: 'Appearance', icon: Palette, status: 'live', Content: AppearanceTab },
  // Sync (2-08): the first real tab — poller on/off + cadence, start-on-login.
  { id: 'sync', label: 'Sync', icon: Cloud, status: 'live', Content: SyncTab },
  // Account / Remote (2-11): connected Remote + git-credential + detected PM CLI. Inert for now.
  { id: 'account', label: 'Account', icon: GitBranch, status: 'placeholder' },
  // Privacy (2-14): opt-in telemetry consent toggles (analytics · crash reports · diagnostic
  // logs), all OFF by default. Control surface only — persists consent; egress is PRD 3.
  { id: 'privacy', label: 'Privacy', icon: Shield, status: 'live', Content: PrivacyTab },
  // Environments (2-15): the registry + claim/reassign/retire lifecycle. Inert for now.
  { id: 'environments', label: 'Environments', icon: Monitor, status: 'placeholder' },
  // About (2-16): version + honest update-check affordance + chezmoi credit (faithful-wrapper
  // acknowledgement, ADR 0003). The real update engine is PRD 3 (issue 3-20); this surfaces only.
  { id: 'about', label: 'About', icon: Info, status: 'live', Content: AboutTab },
]

/**
 * The id of the first `live` tab — the SettingsShell opens here by default (currently Sync).
 *
 * The registry always contains at least one live tab (Sync), so the find never returns
 * undefined; `'sync'` is the typed fallback purely to satisfy `noUncheckedIndexedAccess`.
 */
export const DEFAULT_SETTINGS_TAB_ID: string =
  SETTINGS_TABS.find((tab) => tab.status === 'live')?.id ?? 'sync'
