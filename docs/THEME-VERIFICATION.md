# Enderlink 0.2.3 — interface and resource verification

Recorded 2026-11-06 on Apple Silicon macOS 27.0.1. This release updates the implemented application, not the separate `design/` prototype. The [initial hosting verification](IMPLEMENTATION-VERIFICATION.md) remains the record for official engine/runtime downloads and the original lifecycle work.

## 0.2.3 glass and branding correction

Clear, Frosted, and Dense now change blur as well as opacity: 14% / 1 px, 42% / 3 px, and 84% / 8 px respectively. The previous shared 12 px blur erased tiny background stars even in Clear. Unsupported blur no longer forces an opaque card; the explicit glass switch still provides solid surfaces. Settings calls the selection **Glass finish**. The linked-portal mark uses one continuous curve through its center instead of touching stroke caps, including all desktop bundle icons. The header wordmark is **Enderlink**.

The 8 React tests and full Chromium/WebKit UI checks pass. A focused production-asset check selects each finish through Settings and captures the same stopped-motion starfield behind the empty Host card. The three rendered results were visually compared: recognizable stars in Clear, softer stars in Frosted, strongly muted stars in Dense. Comparing each card with its starfield hidden also confirmed actual background transmission. The check confirms the displayed wordmark and a single path in the hero logo. Screenshots: `/tmp/enderlink-finish-chromium-{clear,frosted,dense}.png`; comparison: `/tmp/enderlink-finish-comparison.png`. No game or provider state is involved.

The 0.2.3 arm64 app rebuilt (~18.02 MiB), launched, and preserved all saved metadata (verified by hash comparison). The DMG passed `hdiutil verify`. Current artifacts: `target/release/bundle/macos/Enderlink.app` and `target/release/bundle/dmg/Enderlink_0.2.3_arm64.dmg`. DMG SHA-256: `75dd277814c58b815dbe7d97b3a018d3e48712bfd6e2a83cfbff245088f940fc`. Build logs: `/tmp/enderlink-glass-native-build.log`, `/tmp/enderlink-glass-dmg-build.log`. Native appearance still merits the user’s macOS visual check; the rendered comparison described above uses Chromium. The earlier patch and baseline records follow.

## 0.2.2 scrollbar correction

The page scrollbar now has an explicitly transparent track, including WebKit track pieces/corners. A size observer hides the thumb on pages that fit, and reveals a small purple thumb only when scrolling is needed. The gutter stays reserved, preserving the existing no-shift behavior. No hosting or storage logic changed in this patch.

The 8 React workflow tests, TypeScript build, and full Chromium/WebKit production layout checks pass. A focused browser check also passed on both engines: transparent track pieces on Host/Join/Settings; invisible thumb on the fitting Host/Join pages; visible Settings thumb; Page Down scrolling; thumb visibility updating after resize; unchanged navigation position. The resulting screenshots were reviewed. The 0.2.2 arm64 app rebuilt and relaunched successfully; a hash comparison confirmed all saved application metadata was preserved. The DMG passed `hdiutil verify`. This checks startup and packaging, not native scrollbar appearance; that still merits the user’s macOS visual check.

0.2.2 artifacts: `target/release/bundle/macos/Enderlink.app` and `target/release/bundle/dmg/Enderlink_0.2.2_arm64.dmg`. DMG SHA-256: `c74778026150d5782389c0867f138327f17672cf7956851d1fe30880e666589e`. Build logs: `/tmp/enderlink-scroll-native-build.log`, `/tmp/enderlink-scroll-dmg-build.log`.

Manual check: switch Host / Join / Settings and resize the window; the right edge should have no opaque track and the header should stay still. Scroll Settings with the trackpad/mouse wheel and by dragging the handle. Pages that fit should have no visible handle.

The remaining sections record the 0.2.1 baseline, whose backend coverage remains relevant to this UI-only patch.

## Delivered

- Original linked-portal mark in neon pink/purple, replacing the angular monogram. Original SVG action icons remain; all desktop bundle icons were regenerated.
- Independently scattered pixel, cross, and diamond stars with varied sizes, different motion paths, phases, and durations. No index-based lines or common seven-pixel drift. Neutral glass is more transparent by default, with selectable opacity. The full-width header backing is removed; the navigation control keeps its glass surface.
- The header is outside a dedicated content scroller. Reserved scrollbar space prevents route changes from moving the navigation. Tests exercise classic scrollbars as well as ordinary overlay behavior.
- Simplified Host with one contextual setup/create action and no “Made for your people” section. Installed software removes setup prompts from the empty library.
- Centered Settings; stateful hosting steps with completed/attention colors, an “All good” state, and persistent tunnel configuration separate from current live endpoints.
- Official bundled Paper, Fabric, and Playit artwork. The software switch saves the default for new worlds; version downloads, installed inventory, update checks/review, and uninstall preserve existing world pins.
- Cross-platform Rust memory sampling, a live breakdown, separate server heap allocation guidance, and a short memory guide. Process figures are estimates; unidentifiable helpers/clients remain in system/other apps.
- Persisted controls for animation, stars, glass, density, movement (free drift / gentle float / still), independent star speed, color shimmer, glass opacity, and interface pace. Effects default on for new settings; OS reduced motion is respected. Lightweight mode disables all animation and removes star/blur layers in one atomic settings patch.

## Checks passed

| Check | Evidence and limits |
|---|---|
| Backend | 26 Rust tests pass, including old-settings defaults, persisted partial appearance changes, real local memory sampling and caching, Minecraft client recognition, cached update observations without changed pins, tunnel setup surviving stop, and stale-generation/disconnect protection. Existing lifecycle, import, backup, status, and deletion tests also pass. |
| Static checks | `cargo clippy -p enderlink-core --all-targets -- -D warnings`, `cargo fmt --all --check`, TypeScript, and the release native build pass. |
| UI workflows | 8 React tests pass: typed deletion and running-world guard, explicit EULA consent, truthful Join behavior, downloads without silent updates, a single empty-library action, hidden setup prompts after installation, and default-engine switching without world conversion. |
| Production assets | Chromium and WebKit 27.2 tests pass at 1180×830, 900×700, and 720×560. Checks cover centered/sliding navigation, transparent header, stable navigation/content viewport with an explicitly exercised classic scrollbar, centered responsive Settings, bounded memory panel, stable dashboard/Join errors, fitting dialogs, safe cleanup, setup progress after stop, and update attention. No JavaScript runtime errors. |
| Effects | With 56 stars at default speed, the median displacement over 1.4 seconds was about 10.8 px in both engines. Tests verify varied sizes, independent movement/shimmer controls, a 3.6× slow-to-lively speed ratio, working glass-opacity choices, the sliding selection, zero running animations and no blur/stars in lightweight mode, and OS reduced motion. |
| Visual review | Generated production screenshots were inspected for Host, the Settings header/software selector, star distribution, and the new linked-portal icon. They use explicit test-only IPC fixtures, not live game/player data. |
| Native macOS | The 0.2.1 arm64 app builds (~18.03 MiB) and launches. The existing version-1 database opens, keeps its empty world/component/backup inventory, and receives the new appearance fields while retaining previously saved appearance preferences. No game process, EULA acceptance, or provider authorization was created for this check. |
| Packaging | The 0.2.1 arm64 DMG is built with the plain packaging script; `hdiutil verify` reports a valid checksum. The executable has a linker ad-hoc signature, no developer-team signature/notarization. |

The native launch is a startup/integration smoke check, not exhaustive interaction testing of WKWebView. Automated layout and motion evidence comes from Chromium and WebKit with a test-only IPC boundary. Headless WebKit reports the blur CSS correctly but does not render backdrop blur, including on an isolated plain-HTML control page. Its screenshots therefore do not verify native frosted-glass rendering; Chromium renders the blur. Memory unit tests use actual local OS counters; the UI fixture supplies deterministic categories for layout checks.

## Reproduce

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:ui
npx playwright install webkit
ENDERLINK_TEST_BROWSER=webkit npm run test:ui
cargo test -p enderlink-core --lib --locked
cargo clippy -p enderlink-core --all-targets -- -D warnings
cargo fmt --all --check
npm run tauri -w apps/desktop -- build --bundles app --ci
sh scripts/package-macos.sh
```

Artifacts:

- `target/release/bundle/macos/Enderlink.app`
- `target/release/bundle/dmg/Enderlink_0.2.1_arm64.dmg`
- DMG SHA-256: `16304b6284740dc105ed4078481b4c349af47b387e855dc80e94c51d7c33e223`

Build logs were recorded in `/tmp/enderlink-motion-native-build.log` and `/tmp/enderlink-motion-dmg-build.log`. Temporary screenshot files are `/tmp/enderlink-settings-chromium.png`, `/tmp/enderlink-settings-webkit.png`, and `/tmp/enderlink-host-{chromium,webkit}.png`; the scripts reproduce the underlying checks.

## Remaining platform and network acceptance

The implementation and CI configuration target Windows, Apple Silicon macOS, and Linux including Arch/Omarchy. Windows/Linux builds and native rendering, platform-specific memory attribution, credential stores, Wayland/HiDPI, and lower supported macOS versions have not been exercised here. Real Minecraft gameplay, a matching Fabric pack, Playit account authorization and remote friend connectivity still require the manual acceptance checks recorded in the initial verification document. No hosting/tunnel success is inferred from a passing UI test.
