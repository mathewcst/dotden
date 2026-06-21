# Component & node-ID map

> **Grep here first for any Figma node ID.** This is the at-a-glance index of every page, component
> (+ its key property keys), section, and screen in the file — so you don't have to spelunk the canvas.
> Part of the [design system](./README.md); anatomy/rationale lives in [components.md](./components.md)
> and the per-flow [screens/](./screens/) docs. **Living doc — IDs can drift after edits; re-confirm by
> name with a read-only `use_figma` pass ([regenerating](#regenerating-this-map)) before trusting an ID
> for a mutation.**

Figma file: **`s9ajnbYy4cb4scVvpo1dd8`** ("dotDen").

## Pages

| Page                      | ID      |
| ------------------------- | ------- |
| 00 · Cover                | `380:2` |
| 01 · Foundations          | `27:2`  |
| 02 · Components           | `37:2`  |
| 03 · Screens — App        | `54:2`  |
| 04 · Screens — Onboarding | `71:2`  |
| 05 · Screens — Returning  | `210:4` |
| 06 · Marketing            | `730:2` |

(`107:2` / `107:3` are the two `---` page-list dividers — after Foundations and after Components.)

> **Reorganized 2026-06-14 (M1).** All component sets now live on the single **`02 · Components`**
> page, grouped into 7 **Sections** (below). The old `Components — App/Onboarding/Returning` pages were
> merged and deleted; screen pages renumbered. Instances are ID-referenced, so the moves didn't touch
> any screen. (IDs of the moved components themselves are unchanged — only their page/parent changed.)

### Sections on `02 · Components` (`37:2`)

| Section                 | ID          | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitives              | `371:974`   | atoms (Button…Tooltip), IconButton, StatusTag/Dot, Pill, SearchField (icons now = Nova Lucide instances)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Rows & Cells            | `371:975`   | **SelectRow** (`429:1109`), **ListRow** (`439:1103`), **SettingsRow** (`676:1324`), RowValue (`652:1307`), SidebarItem, TreeRow, CommitRow _(M4 retired RadioRow/PMOption/WorkspaceRow/FileRow/DiscoverRow)_                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Diff                    | `371:976`   | DiffLine, DiffLineSplit, MergeHunk (+ showcase frame)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Overlays                | `371:977`   | Toast, Dialog, Banner, SecretWarning, SecretPicker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| App Scaffold            | `371:978`   | AppShell, all `AppPane/*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Onboarding              | `371:979`   | OnboardingMenu (`83:197`), **OnboardingMenu/V1** (`610:1376`, V1 rail "Create your repo"/"Connect"), OnboardingShell, `OBContent/{Welcome,Discover,Commit,AutoSync,Done}` + **V1-Lean** `OBContent/CreateRepo` (`595:1299`) + `OBContent/ConnectURL` (`607:1309`, `State=Idle\|Checking\|Reachable\|CredentialError\|CredentialErrorGhCli`; the last is the **v1.1** gh-CLI account-enrichment variant `717:1474`) + **v1.1** `OBContent/AdoptExisting` (`706:1582`, C1 benign-adopt picker, forked from Discover) · **retained convenience-layer** `OBContent/{Connect,CreateDen}` (device-flow + one-click create, post-v1 reference) |
| Returning               | `371:980`   | ReturningMenu (`212:5`), **ReturningMenu/V1** (`619:1462`, step 1 "Connect"), `OBContent/{FoundDen,PickWorkspaces}` + reuses `OBContent/ConnectURL` ("Welcome back" copy override) · **retained** `OBContent/SignIn` (convenience-layer reference)                                                                                                                                                                                                                                                                                                                                                                                      |
| Settings                | `545:1299`  | SettingsShell, `SettingsContent/*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Platform chrome — macOS | `571:1299`  | **TrayMenu** (`558:1299`), **OSNotification** (`562:1299`) — native OS-chrome mocks, **not** dd/\* token-bound (Batch G)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Diagnostics — Feature 1 | `791:10664` | **CommandRecord** (`774:9610`), **StatusBar** (`776:9624`), **BottomPanel** (`778:1490`), **SettingsContent/Diagnostics** (`786:1541`) — Feature 1 / [ADR 0030](../adr/0030-diagnostics-local-redacted-command-log.md)                                                                                                                                                                                                                                                                                                                                                                                                                  |

> Cleaned 2026-06-14: the page now holds **only the 7 sections** (cluster at origin `x=0`). The old
> loose leftovers — 10 orphan `Vector`s, 9 `label:*`/`Toast` text captions, and the legacy
> `Wordmark`/`Icon` marketing components — were deleted (Wordmark's was the only `Icon` instance in the
> file; no screen referenced either).

---

## Components — page `02 · Components` (`37:2`)

Variant column = variant values (axes `/`-joined for multi-axis sets). Props column = exposed
(non-variant) property keys — **keys carry a `#id` suffix; pass them verbatim to `setProperties`.**

### Atoms

| Component | ID      | Variants                                                    | Key props                                                                                   |
| --------- | ------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Button    | `39:38` | Primary/Secondary/Outline/Ghost/Destructive/Link × sm/md/lg | `Label#39:0`, `HasLead#161:0`, `Lead#161:19`(swap), `HasTrail#161:38`, `Trail#161:57`(swap) |
| Input     | `42:10` | Default/Focus/Error/Disabled                                | `Placeholder#42:0`                                                                          |
| Badge     | `43:10` | Default/Secondary/Outline/Destructive                       | `Label#43:0`                                                                                |
| Checkbox  | `44:7`  | Unchecked/Checked/Indeterminate                             | —                                                                                           |
| Radio     | `44:11` | Unchecked/Checked                                           | —                                                                                           |
| Switch    | `44:16` | Off/On                                                      | —                                                                                           |
| Kbd       | `47:2`  | —                                                           | `Label#47:0`                                                                                |
| Separator | `47:4`  | —                                                           | —                                                                                           |
| Avatar    | `47:5`  | —                                                           | `Initial#47:1`                                                                              |
| Tab       | `47:11` | Active/Inactive                                             | `Label#47:2`                                                                                |
| Tooltip   | `47:12` | —                                                           | `Label#47:5`                                                                                |

### dotden composites

| Component   | ID      | Variants                                                   | Key props                |
| ----------- | ------- | ---------------------------------------------------------- | ------------------------ |
| StatusTag   | `43:32` | Added/Modified/Deleted/Renamed/Untracked/Incoming/Conflict | —                        |
| IconButton  | `53:2`  | —                                                          | — (swap the nested icon) |
| SidebarItem | `53:15` | Default/Active                                             | `Label#53:0`             |
| TreeRow     | `53:32` | Default/Selected                                           | `Name#53:3`              |

### Generic primitives

| Component   | ID        | Variants                           | Key props                                                       |
| ----------- | --------- | ---------------------------------- | --------------------------------------------------------------- |
| StatusDot   | `153:429` | Neutral/Ember/Green/Amber/Red/Blue | —                                                               |
| Pill        | `158:452` | Neutral/Ember/Green/Amber/Red/Blue | `Label#158:0`, `Dot#158:1`, `HasIcon#158:2`, `Icon#158:3`(swap) |
| SearchField | `174:429` | —                                  | `Placeholder#174:0`                                             |

### Row families (M4-consolidated, 2026-06-14)

| Component   | ID         | Variants                                                     | Key props                                                                                                         |
| ----------- | ---------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| SelectRow   | `429:1109` | Default/Selected/Disabled                                    | `Lead#430:0`(swap), `HasLead#436:0`, `Title#431:0`, `Subtitle#431:4`, `Trailing#436:8`(swap), `HasTrailing#436:4` |
| ListRow     | `439:1103` | Clean/Conflict/Applied/Incoming/Error/Selected/Warn          | `Title#173:0`, `Meta#173:1`, `Path2#441:0`, `HasCheckbox#441:6`, `HasPath2#441:12`, `HasMeta#441:18`              |
| SettingsRow | `676:1324` | Trail=None/Switch/Pill/Value/Select/Link/PillButton/PillMenu | `HasLead#677:0`, `Lead#677:9`(swap), `Title#677:18`, `HasSub#677:27`, `Sub#677:36`                                |
| RowValue    | `652:1307` | —                                                            | hug-width muted value text (used by SettingsRow Value/Select trail)                                               |

> `SelectRow` replaced `RadioRow`/`PMOption`/`WorkspaceRow`; `ListRow` replaced `FileRow`/`DiscoverRow`
> (cloned from FileRow, so Title/Meta keep `173:0`/`173:1`). `TreeRow`/`SidebarItem` kept; `CommitRow` +
> `DiffLine` family stay bespoke. Mono subtitle = per-instance font override.

### Diff family

| Component     | ID        | Variants                         | Key props                                                        |
| ------------- | --------- | -------------------------------- | ---------------------------------------------------------------- |
| DiffLine      | `167:437` | Context/Added/Removed/Hunk       | `Num#167:0`, `Code#167:1`                                        |
| DiffLineSplit | `170:449` | Context/Added/Removed/Modified   | `OldNum#170:0`, `OldCode#170:1`, `NewNum#170:2`, `NewCode#170:3` |
| MergeHunk     | `118:387` | Conflict/Resolved × Inline/Split | —                                                                |

### Overlays & inline status

| Component         | ID        | Variants                                             | Key props                                                                                            |
| ----------------- | --------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Toast (transient) | `254:741` | Success/Info/Warning/Error                           | `Title#254:0`, `Description#254:5`, `HasDescription#254:10`, `HasAction#254:15`, `HasDismiss#254:20` |
| Dialog (modal)    | `266:732` | Default/Destructive                                  | `Title#266:0`, `Body#266:1`, `HasIcon#266:2`                                                         |
| Banner (inline)   | `292:751` | Syncing/UpToDate/Incoming/Push/**Offline**/**Error** | — (Tone is the whole API; override text per instance)                                                |

### History (Batch D)

| Component | ID        | Variants         | Key props                                                  |
| --------- | --------- | ---------------- | ---------------------------------------------------------- |
| CommitRow | `313:790` | Default/Selected | `Message#313:0`, `Sha#313:3`, `Meta#313:6`, `HasTag#313:9` |

### Secret & choice (Batch E)

| Component     | ID         | Variants | Key props                                                                        |
| ------------- | ---------- | -------- | -------------------------------------------------------------------------------- |
| SecretWarning | `341:1184` | —        | — (composed modal — instance over a scrim; rows are `SelectRow`)                 |
| SecretPicker  | `353:1207` | —        | — (composed modal — instance over a scrim; rows are `SelectRow` + trailing Pill) |

> `RadioRow` (`346:1190`) and `PMOption` (`335:1136`) were **retired in M4** — both folded into
> `SelectRow` (the reusable single-choice card; full ember border when selected — onboarding "Option"
> pattern). Batch F's automation ladder **reuses `SelectRow`** (radio `Lead`) — see
> [settings](./screens/settings.md).

### App scaffold (AppShell + panes)

| Component             | ID         | Variants            | Key props                                                                                     |
| --------------------- | ---------- | ------------------- | --------------------------------------------------------------------------------------------- |
| Titlebar              | `516:1424` | —                   | `SyncStatus#516:0` (text), `SyncIcon#516:1` (swap) — reused by every AppShell + SettingsShell |
| AppShell              | `114:359`  | —                   | a `Titlebar` instance + slots `Left#114:0`, `Center#114:1`, `Right#114:2` (all swap)          |
| AppPane/Workspaces    | `110:110`  | —                   | —                                                                                             |
| AppPane/Diff          | `110:203`  | —                   | —                                                                                             |
| AppPane/Inspector     | `110:278`  | —                   | —                                                                                             |
| AppPane/ConflictFiles | `119:390`  | —                   | —                                                                                             |
| AppPane/Merge         | `127:437`  | Unresolved/Resolved | —                                                                                             |
| AppPane/Resolve       | `128:454`  | Unresolved/Resolved | —                                                                                             |
| AppPane/Commit        | `282:742`  | Pending/Committed   | —                                                                                             |
| AppPane/History       | `319:888`  | —                   | master-detail (list / resize-handle / preview-panel)                                          |

> Pane names use a `/` folder, **no spaces** (`"AppPane/Diff"` — normalized in M2). Swap a pane into a screen with
> `appShellInstance.setProperties({ "Center#114:1": "<paneComponentId>" })`.

### Settings scaffold (Batch F)

| Component                    | ID         | Variants | Key props                                                                                                                              |
| ---------------------------- | ---------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| SettingsShell                | `540:1205` | —        | `Content#540:0` (swap); per screen also set the active `SidebarItem` `State=Active`                                                    |
| SettingsContent/Automation   | `530:1115` | —        | 2× `SelectRow` ladder (Auto-sync default / Manual) — transport-only, ADR 0037 (was 4× incl. Auto-apply/YOLO)                           |
| SettingsContent/Commit       | `532:1146` | —        | mono template field + variable `Kbd` chips                                                                                             |
| SettingsContent/Sync         | `533:1158` | —        | poller/autostart `Switch`es + cadence + note                                                                                           |
| SettingsContent/Repository   | `534:1160` | —        | git remote URL + "Reachable" + git-credential note; 1Password card (V1-Lean, no provider login)                                        |
| SettingsContent/Privacy      | `536:1175` | —        | 3 opt-in `Switch`es (off) + Wide-events note                                                                                           |
| SettingsContent/Environments | `537:1179` | —        | env registry rows + status `Pill` + ⋯ menu                                                                                             |
| SettingsContent/About        | `538:1194` | —        | version hero + updates + links + chezmoi note                                                                                          |
| SettingsContent/Diagnostics  | `786:1541` | —        | Feature 1 / [ADR 0030] — Enable Console / Copy diagnostics / Open log location + amber Unredacted-mode card + redact-at-write footnote |

> Swap a tab into the shell with `settingsShellInstance.setProperties({ "Content#540:0": "<contentComponentId>" })`
>
> - set the matching nav `SidebarItem`'s `State=Active`. Nav-tab icons are `swapComponent`-ed per tab.

### Diagnostics (Feature 1, [ADR 0030](../adr/0030-diagnostics-local-redacted-command-log.md))

New section `791:10664`. The observability surfaces — a redacted Command-log Console, the global status bar
(env identity relocated here), and the Settings tab. All `dd/*` token-bound; mono throughout.

| Component                   | ID         | Variants                                                       | Key props / notes                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ---------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CommandRecord               | `774:9610` | State=Collapsed-ok / Collapsed-failed / Expanded-failed        | One **Command record** row: expand chevron · exit chip (green `0` / red `exit N`) · mono command+args · timestamp · traceId chip. Expanded adds the inset stderr block with `[REDACTED]` tokens. Variant nodes: ok `773:1472` · failed `772:1486` · expanded `774:1479`. Raw text per instance (no text props yet). |
| StatusBar                   | `776:9624` | State=Idle / Errors / Console-on                               | Global bottom bar (new shell region). Env identity (`🖥 this-mac ● · OS`, **moved from the sidebar footer**) · Diagnostics badge/affordance · sync status. Errors = red count + "Sync failed"; Console-on = ember-active badge. Variant nodes: Idle `775:1477` · Errors `776:1479` · Console-on `776:1497`.         |
| BottomPanel                 | `778:1490` | — (Console mode; Details = screen override, Mode variant TODO) | Reusable VSCode-style panel: header = tab strip (Console active + ghost `+`) + toolbar (Copy diagnostics · `ListFilter` · `Eraser` · collapse · close) over a body of `CommandRecord` instances. Top `border`, `card` body, `sidebar` header.                                                                       |
| SettingsContent/Diagnostics | `786:1541` | —                                                              | Swaps into `SettingsShell` `Content#540:0`. Main card (Enable Console `Switch` · Copy diagnostics · Open log location, via `SettingsRow`) + loud amber **Unredacted-mode** card (session-scoped) + redact-at-write footnote.                                                                                        |

> Icons added from Nova: `SquareTerminal` `5b0e6642…` · `Copy` `8e455ea4…` · `ListFilter` `df27b7d7…` ·
> `Eraser` `2f4554ea…` · `TriangleAlert` `0dfef13c…` · `FolderOpen` `3eb20014…` · `Eye`/`EyeOff`. The
> panel **close (X)** is an inline `createNodeFromSvg` lucide vector (no Nova X imported yet).

### Platform chrome — macOS (Batch G) · **not dd/\* token-bound**

| Component      | ID         | Variants                      | Key props                                                |
| -------------- | ---------- | ----------------------------- | -------------------------------------------------------- |
| TrayMenu       | `558:1299` | Idle/Syncing/Incoming/Offline | — (State is the whole API; literal macOS colors)         |
| OSNotification | `562:1299` | Incoming/Conflict/Applied     | — (State is the whole API; Applied hides its action row) |

> TrayMenu variants: Incoming `556:1299` · Idle `556:1300` · Syncing `556:1331` · Offline `556:1362`.
> OSNotification variants: Incoming `560:1299` · Conflict `560:1300` · Applied `560:1314`.
> **Native OS-chrome mocks** — faithful macOS menu / notification, **intentionally unbound** from
> `dd/*` (the one documented exception — replicate the host OS, not the dotden theme) and set in
> **Inter** (SF Pro renders width 0 in this Figma env). See
> [tray-and-notification](./screens/tray-and-notification.md).

### Icons — **Nova `Lucide Icon / *` instances** (M8 done 2026-06-14)

No local `Icon/*` set anymore — the legacy 22 local vectors were retired and every icon is now a live
instance of the _shadcn/ui kit (Nova)_ library's `Lucide Icon / <PascalName>` components (maps 1:1 to
`lucide-react`). Recolor by overriding the instance's vector `strokes` to a `dd` token (icon-color
convention); 16px default. See [ADR-0018](../adr/0018-icons-are-lucide-nova-instances.md).

### Legacy / non-app

The marketing `Wordmark`/`Icon` leftovers were **deleted** 2026-06-14 (M1 cleanup) — no app screen
referenced them.

---

## App screens — page `03 · Screens — App` (`54:2`)

Each flow is a Figma **Section**; new app screens **clone `Backdrop 54:3`** (the source-of-truth home)
and swap panes. Section children store **section-relative** coords.

| Section                     | ID         | Screens (name · id)                                                                                                                                   | Spec                                                        |
| --------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| App · Main                  | `130:995`  | Backdrop **`54:3`** (home / source-of-truth)                                                                                                          | [signature-screen](./screens/signature-screen.md)           |
| Conflict resolver           | `126:1094` | unresolved `126:648` · resolved `129:831`                                                                                                             | [conflict-resolver](./screens/conflict-resolver.md)         |
| Returning · Review & Apply  | `231:1682` | Review&Apply `228:1153` · Applied·in-sync `230:1392`                                                                                                  | [returning-environment](./screens/returning-environment.md) |
| Confirm dialogs             | `268:1694` | Track `268:1695` · Untrack `268:2033` · Delete-everywhere `268:2342`                                                                                  | [confirm-dialogs](./screens/confirm-dialogs.md)             |
| Commit                      | `283:2644` | Pending `283:2645` · Committed `283:3059`                                                                                                             | [commit](./screens/commit.md)                               |
| Sync states                 | `297:3139` | 3 incoming `297:3140` · Syncing `298:3429` · Up-to-date `298:4100` · 1-ahead `301:3980`                                                               | [sync-states](./screens/sync-states.md)                     |
| File history                | `320:4250` | File history `320:4251` · Restore-confirm `323:4746`                                                                                                  | [file-history](./screens/file-history.md)                   |
| Secret & errors             | `343:5185` | Secret choose `343:5243` · Secret pick `354:6937` · Offline `344:6096` · Apply-failed `360:6720`                                                      | [secret-and-errors](./screens/secret-and-errors.md)         |
| Settings                    | `542:6203` | Automation `542:6204` · Commit `542:6537` · Sync `542:6712` · Repository `542:6866` · Privacy `542:7068` · Environments `542:7228` · About `542:7429` | [settings](./screens/settings.md)                           |
| Tray & notification (macOS) | `563:7125` | Tray · incoming `563:7126` · Notification states `566:7155`                                                                                           | [tray-and-notification](./screens/tray-and-notification.md) |
| Diagnostics — Feature 1     | `791:8424` | Console open `781:7726` · On-error Details `784:7912` · Settings — Diagnostics `788:8288`                                                             | [diagnostics](./screens/diagnostics.md)                     |

_Phase 5 build complete (Batch G was the finale). **Feature 1 (Diagnostics, [ADR 0030](../adr/0030-diagnostics-local-redacted-command-log.md))** adds the section above + the components section `791:10664`. Optional deferred: a Flow-Map overview page._

> **New shell structure (Feature 1):** the app grid graduates from `[titlebar / banner / body]` to
> `[titlebar / banner / body / BottomPanel / StatusBar]`. The Console-open & On-error screens clone the
> home composition, **hide the AppPane/Workspaces `this-mac` footer** (env identity relocated to
> `StatusBar`), shrink the body, and dock `BottomPanel` + `StatusBar`. The Settings screen swaps
> `SettingsContent/Diagnostics` into `SettingsShell` and adds an active `Diagnostics` nav `SidebarItem`.

## Onboarding & Returning screens

| Page                               | Section                               | Holds                                                                      | Spec                                                        |
| ---------------------------------- | ------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 04 · Screens — Onboarding (`71:2`) | First environment `108:750`           | 7 `OnboardingShell` instances                                              | [onboarding](./screens/onboarding.md)                       |
| 04 · Screens — Onboarding (`71:2`) | First environment — V1 `615:746`      | 7 V1-Lean `OnboardingShell` instances                                      | [onboarding](./screens/onboarding.md)                       |
| 04 · Screens — Onboarding (`71:2`) | **v1.1 · Onboarding gate** `703:1333` | C2 refuse `703:1334` · C1 adopt `713:1414` · gh CredentialError `717:9517` | [onboarding](./screens/onboarding.md) (_v1.1 surfaces_)     |
| 05 · Screens — Returning (`210:4`) | Second environment `221:331`          | 3 shell instances + Review&Apply (on page 03)                              | [returning-environment](./screens/returning-environment.md) |

Component defs now live on `02 · Components` (`37:2`) — **Onboarding** section (`371:979`) and **Returning** section (`371:980`).

> Batch-E reconciliation: the discovery row's hard `Blocked` state became a soft **`Warn`** (real
> unchecked checkbox + amber) — no longer a hard exclude. In M4 the row itself folded into `ListRow`, so
> `Warn` is now a `ListRow` State (amber bg/fg). See [secret-and-errors](./screens/secret-and-errors.md).

---

## Marketing — page `06 · Marketing` (`730:2`)

The public landing/marketing page (built 2026-06-15). **Not part of the app design system** — per the
[README](./README.md) the system is scoped to the app, so this page reuses the brand tokens (`background`,
`card`, `primary`/ember, `border`, `muted-foreground`) and Geist/Geist Mono **but adopts a larger marketing
type scale** (62px hero, 38px section heads) outside the 14-style app ramp. Single `Landing` wrapper frame
(`730:3`, 1440-wide vertical auto-layout) holding the sections below in order. The two previews are
**rasterized exports** of real app screens (`54:3` home, `320:4252` history) set as `IMAGE` fills — not
live instances, so they won't auto-update if those screens change (re-export to refresh). **Copy de-brands
deliberately** — no `chezmoi` / `GitHub` / `host` / `machine` mentions (per
[brand-and-vocabulary](../brand-and-vocabulary.md): the product stands on its own; chezmoi credit lives in
the repo README only). The GitHub octocat icon is kept as a neutral "source" mark; its label is "View source".

| Section            | ID         | Holds                                                                                           |
| ------------------ | ---------- | ----------------------------------------------------------------------------------------------- |
| Nav                | `731:2`    | `Wordmark` (imported) + links + View source / Download buttons                                  |
| Hero               | `732:2`    | eyebrow pill · two-tone headline (`any environment` in ember) · subline · dual CTA              |
| Hero media         | `733:2`    | `App preview` (`743:690`) — exported `54:3` home as image fill, border + ember glow             |
| Value props        | `737:2`    | 3 cards (ember icon tiles): Private by design / Every environment in sync / No command line     |
| Feature — Managing | `745:129`  | ongoing-management copy + green-check list left · `History preview` (exported `320:4252`) right |
| How it works       | `737:9546` | 3 numbered ember-badge steps                                                                    |
| CTA band           | `738:2`    | raised card + ember glow · "your environment, anywhere." · dual CTA                             |
| Footer             | `739:2`    | `Wordmark` clone · tagline · 3 link columns · legal/credit row                                  |

> Icons are inline `createNodeFromSvg` lucide vectors (download/github/shield/refresh/app-window/check),
> not Nova instances — acceptable here since marketing is outside the app icon convention.

---

## Foundations — page `01` (`27:2`)

120 variables / 14 text styles / 5 effects. Values in [color-tokens.md](./color-tokens.md),
[typography.md](./typography.md), [radius-spacing-effects.md](./radius-spacing-effects.md).

**Common semantic color bind-IDs** (pass to `getVariableByIdAsync` / `setBoundVariableForPaint` as
`VariableID:<id>`; hexes in color-tokens.md):

**Semantic (shadcn) tokens — 32 kept after M7:**

| Token           | ID      | Token            | ID      |
| --------------- | ------- | ---------------- | ------- |
| background      | `22:2`  | muted            | `22:12` |
| foreground      | `22:3`  | muted-foreground | `22:13` |
| card            | `22:4`  | border           | `22:18` |
| popover         | `22:6`  | ring             | `22:20` |
| primary (ember) | `22:8`  | sidebar          | `23:2`  |
| secondary       | `22:10` | destructive      | `22:16` |

**Functional `dd/*` primitives** — screens bind these **directly** post-M7 (the old `status/*` / `success` /
`warning` / `info` semantic layer was deleted; `-bg` = the `/950` step):
`dd/green/500 18:10` · `/950 18:11` · `dd/amber/500 18:13` · `/950 18:14` · `dd/red/500 18:16` ·
`/950 18:18` · `dd/blue/500 18:20` · `/950 18:21` · `dd/ink/400 17:11` · `dd/ink/500 17:10` ·
`dd/ink/990 17:2` · `dd/ember/400 18:3` · `/600 18:5` · `/700 18:6` · `/950 18:8`.

---

## Regenerating this map

IDs can drift after structural edits. To refresh, run a **read-only** `use_figma` pass that walks
`figma.root.children` (pages), `page("37:2").children` (components — read `componentPropertyDefinitions`
for prop keys), and `page("54:2").children` (sections → screens). Use `page.loadAsync()` to read
non-current pages without switching. Then reconcile this table by **name** (names are stable; IDs are
not).
