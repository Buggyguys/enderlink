# Implementation verification — Enderlink 0.1.0

Historical 0.1.0 baseline; see [interface/resource verification](THEME-VERIFICATION.md) and [0.2.4 Playit setup verification](PLAYIT-VERIFICATION.md) for subsequent checks.

Recorded on 2026-11-06. This is implementation evidence, separate from the earlier `design/` prototype. The current local machine is Apple Silicon (arm64), macOS 27.0.1; the application declares macOS 13+ support. Lower supported macOS versions have not been exercised here.

## Passed locally

| Check | Evidence and scope |
|---|---|
| Rust backend tests | 20 passing tests: real child-process readiness/save/stop, active-world guards, typed/stale deletion, crash recovery, backup retention/restore, corrupt backup refusal, complete server import/level-name normalization, import recovery, cleanup inventory checks, diagnostics redaction, file traversal refusal, real loopback Minecraft status protocol/oversized responses, and single-instance locking. The process test uses a synthetic executable, not Minecraft. |
| Rust static checks | `cargo clippy -p enderlink-core --all-targets -- -D warnings`, `cargo fmt --all --check`, and native compilation pass. |
| React workflow tests | 5 passing tests on production components with a mocked IPC boundary: exact typed deletion/token, active-world deletion refusal, explicit EULA consent, Join failure without claiming login, and installation without silent world updates. |
| Production UI geometry | The actual built assets run in Chromium at 1180×830, 900×700, and 720×560. No horizontal overflow, dialogs fit/close, dashboard and Join error placement stay stable, cleanup blocks active hosting and defaults to keeping worlds/backups. No JavaScript runtime errors. These tests use test-only IPC fixtures and do not prove native webview or backend integration. |
| Frontend build | TypeScript strict checks and Vite 8.3.6 production build pass. Test dependencies updated to Vitest 5.1.0. |
| Dependency check | `npm audit --audit-level=high`: zero known vulnerabilities reported for this lockfile at verification time. |
| Official download smoke | Actual Paper/Fabric catalogs and downloads succeed. For Minecraft 1.21.1: Paper build 133 (49,394,394 bytes), Fabric loader 0.20.1 launcher (181,840 bytes), managed Temurin Java 21.0.13. Java’s `-version` executes successfully. |
| Minecraft profile lookup | The official Mojang public profile endpoint returns the expected UUID/name schema. This verifies lookup availability only, not whitelist enforcement or game login. |
| Pinned reinstall regression | The live download test stores synthetic unaccepted world pins, uninstalls each shared engine, reinstalls through its original source, and verifies unchanged component identity and SHA-256. No game process or Minecraft EULA acceptance is involved. |
| Native macOS app | Release build produces `target/release/bundle/macos/Enderlink.app` (~18 MiB). Launch succeeds and the native service opens the version-1 SQLite database with an empty world library. No game session, EULA acceptance, or provider authorization was created by this launch check. |
| macOS disk image | `scripts/package-macos.sh` produces a compressed disk image with the app and an Applications shortcut. `hdiutil verify` passes. The plain packaging path avoids Finder automation. |

## Artifacts and reproduction

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:ui
cargo test -p enderlink-core --lib --locked
cargo clippy -p enderlink-core --all-targets -- -D warnings
cargo fmt --all --check
npm run tauri -w apps/desktop -- build --bundles app --ci
sh scripts/package-macos.sh
```

The network smoke is explicitly opt-in and requires a new empty directory:

```sh
cargo run -p enderlink-core --example verify_downloads -- /tmp/enderlink-new-verification
```

It downloads legitimate upstream artifacts, runs Java’s version command, and creates only synthetic unaccepted world metadata for the reinstall regression. It never starts Minecraft. The development test directories live outside the normal application-data folder.

Local evidence logs were written to `/tmp/enderlink-native-build.log`, `/tmp/enderlink-download-verification.log`, and `/tmp/enderlink-dmg-build.log`. Logs in `/tmp` are temporary; the checks above are the reproducible record. Dependency notices are included inside the app’s Resources directory.

## Outstanding release acceptance

These checks require credentials, game clients, remote peers, or hardware that were not available as part of this implementation session. They are **unverified**, not simulated successes:

- A real Paper world and Fabric pack completing startup and gameplay after the host personally accepts the EULA.
- Actual Minecraft authentication: allowed account joins, unlisted account denied, online player revocation, matching and mismatched client packs.
- The Playit browser claim, actual credential-store persistence/revocation, public tunnel provisioning, remote friend join, and relay failure/reconnect. Integration uses the real upstream API/agent library and compiles, but a compiled SDK is not an account-level integration test.
- Windows x64, Linux x64, Arch/Omarchy Wayland, locked/missing Linux Secret Service, native accessibility/HiDPI, laptop lid/sleep/wake, disk-full faults and OS-specific crash scenarios. CI configuration is present; those jobs have not been run from this workspace.
- Developer signing, macOS notarization, Windows signing, public distribution, and an application updater. The local arm64 executable has a linker ad-hoc signature, no developer team signature, and no notarization.

The native app launch confirms process/service startup, not every native UI interaction. Production layout evidence comes from Chromium; macOS uses WKWebView. Tauri’s styled DMG packaging initially failed because Finder AppleScript timed out; the plain DMG builder subsequently succeeded without requiring that automation.
