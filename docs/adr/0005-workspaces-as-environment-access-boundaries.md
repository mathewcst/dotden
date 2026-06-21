# 0005 — Workspaces as per-environment access boundaries

> **Terminology revised by [ADR 0040](./0040-one-organizational-node-the-nook.md).** The
> access-boundary decision below stands; only the name of the inner organization node changed.
> "Group" is retired — the one organizational node is now the **Nook** (which also carries **Scope**,
> where Groups did not). Read "Group" below as "Nook"; the two-tier **Workspace → Nook** structure and
> the access rule are unchanged.

dotden organization is two-tiered. A **Workspace** is the top-level container and the unit of environment access: each environment subscribes to a set of Workspaces and applies only the Files inside them. **Nooks** nest within a Workspace and are purely organizational; they inherit Workspace access and never carry per-Nook access control. A File applies on an environment iff the environment subscribes to its Workspace, its OS Scope matches, it is not individually unsynced on that environment, and it is not deleted.

This keeps one repo per user while still supporting work/personal separation. Enforcement compiles dotden metadata into native per-environment `.chezmoiignore` rules, preserving the faithful-wrapper principle from ADR 0003. The accepted trade-off is that Workspace/Nook metadata becomes load-bearing, but access stays coarse enough to avoid a permission matrix.
