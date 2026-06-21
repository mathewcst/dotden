# Distribution

dotden v1 ships through GitHub Releases with bundled `chezmoi` and git tooling.

## macOS unsigned builds

v1 macOS builds are unsigned and not notarized. On first launch, Gatekeeper may block a normal double-click with a warning that the app cannot be opened.

Use the explicit macOS override:

1. Open the downloaded `.dmg`.
2. Drag `dotden` into Applications.
3. In Applications, right-click `dotden` and choose **Open**.
4. Confirm **Open** in the Gatekeeper dialog.

This is expected for the v1 MVP install path. Code signing and notarization are deferred until public distribution.
