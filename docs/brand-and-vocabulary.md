# dotden brand and vocabulary

Canonical branding/UI-language reference. `CONTEXT.md` remains the domain glossary.

## Brand

- App name: **dotden** (one word, lowercase).
- Pronunciation: **dot-den**.
- Meaning: **dot** (your dotfiles and configs) + **den** (a snug, private space that's yours). Your setup, in a space that feels like home — on any computer.
- Catchphrase: **your environment, anywhere.**
- Warm alt: **Make yourself at home in any environment.**
- Punchy alt: **Every environment, your den.**
- Retired: **Your local, any host.** (reintroduces "host", which we no longer use). If a localhost wink is wanted, **Your local, everywhere.** keeps it without "host" — secondary line only.
- Subline: **Keep your setup in sync — private, portable, yours.**
- External short copy:
  > dotden keeps your environment yours. Dotfiles, configs, and preferences follow you to every computer you sit down at. You own the repo and the data — dotden just makes it easy to sync.
- Contrast phrase: **Not another cloud drive: dotden is for your setup, not your photos.**

## Positioning

- Developer-first, not developer-only.
- Config/setup focused, not arbitrary file sync.
- **setup** is marketing language; **Den** is the product concept — your whole synced setup.
- **environment** is the product concept for each computer you work on (replaces the old "Machine"). It is natural developer language and stays lowercase, even in UI.
- **repo you own** is marketing/trust language; product UI uses **repository**.
- **Private** means files do not go through a dotden backend. Files live in the user's repository / configured Remote.
- Avoid **cloud** except in the contrast phrase "not another cloud drive."
- Avoid **machine**, **device**, **host**, **node** for a computer — always say **environment**.

## Voice

- In-app copy speaks directly to the user and avoids referring to dotden in third person.
- External copy, README, and website copy may use "dotden."
- In-app copy should be direct/action-oriented: **Create Den**, **Open existing Den**, **Connect GitHub**, **Choose what to sync**, **Commit changes**, **Review incoming**.
- dotden concepts are capitalized in UI/docs when referring to product concepts: **Den**, **Workspace**, **Group**, **File**, **Folder**, **Scope**, **Remote**, **Commit**, **Apply**, **Sync**. The one exception is **environment** (a computer), which stays lowercase — reading as natural language is the point.
- README intro may stay natural/lowercase for approachability.

## Core hierarchy

```txt
Den  (your whole setup; lives in your Repository / Remote)
└── Workspace
    └── Group
        └── File / Folder
```

Separately:

```txt
environment (a computer) subscribes to Workspaces
```

- **Repository**: UI noun during setup/auth flows.
- **Remote**: product/domain term for the configured shared git repository.
- **Den**: whole managed setup.
- **Workspace**: top-level environment sync/access boundary.
- **Group**: visual organization inside a Workspace.
- **File**: actual filesystem file.
- **Folder**: actual filesystem directory managed recursively.
- Avoid generic **Item** in user-facing copy; say **files and folders**.
- Main sidebar/tree shows Workspaces directly; no visible Den root.

## Workspace / Group rules

- A default Workspace named **Default** is created silently in v1.
- **Default** is visible as a normal Workspace, expanded by default on first run, not reserved, and can be renamed.
- If **Default** is the only Workspace, it cannot be deleted.
- If other Workspaces exist, **Default** can be deleted like any other Workspace.
- No hidden root outside Workspaces.
- Every File/Folder belongs to exactly one Workspace and one Group path.
- Workspaces do not nest.
- Groups can nest.
- Groups are visual-only: no Scope, no access control, no filesystem path meaning.
- Moving Files/Folders between Groups never changes filesystem paths.
- Moving Files/Folders between Workspaces is allowed but requires confirmation because it can change sync availability.
- First-run does not explain Workspaces in v1; future onboarding can teach them.

## Empty states and discovery

- Empty Default Workspace copy:
  > **Track files or folders**  
  > Drag them here or choose from suggested configs.
- **Scanning/detection** language is separate from **Recommended** language.
  - Use scanning/detected wording for finding common existing files on the user's computer.
  - Use **Recommended** for choices dotden suggests as defaults, such as a recommended destination/path.

## Files, Folders, Track, Commit

- **Track**: start managing an Untracked File/Folder.
- **Untrack**: stop managing a File/Folder while leaving it on disk.
- **Delete everywhere**: destructive removal from the Den and from filesystem paths wherever it applies.
- Track/Untrack is the preferred pair; avoid **Stop managing**.
- Tracking a File/Folder stages it into pending review; it does not immediately Commit.
- Flow: **Untracked → Track → Review changes → Commit changes → Sync**.
- Tracking a Folder recursively discovers children and shows a preview before Commit.
- Tracking a Folder does not automatically include future new files forever. Future new files appear as **Untracked** until Tracked and Committed.
- Untracked children inside tracked Folders are visible by default and can be hidden with **Show untracked**.

## Sync and automation terms

- **Commit**: record local edited Files/Folders into the Den. Primary button: **Commit changes**.
- **Apply**: write Den state onto this environment.
- **Sync**: transport only — sends already-Committed changes and checks for incoming changes. It does not Commit or Apply by default.
- **Sync now**: manual transport action. It can run while uncommitted changes exist, but only transports Committed changes and checks incoming.
- **Not synced**: the status-bar state for a Commit recorded locally but not yet pushed — `Not synced · N changes`, the mirror of `Synced · <time> ago`. **Rule:** user-facing copy never says git's **"ahead"** or **"to push"**; "push"/"ahead" stay in the IPC/git layer only. We speak Sync.
- **Auto-sync**: "Auto-sync sends your committed changes and notifies you about incoming changes." The default automation level; the only level besides Manual ([ADR 0037](adr/0037-automation-ladder-transport-only.md)).
  - _Retired (ADR 0037):_ **Apply automatically** / **YOLO mode** — removed; dotden has no auto-write-to-disk level. Don't reuse these labels.

## Review flows

- Local outgoing screen title: **Review changes**.
- Local primary action: **Commit changes**.
- Incoming entry action: **Review & Apply**.
- Incoming screen title: **Review incoming**.
- Incoming primary action: **Apply changes**.
- Related uncommitted local changes block Apply.
- Block wording: "This File has local changes. Commit or revert them before applying incoming changes."
- **Revert changes**: discard uncommitted local edits.
- **Restore version**: restore an older version forward via a new Commit.
- History screen/section: **History**.

## Scope and environment sync

- **Scope** is the product concept; UI label is **Applies to**.
- Scope values: **All**, **macOS**, **Linux**, **Windows**.
- **All** is explicit default.
- Scope applies to Files and Folders.
- Folder Scope is inherited by children; children may narrow but not broaden it.
- Show Scope chip on rows only when not **All**.
- **Unsync here**: environment-specific opt-out for Files/Folders.
- **Sync here**: inverse action.
- Workspaces use checklist selection, not Unsync here.
- Setup heading: **Choose what to sync**.
- Subcopy: "Select the Workspaces you want on this environment. You can change this later."
- Default selection: all Workspaces.

## Git/provider setup language

- First setup action: **Create Den**.
- Returning/additional setup action: **Open existing Den**.
- v1 auth button: **Connect GitHub**.
- Explanatory copy uses **GitHub account**.
- Generic future provider term: **Git provider**.
- UI uses **repository**, **your repository**, **connect your account** — not marketing phrasing like "repo you own."
- Settings field label: **Remote repository**.

## environment language

- **environment** is the product/UI term (lowercase, natural language).
- Setup asks **Name this environment** with input prefilled from hostname.
- UI uses **environment name**; data model uses `label`.
- Activity copy uses the name naturally: "3 incoming changes from MacBook Pro."
- Avoid **machine**, **device**, **host**, **node** — say **environment**, or the environment's name.

## Status/tree language

- Use Trees native git statuses: **Modified**, **Added**, **Deleted**, **Renamed**, **Untracked**, **Ignored**.
- **Untracked** tooltip: "Found on this computer, not yet managed."
- Incoming and Conflict are row decorations, not git-status values.
- Row decoration labels: **Incoming**, **Conflict**.
- Main browsing tree: no **Show unmodified** toggle.
- Review/status screens may use **Show unmodified**, likely default off.
- Main tree may use **Show untracked**, default on.

## Deletion rules

- Empty Group deletion needs no confirmation.
- Non-empty Group deletion:
  1. Dialog: **Delete Group**.
  2. Checkbox: **Also delete files and folders inside this Group?** unchecked by default.
  3. If unchecked, ask where to move contents.
  4. If checked, second confirmation: **Delete files and folders everywhere**.
- Workspace deletion always requires confirmation, even if empty.
- Non-empty Workspace deletion follows the same move-or-delete pattern as Group deletion, with stronger wording.
- **Delete everywhere** applies to Files and Folders; Folder deletion must warn recursively.

## Settings and privacy

- Top-level page: **Settings**.
- Settings sections: **Den**, **Environments**, **Sync**, **Privacy**.
- **Secret reference** stays as the term for password-manager references.
- Do not mention secrets in the top intro; mention later under trust/safety.
- Settings Privacy copy: **Your files are stored in your repository.**
- Den settings label: **Remote repository**.
