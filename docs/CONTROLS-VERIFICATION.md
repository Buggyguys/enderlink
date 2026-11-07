# Enderlink 0.3.3 — cross-platform controls

Verified locally on Apple Silicon macOS, 7 November 2026. This is an interface compatibility update; it does not change world storage, account authentication, Java supervision or tunnel behaviour.

## What changed

All 15 visible native select fields now use a shared React/Radix Select component. This includes Paper/Fabric catalogs, installed software, account modes, gameplay options, appearance settings, default memory, backup selection and player comparison. The open menu has an opaque dark background and explicit text, selection and focus colours, independent of OS appearance and the app's glass setting. Options wrap, long lists scroll, and the menu positions within the viewport rather than being clipped by a card or dialog.

Keyboard arrows, Home/End, typeahead, Enter/Space and Escape remain available. Focus returns to the trigger after closing. Escape inside a menu leaves the containing dialog open. Empty selections such as “World activity only” round-trip correctly. Loading/disabled fields cannot open, and an open menu closes if its field becomes unavailable. A catalog refresh does not silently commit a different choice.

Text inputs have explicit caret, placeholder and disabled colours, including WebKit text fill. Radio buttons are excluded from text-input sizing. High-contrast themes use system colours; navigation gradient text remains visible even when the browser removes background images. Missing blur support and exposed OS reduced-transparency preferences use solid card/dialog surfaces. File/folder choosers and OS prompts keep native rendering.

The component uses [Radix Select](https://www.radix-ui.com/primitives/docs/components/select) for focus and keyboard semantics. See [Tauri's webview reference](https://v2.tauri.app/reference/webview-versions/) for Windows WebView2, macOS WKWebView and Linux WebKitGTK differences.

## Local verification

- 74 React tests pass, including the shared select's empty choice, duplicate names, keyboard focus, disabled/removed choices, and existing world/settings/history/maintenance flows.
- TypeScript and the production Vite build pass. Dependencies and third-party notices are updated.
- Production assets pass in both Playwright Chromium and WebKit using explicit mock IPC, without real downloads, credential changes, reset, uninstall or world creation.
- Menus were checked under both light and dark OS appearance. Every enabled option in the tested menus has at least 4.5:1 measured foreground/background contrast, with an opaque menu background.
- Chromium's forced-colours emulation passes in light and dark contrast themes. The selected navigation label remains visible. Screenshots were inspected for contrast mode and the WebKit dialog menu.
- A 70-entry version catalog supports Home/End navigation and scrolling. Memory selection supports keyboard typeahead. Opening menus preserves navigation geometry.
- Menus fit the minimum 720×560 window, including enlarged control text and placement at the bottom edge. A long account-mode label remains readable inside its dialog. Escape closes the menu without dismissing the dialog.
- Existing responsive layout, effects, stable error, timeline, history and maintenance-dialog checks continue to pass.

`npm test`, `npm run build`, `npm run test:ui`, and `ENDERLINK_TEST_BROWSER=webkit npm run test:ui` reproduce the local interface checks. Screenshots are saved to the operating system's temporary directory.

## Platform limits and acceptance

Chromium is not the installed Windows WebView2 runtime, and Playwright WebKit is not macOS WKWebView or Linux WebKitGTK. Native Windows and Linux sessions were not available locally. The GitHub workflow is configured to build all three platforms and run Chromium on each plus WebKit on macOS/Linux; no remote CI result is claimed here.

Before a public release, open Settings and a world-settings dialog on each native target. Check version/account menus using mouse, arrows, typing and Escape, and verify disabled choices while hosting. Test Windows display scaling at 100%, 150% and 200% and its contrast themes; test macOS Increase Contrast/Reduce Transparency and VoiceOver; test Ubuntu and Arch/Omarchy under the actual Wayland/X11 session, including scaling and keyboard focus. Native screen-reader behaviour and OS file/credential dialogs require those real environments.

On the local Mac, start with Settings → Minecraft version, then Star density, and World settings → Player account mode. Opening, navigating and canceling these menus is enough to review the change; no world or account-mode change is required.

## Local package

The Apple Silicon release build completed successfully. Both the versioned bundle and updated local app passed ad-hoc signature verification; the compressed DMG passed `hdiutil verify`.

- `target/release/bundle/macos/Enderlink.app` — updated local app, opened successfully.
- `target/release/bundle/macos-0.3.3/Enderlink.app` — versioned staged copy.
- `target/release/bundle/dmg/Enderlink_0.3.3_arm64.dmg` — local installer.

Native launch inspection reported `isFinishedLaunching=true`, `isTerminated=false`. Before/after checks confirmed unchanged schema 3, world/backup/component/settings metadata and six game configuration/data files. No world was running during the update. The package is locally ad-hoc signed, not Developer ID signed or notarized.
