# Design verification

This record covers the earlier prototype only. See [implementation verification](IMPLEMENTATION-VERIFICATION.md) for the live desktop app.

Checked 6 November 2026. Scope: `design/enderlink.html`, the self-contained interactive prototype. No real server or provider account was used, no engine was downloaded, and no world files were deleted.

## Completed

- JavaScript syntax check passed.
- Automated interaction checks passed: **13 scenarios, zero page errors**, using Playwright 1.65.0 and a fresh Chromium headless session.
- Layout checks covered dashboard, world library, Join, and Settings at **1144, 728, and 390 CSS pixels** with no horizontal page overflow. Confirmation dialogs fitted each viewport.
- Visual previews inspected desktop and narrow layouts; the final embedded review uses the same HTML file and the viewer's theme tokens.

The automated scenarios cover navigation, invalid-address feedback without moving the button, running-world deletion blocking, exact deletion phrases, backup retention, stale deletion review rejection, installing an engine without repinning worlds, uninstall blocking and world preservation, snapshot-before-update behavior, restoration to a new world, adding/revoking sample players, world creation/resource defaults, and chart geometry/focus stability.

The checks are reproducible with `design/verify.cjs` by installing the separate `design/` package and running its test script. Test tooling installed during design work lived in a temporary directory, separate from the production project.

## Limits

All state changes happen in browser memory and reset on reload. Identity lookups, update compatibility, hashes, process ownership, archive validation, credential stores, filesystem safety, and crash recovery remain production requirements, not verified backend behavior.

No Windows, macOS desktop packaging, Linux/Wayland app integration, real Paper/Fabric startup, Minecraft authentication/whitelist enforcement, or Playit network connectivity has been exercised. Native webview and accessibility testing is still required before release. The prototype is deliberately explicit about example addresses, version listings, and metrics.
