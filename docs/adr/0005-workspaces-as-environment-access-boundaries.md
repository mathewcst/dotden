# 0005 — Workspaces as per-environment access boundaries

dotden organization is two-tiered. A **Workspace** is the top-level container and the unit of environment access: each environment subscribes to a set of Workspaces and applies only Files and Folders inside them. **Groups** nest within a Workspace and are purely organizational; they inherit Workspace access and never carry per-Group access control. A File or Folder applies on an environment iff the environment subscribes to its Workspace, its OS Scope matches, it is not individually unsynced on that environment, and it is not deleted.

This keeps one repo per user while still supporting work/personal separation. Enforcement compiles dotden metadata into native per-environment `.chezmoiignore` rules, preserving the faithful-wrapper principle from ADR 0003. The accepted trade-off is that Workspace/Group metadata becomes load-bearing, but access stays coarse enough to avoid a permission matrix.
