# Components

> The catalog of local, token-bound Figma component sets (Figma page `02 · Components — App`),
> mirroring shadcn anatomy — plus the `AppShell` + default panes that scaffold every main-app
> screen. Part of the [design system](./README.md); colors come from
> [color-tokens.md](./color-tokens.md), build rules from
> [figma-conventions.md](./figma-conventions.md).

## Component API conventions (variants · slots · swap · variables)

> The rule for how a component exposes its API. Decided 2026-06-14.

- **Variants** — structural / state change: size, kind, layout, **state**
  (`Default|Selected|Disabled`), and **semantic color tone as a `Tone` axis** where each variant
  _binds a different token_ (`StatusDot`/`Pill`/`Toast`/`Banner` already do this — it's correct, keep
  it).
- **Native slots** — _arbitrary / heterogeneous / empty-able / multi-child_ content holes (the slot vs
  swap policy lives in [figma-conventions.md](./figma-conventions.md)).
- **`INSTANCE_SWAP`** — picking **one homogeneous sub-component** only: icon glyphs, avatars.
- **Booleans / text props** — optional bits (a subtitle on/off, a trailing tag on/off).
- **Discipline:** lean toward _fewer variants, more booleans/slots_ (variants multiply
  combinatorially; the others don't). **Cap a set at ~30 variant combinations** — past that, split the
  component or move an axis to a boolean/slot.

**No "color-variable property."** Figma can bind a variable only to a _variant_ property — you cannot
expose a raw color variable as a per-instance overridable knob. Don't design around one.

**Why not variable _modes_ for tone?** Modes _can_ recolor a component by switching its Appearance
mode (the "gray button → orange button, text → black" demo) — that's real. We deliberately **don't**
use modes for semantic tone because: (1) we're **dark-only**, single-mode — modes are our theming slot
and we don't theme; (2) mode count is **plan-limited** (Professional ≈ 4 modes/collection; our 6
semantic tones would overflow); (3) a Green vs Red `StatusDot` is a different _semantic meaning_ — a
**variant** — not the same element re-themed by _context_, which is what modes model. **Modes stay
reserved for true theming (which we don't have); semantic tone is a `Tone` variant axis.**

## Naming convention (decided 2026-06-14)

- **Public components: PascalCase** — `Button`, `Input`, `SelectRow`, `Dialog`.
- **`/` only to group a genuine multi-member _family_ into an Assets-panel folder**, syntax **without
  spaces** (`AppPane/Diff`, `OBContent/Welcome`, `Lucide Icon / ChevronRight`) — spaces around the slash are
  wrong. Never `/` on a one-off component.
- **`_`-prefix** reserved for genuinely _internal_ sub-components (per Figma's library skill).
- **Different layouts = different components, never variants.** `AppPane/Diff` and `AppPane/Workspaces`
  are separate components in the `AppPane/` folder — NOT a `Pane=` variant axis (variants are for
  states/sizes of the _same_ layout). Same for `OBContent/*`. (Rejected a "collapse to variant"
  proposal on this basis.)
- **Deviation note:** Figma's `figma-generate-library` skill prefers bare-PascalCase-no-slashes for
  public components; we keep `/` family folders because they're a first-class Figma **product** feature
  (Assets-panel folders) that aids picking panes/content when filling `AppShell`/`OnboardingShell`
  slots. Justified, documented.
- **Normalized 2026-06-14 (M2):** `AppPane / *` → `AppPane/*` (8 renamed; node identity + instances
  preserved). `OBContent/*` (10) and `Icon/*` were already space-free — verified, no change needed.

## In-canvas documentation (decided 2026-06-14)

Markdown (`docs/design-system/`) is the **source of truth** — written for agents, version-controlled,
greppable. We deliberately **skip** Figma's per-component doc _frames_ (they'd duplicate the markdown
and drift). The one Figma-native touch we keep: set a **one-line `.description`** on every component
set (surfaces in Dev Mode + the Assets-panel tooltip). We **don't** set `.documentationLinks` — the
repo has no public URL reachable from Figma, so a link would dead-end and confuse. The **Cover page**
(page `00`) is the canvas front-door: a one-liner pointing readers at `docs/design-system/`.

## Row / cell families (✅ consolidated — M4, 2026-06-14)

The single most-repeated shape in the app is "a row." It used to be scattered across 8 bespoke row sets
that drifted (e.g. `RadioRow` radius 10 vs siblings' 8). M4 consolidated them into \*\*two shared families

- two kept singles\**, so identical spacing/color/selection are guaranteed *by construction\*. (Two
  families, not one: bordered-selectable vs borderless-list-line are genuinely different chrome.)

**`SelectRow` (`429:1109`) — carded selectable row** (radio/checkbox choice card):

- Container: `card` fill · 1px `border` · radius **8** · pad 14/16 · gap 12.
- **`State`** variant: `Default | Selected | Disabled`. Selection = full **ember border** (`22:8`);
  Disabled = 0.45 opacity. (Border-selection is the shared language for both radio _and_ checkbox leads.)
  The **Selected** variant's lead is a **checked Radio** (filled ember) — it's _unbound_ from the `Lead`
  swap (which has one shared default, so it can't vary per variant), so Default/Disabled keep the
  swappable unchecked lead while Selected reads as truly selected. _(QA fix 2026-06-14.)_
- **`Lead`** INSTANCE_SWAP (default Radio; swap to Checkbox/Icon) + **`HasLead`** bool · **`Title`** /
  **`Subtitle`** text · **`Trailing`** Pill INSTANCE_SWAP + **`HasTrailing`** bool.
- **Mono subtitle** (e.g. PMOption's `op://` ref) = per-instance font override on the subtitle, _not_ a
  property (font is overridable on instances — keeps the matrix small).
- **Replaced:** `RadioRow`, `PMOption` (radio + Green/Neutral trailing Pill + mono ref),
  `WorkspaceRow` (checkbox lead). The "raw Option/workspace rows" in the old spec turned out to be
  screen-frame instances, not detached rows.

**`ListRow` (`439:1103`) — borderless file/list line:**

- Borderless · tight radius/height · leading **status Lucide icon** + mono `Title` + trailing `Meta`.
- **`State`** variant: `Clean | Conflict | Applied | Incoming | Error | Selected | Warn`. State drives the
  leading glyph + tone (e.g. Conflict/Error = red triangle + red tint; Incoming = blue arrow;
  Applied = green check). **Selected** = `secondary` bg-tint (matches kept `TreeRow` selection);
  **Warn** = amber bg/fg (onboarding's soft-warn).
- **`HasCheckbox`** bool (checkbox lead, for discovery rows) · **`Path2`** + **`HasPath2`** (secondary
  inline path, e.g. `.zshrc ~/.zshrc`) · **`HasMeta`** bool (trailing size/diff).
- **Replaced:** `FileRow` (5 status states), `DiscoverRow` (checkbox + filename + path + size + Warn).

**`SettingsRow` (`676:1324`) — the carded settings-list row** (every `SettingsContent/*` card row is one
instance; added 2026-06-15 to kill the row-height drift class):

- Shared props (exposed on the set): **`HasLead`** + **`Lead`** (16px Lucide swap, muted), **`Title`**,
  **`HasSub`** + **`Sub`**. Height is AUTO (subtitle-less rows hug to ~46; full rows ~64).
- **`Trail`** variant = `None | Switch | Pill | Value | Select | Link | PillButton | PillMenu` — the
  trailing is **baked per variant** (a single `INSTANCE_SWAP` can't host heterogeneous-sized trailing;
  see [figma-conventions](./figma-conventions.md)). Per-row specifics (switch state, pill tone+label,
  button/value text) are nested-instance overrides. `Value`/`Select` use the **`RowValue`** helper
  (`652:1307`) — a hug-width muted text component.
- **Exception:** the Repository **Remote-URL** row stays a bespoke raw row (its git URL is **mono** —
  the standardized `Title` is Geist Medium, so it's deliberately not an instance).

**Kept as their own components (distinct interactions — would be separate in React too):**

- **`TreeRow`** (`53:32`) — disclosure-chevron tree node (Default/Selected).
- **`SidebarItem`** (`53:15`) — sidebar nav item (Default/Active, `sidebar-accent`).

**Stay bespoke (do NOT fold):**

- **`CommitRow`** (`313:790`) — list line by content, but selects via a **2px left-rail** (not bg-tint) +
  carries **2-line meta** (SHA + author) + amber-SHA semantics. Folding it would bloat `ListRow`'s API.
- **`DiffLine` / `DiffLineSplit` / `MergeHunk`** — gutter+sign+code primitive; no wrapper/leading/title.

## Catalog

Local component sets, all token-bound, mirroring shadcn anatomy:

- **Atoms:** `Button` (6 variants × 3 sizes: Primary/Secondary/Outline/Ghost/Destructive/Link ×
  sm/md/lg; `Label` text + **`HasLead`/`Lead` & `HasTrail`/`Trail` slots** that take an icon _or_ a
  `StatusDot`, with the icon stroke bound to the variant's label color — never muted-on-colored),
  `Input` (Default/Focus/Error/Disabled), `Badge`
  (Default/Secondary/Outline/Destructive), `Checkbox`, `Radio`, `Switch`, `Kbd`, `Separator`,
  `Avatar`, `Tab` (Active/Inactive), `Tooltip`.
- **dotden composites:** `StatusTag` (Added/Modified/Deleted/Renamed/Untracked/Incoming/Conflict —
  tinted pill + dot), `IconButton`, `SidebarItem` (Default/Active), `TreeRow` (Default/Selected; per
  instance set indent via `paddingLeft`, status/deco text + fill, swap chevron/file/folder icon).
- **Generic primitives (component-pattern pass):** `StatusDot` (Tone:
  Neutral/Ember/Green/Amber/Red/Blue — the single source for the recurring colored dot; reused as
  `Pill`/`Button` leads and `MergeHunk` side-headers), `Pill` (Tone × `Dot`/`HasIcon` booleans +
  `Label` — the generic tinted status pill behind `CONFLICT`/`RESOLVED`/count badges; **coexists**
  with `StatusTag`, the git-semantic sibling), `FileRow` _(→ folded into `ListRow` in M4, 2026-06-14)_,
  `SearchField` (titlebar command bar: search icon + placeholder + `⌘K`
  `Kbd`).
- **Diff family (component-pattern pass):** `DiffLine` (Kind: Context/Added/Removed/Hunk — the inline
  diff atom: 46px right-aligned gutter + marker + `Mono/Code`, full-width status tint), `DiffLineSplit`
  (Kind: Context/Added/Removed/Modified — two-column old|new split atom), and `MergeHunk`
  (`State=Conflict|Resolved` × **`Layout=Inline|Split`**) as the conflict block, composed from
  `Pill`/`StatusDot`/`Button`. A **Diff family** showcase on page 02 proves all four
  inline/split × clean/conflict combos exist as instances. `FileRow` gained an **`Error`** state in
  Batch E (faint destructive tint + red `alert-triangle`; `Meta` carries the OS write reason) — this
  `Error` state carried over into `ListRow` when `FileRow` was folded in (M4).
- **Overlay primitive (polish pass):** `Toast` (`Tone=Success|Info|Warning|Error`) — elevated
  `popover` surface + `border` + `Shadow/Popover`; `Title`/`Description` TEXT props,
  `HasDescription`/`HasAction`/`HasDismiss` booleans, a nested `Button` Link action + an
  `IconButton`→`x` dismiss. The leading icon is **fixed per tone** (check/bell/alert-triangle, stroke
  bound to `success`/`info`/`warning`/`destructive`) — icons are stroke-based, so a swappable icon
  would drop its tone binding; coupling icon→tone is the deliberate trade. 360px, hug height.
- **Modal primitive (Phase 5 — Batch A):** `Dialog` (`Tone=Default|Destructive`) — centered confirm
  card on a `popover` surface + `border` + `Shadow/LG`, radius `lg`, **440px** wide / hug height.
  `Title` (Sans/Heading) + `Body` (Sans/Body, muted) TEXT props + `HasIcon` BOOL toggling a leading
  icon badge. The icon is **fixed per tone** (Default = `file` stroked `foreground` on a `border`-tint
  badge; Destructive = `alert-triangle` stroked `destructive` on a `dd/red/950` badge) — same
  stroke-based-icon rationale as `Toast`; a shared `INSTANCE_SWAP` icon prop was tried and dropped
  because one swap default can't hold a per-tone glyph. Footer = reused `Button` instances — **Outline
  Cancel** (Outline, _not_ Secondary — `secondary`≡`popover`, so a secondary button would vanish on
  the card) + **Primary/Destructive Confirm**. Screens overlay it with a scrim + a centered instance
  (see [confirm dialogs](./screens/confirm-dialogs.md)).
- **Inline status primitive (Phase 5 — Batch C):** `Banner`
  (`Tone=Syncing|UpToDate|Incoming|Push|Offline|Error`) — a **persistent full-width inline status
  strip**, the counterpart to the transient `Toast`. Tinted `*-bg` surface + a 1px **bottom border** in
  the tone color + a leading icon + `Message` (Sans/Body Medium) + muted `Detail` (Sans/Body Small) +
  an optional trailing `Button` action (**neutral Secondary/sm** — QA 2026-06-14: was ember Primary, but
  an ember button clashed with the blue/amber/red tints, and a status-tinted button would make a
  functional color _interactive_ against the color discipline; neutral keeps the tone reading as status,
  ember as the only interactive hue). Unlike `Toast`, **`Tone` _is_ the whole
  API**: each variant bakes its own icon (`sync`/`check`/`arrow-down`/`git-commit`/`cloud`/
  `alert-triangle`, stroke bound to the tone color — same stroke-based-icon reason as `Toast`/`Dialog`),
  its tone colors, _and_ its default copy. There are deliberately **no shared TEXT/BOOL props** (one
  shared default would force identical copy across every tone — the same lesson as the swap-icon);
  screens override `Message`/`Detail` characters + the action per instance. In `AppShell` screens it's
  inserted between the titlebar and body (vertical auto-layout → the body auto-shrinks, nothing is
  covered). `Offline`/`Error` also feed Batch E. See [sync states](./screens/sync-states.md).
- **History primitives (Phase 5 — Batch D):** `CommitRow` (`State=Default|Selected`) — a **selectable**
  per-File version-list row: a `git-commit` lead (ember-tinted when Selected) + `Message`
  (Sans/Body Medium) over `Sha` (Mono/Label, **amber** — the committed-SHA convention) · `Meta`
  (Sans/Caption, muted) + an optional **`HasTag`** green "Current" `Pill` + a **trailing disclosure
  `chevron-right`** (signals "this row opens a preview"). TEXT props `Message`/`Sha`/`Meta` + BOOL
  `HasTag` carry the row data. **`State=Selected`** is a _loud_ affordance — `secondary` bg + an **ember
  left rail** (`strokeLeftWeight`) + ember commit-dot — so "rows are pickable" reads at rest. The row
  itself carries **no** restore button: restore is a single action in the preview panel (the
  master-detail model below). `AppPane/History` is the Diff pane's **History tab** body, a
  **master-detail** layout: a **scrollable `list-region`** of `CommitRow`s on the base background, a
  **shadcn-style `resize-handle`** (grip on a divider — the split is draggable), and a **fixed
  `preview-panel`** on a raised `card` surface that swaps to the selected version — read-only `DiffLine`
  patch (the `PatchDiff` role; full spec in [file history](./screens/file-history.md)) + a "kept in history — nothing is deleted"
  reassurance line + one **filled ember Primary `Restore this version`** button. Built by **detaching**
  an `AppPane/Diff` instance (`detachInstance()` preserves variable bindings — unlike `clone()`),
  switching the History `Tab` to active, and stripping the read-only-irrelevant header controls
  (StatusTag/Discard/Commit). The affordance rules here (actions are _filled_; presentation is flat;
  selection is loud; two distinct surfaces; disclosure chevrons) are the project's "legible to non-devs
  too" baseline. See [file history](./screens/file-history.md).
- **Secret + choice primitives (Phase 5 — Batch E):** _(M4 update: `RadioRow` + `PMOption` were folded
  into **`SelectRow`** — see Row families above. The two modals below now hold `SelectRow` instances;
  anatomy kept here for history.)_ `RadioRow` — the reusable **single-choice card** (radio + title +
  description; selection = **full ember border** + ember radio, the onboarding "Option" pattern —
  **for Batch F's automation ladder reuse `SelectRow`**); `PMOption` — a **password-manager row** (radio
  - name + CLI `Kbd` + `op://…` reference + a green "CLI detected" / muted "Not found" `Pill`;
    Disabled = dimmed + install hint). Plus two composed **secret modals** (instanced over a scrim like
    `Dialog`, no exposed props): `SecretWarning` — the warn-amber **step 1** (detected-secret card + a
    _Convert vs Commit-anyway_ `SelectRow` choice + a "don't warn about this file again" allowlist checkbox
  - Continue), and `SecretPicker` — **step 2** (the `SelectRow` password-manager picker + "Remember my
    choice" + Convert to Secret reference). Warn-amber, never destructive-red; 2 steps so each screen has
    one job. See
    [secret + errors](./screens/secret-and-errors.md).
- **Icons — live Lucide instances from the Nova library (the one exception to the no-local rule; see
  [ADR-0018](../adr/0018-icons-are-lucide-nova-instances.md)).** Don't hand-build or keep a local
  `Icon/*` set. Drop `Lucide Icon / <PascalName>` instances straight from the _shadcn/ui kit (Nova)_
  library — names map 1:1 to `lucide-react` (`Lucide Icon / Pen` → `<Pen/>`). Icons are the **one place**
  we consume Nova _components_ (geometry only — Nova is still never a color source); justified because
  icons carry no brand value and recolor locally. **Recolor** = override the instance's `strokes` to a
  `dd` token per the 3-case [icon-color convention](./figma-conventions.md#icon-color-convention) (leading
  = `muted-foreground`; button = label color; status = the `dd` semantic hue) — clear any fill (white-fill
  gotcha). **Size:** 16px default (`size-4` in code); 14/20 where a component calls for it. In code:
  **lucide-react** (shadcn default). _(M8 done 2026-06-14 — the legacy local `Icon/_` set is fully retired; every icon is now a Nova Lucide instance.)\*

## Two-axis file status (owned here · domain terms in [CONTEXT.md](../../CONTEXT.md))

A file carries **two independent status axes**, rendered together on the tree row:

- **Local axis** = the tree's built-in git-status lane, driven by `setGitStatus([{path,status}])`
  (union `added|modified|deleted|ignored|renamed|untracked`) computed from `chezmoi status`. Mapping:
  uncommitted edit → `modified` (M); new-not-committed → `added` (A); discovered candidate not yet
  managed → `untracked` (U); locally deleted → `deleted` (D); moved → `renamed` (R); File OS-Scoped out
  of this environment → `ignored` (styled muted). A Folder/Workspace with changed descendants gets the
  automatic folder dot. (beta.4 renders a coloured **M/A/D/R/U** letter in a fixed-width git lane at the
  row's trailing edge, plus tints icon + filename.)
- **Remote axis (incoming) + Conflict** = dedicated surfaces (top-level "N incoming" → Apply diff;
  conflicts → Resolve view) **and** a per-row `renderRowDecoration` overlay glyph (`↓` incoming /
  `⚠` conflict) shown **left of the status letter**. Spike #00 = GO: the glyph lands directly left of the
  status letter with a gap (`↓ M` / `⚠ U` / `⚠ M`), no overlap/clipping at compact/default/relaxed
  density; drive it with `renderRowDecoration` returning a text glyph — **no `unsafeCSS`, no
  `setGitStatus` overload**. `renderRowDecoration` is a separate lane
  (`[data-item-section='decoration']`, `flex:1; justify-content:flex-end`); per-row actions use
  `renderContextMenu` (Commit/Apply/Untrack/Delete everywhere). Verified against
  `@pierre/trees@1.0.0-beta.4`.

## AppShell & default panes (the main-app scaffold)

The signature three-pane screen is componentized as **`AppShell`** (page `02 · Components`, App Scaffold section),
mirroring `<AppShell left center right />` in React:

- **`AppShell`** COMPONENT — window chrome (a **`Titlebar` instance**, see below) + body with **three
  `INSTANCE_SWAP` slots**: `Left#114:0`, `Center#114:1`, `Right#114:2`. Each main-app screen = one
  AppShell instance with the three panes swapped.
- **`Titlebar`** (`516:1424`) COMPONENT (Batch F, 2026-06-14) — the shared window titlebar: OS window
  controls · workspace switcher · `SearchField` · sync status · `Bell`/`Settings2` `IconButton`s ·
  `Avatar`. In code, the controls are real, not decorative: macOS renders traffic-light buttons on
  the left; Windows/Linux render minimize/maximize/close buttons on the right. The titlebar itself is
  the Electron drag region, while every control/search/settings hit target is `no-drag` so clicks
  still work. Native actions cross the preload/IPC seam (`window.minimize`,
  `window.toggleMaximize`, `window.close`); the renderer never imports Electron. **`SyncStatus`** TEXT
  prop (the right-side sync label) + **`SyncIcon`** INSTANCE_SWAP (its glyph — `ArrowDownUp` default,
  `Cloud` for offline). Extracted from the inline AppShell titlebar frame via **detach-extract**
  (`detachInstance` preserves bindings → `createComponentFromNode`), then AppShell + all 20
  app-screen titlebars were migrated to instances (the 6 detached screens also picked up the M8
  Lucide icons they'd missed). Per-screen sync labels ("1 to push", "Cloned · just now", "Offline" +
  Cloud) are now clean `SyncStatus`/`SyncIcon` overrides instead of deep node edits.
- Default pane components (same page): **`AppPane/Workspaces`** (284w) · **`AppPane/Diff`** (716w) ·
  **`AppPane/Inspector`** (320w). The home screen `App · Main` uses these defaults.
  - The panes were extracted from the original Phase-3 screen via `createComponentFromNode` (note the
    FILL→1px collapse gotcha in [figma-conventions.md](./figma-conventions.md) — the Diff pane needed a
    `resize` back to 716 after promotion).

The default panes assemble the [signature screen](./screens/signature-screen.md); the
[conflict resolver](./screens/conflict-resolver.md) flow adds its own flow-specific panes
(`ConflictFiles`/`Merge`/`Resolve`); the [commit flow](./screens/commit.md) adds **`AppPane/Commit`**.

- **`AppPane/Commit`** SET `State=Pending|Committed` (right slot, 320w, `sidebar` bg) — the commit
  composer. **Pending:** git-commit header + "N files ready" + `StatusTag` count summary +
  multiline message field pre-filled with the **resolved** template (`[macos-sync-2026-06-14]`) + a
  template hint showing the **unresolved** template string (`[$os-sync-$year-$month-$day]`) in a code
  block + "Edit template" link + a full-width **Commit changes** `Button` (git-commit lead) and a
  "commits locally — push later with Sync now" helper. **Committed:** green success callout + the new
  commit row (message + amber SHA + time) + a "TO PUSH · 1 commit ahead" section + a **Sync now**
  `Button`. Built per [figma-conventions.md](./figma-conventions.md) (state set via clone-free
  per-state build → `combineAsVariants`).

## Settings scaffold (Phase 5 — Batch F)

A second window shell — the same `Titlebar` + a **left nav rail + content** body (the OnboardingShell
pattern, applied to settings tabs). See [settings](./screens/settings.md).

- **`SettingsShell`** (`540:1205`) COMPONENT — 1320×840 window: a **`Titlebar`** instance (top) + a body
  splitting a fixed **248px nav rail** (`sidebar` bg + 1px right `border`) from a **FILL content area**
  (`background`, 32/40 pad). The nav = a `SETTINGS` eyebrow + **7 `SidebarItem` instances** (one per tab,
  each with its nested icon `swapComponent`-ed to a Lucide glyph: `ArrowDownUp`/`GitCommitHorizontal`/
  `Cloud`/`User`/`Shield`/`Monitor`/`Info`). Content is a single **`Content` INSTANCE_SWAP** slot
  (default `SettingsContent/Automation`). **Per screen** = one instance: set the active nav item's
  `State=Active` + swap `Content` — no duplicated nav/titlebar (edit once, all 7 update).
- **`SettingsContent/*`** family — one component per tab, each a transparent 1008-wide vertical stack
  (header `Title` + muted intro, then the tab's controls), `FILL`-ed into the shell's content slot.
  **Card rows are `SettingsRow` instances** (Sync/Repository/Privacy/Environments/About — see the
  `SettingsRow` entry under Row families); Automation (`SelectRow` ladder) and Commit (mono field) keep
  their bespoke controls. The lone exception is Repository's mono Remote-URL row (bespoke):
  - **`Automation`** (`530:1115`) — the **risk-graded ladder** via 4 `SelectRow`s: **Manual** (Selected,
    Neutral "Default" pill) / **Auto-sync** / **Auto-apply** (Amber "Warned" trailing `Pill`) / **YOLO
    mode** (Red "Strongly warned"). Subtitles from the automation levels in
    [ADR 0006](../adr/0006-sync-model-transport-not-commit.md). A `Shield` note states the two
    never-relax invariants (conflicts never auto-resolve; deletions always confirm).
  - **`Commit`** (`532:1146`) — mono message-template field (`[$os-sync-$year-$month-$day]`) + "Reset to
    default" + a live preview line + a wrapped row of insertable variable `Kbd` chips.
  - **`Sync`** (`533:1158`) — a settings card with **`Switch`** rows (tray poller, start-at-login) + a
    "check frequency" value row + a muted "what Sync now does" note. (The reusable **card / divider /
    switch-row** pattern introduced here is reused by Privacy/Repository/Environments/About.)
  - **`Repository`** (`534:1160`, was `Account` pre-V1-Lean) — the connected git remote + secret
    password-manager. **No provider login (ADR 0020):** Remote card = `GitBranch` · mono remote URL
    (read-only) · green "Reachable" `Pill`, then `Shield` · "Uses your git credentials / no token stored";
    Secrets card = `Lock` · green "CLI detected" `Pill` · "Change". (The GitHub sign-in row + `Folder`
    "Open" remote row were removed.)
  - **`Privacy`** (`536:1175`) — three opt-in **`Switch` rows all OFF by default** (analytics / crash /
    diagnostic logs) + a `Shield` note on the Wide-events privacy invariant + a "review what's sent" link.
  - **`Environments`** (`537:1179`) — the environment registry (`Monitor` rows: name · OS · subscribed
    Workspaces · sync state + a status `Pill` + an `Ellipsis` ⋯ menu) + a reassign/retire footnote.
  - **`About`** (`538:1194`) — brand/version hero (ember `Folder` badge + "Check for updates") + an
    Updates card (channel + auto-update `Switch`) + a links card (`ChevronRight` rows) + the chezmoi/git
    attribution.

## Platform chrome — macOS (Phase 5 — Batch G) · **the one dd/\* token-binding exception**

The background **tray poller**'s two closed-window surfaces (poll cadence in
[scope-v1](../scope-v1.md); automation levels + notify-don't-apply in
[ADR 0006](../adr/0006-sync-model-transport-not-commit.md)). Asked
"branded popover vs. native-per-OS chrome," the user chose **native chrome** — so these are faithful
**macOS** mocks (dark-mode system menu / Notification-Center card), **not** the warm-dark ember theme.
**They bind no `dd/*` variables** — literal macOS system colors instead (the single documented
exception to the token rule; replicate the host OS, not dotden). Set in **Inter** (SF Pro renders
width 0 in this Figma env — see [figma-conventions.md](./figma-conventions.md#sf-pro-renders-at-width-0--use-inter-as-the-macos-system-font-stand-in)).
Live in section `571:1299` on page 02. Full spec: [tray-and-notification](./screens/tray-and-notification.md).

- **`TrayMenu`** (`558:1299`) SET `State=Idle|Syncing|Incoming|Offline` — the macOS menubar dropdown
  (256w, radius 10, white@0.10 hairline, drop shadow): `dotden` header + a status line with a leading
  **status dot** (green up-to-date / blue incoming·syncing / gray offline), then `Sync now ⌘S`,
  `Review & Apply` (bright **with count** when incoming, else grayed/disabled), `Auto-sync: Manual ›`
  (the automation-level quick-toggle, see [ADR 0006](../adr/0006-sync-model-transport-not-commit.md)),
  `Open dotden`, `Quit dotden ⌘Q`. **`State` is the whole API** (same
  pattern as `Banner`) — each variant bakes its dot/copy/enabled-rows; disabled rows = secondary @ 0.5.
- **`OSNotification`** (`562:1299`) SET `State=Incoming|Conflict|Applied` — the macOS notification toast
  (360w, radius 16): ember **app-icon** (gradient square + white dot) + `dotden`/`now` header + title +
  body + a right-aligned translucent **action button**. Incoming → **Review & Apply**, Conflict →
  **Resolve**, **Applied** = the auto-apply confirmation (informational, **action row hidden** so the
  card shrinks). Mirrors the in-app `Banner` content, in native chrome — the closed-window counterpart.
  Faithful to the notify-don't-apply rule ([ADR 0006](../adr/0006-sync-model-transport-not-commit.md)):
  the poller **notifies**; the action opens the app — it never applies.
