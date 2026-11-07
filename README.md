# Enderlink

Host Minecraft Java Edition on your own computer. Enderlink manages Paper, Fabric, Java, worlds, backups, and an optional Playit tunnel in a purple, starry desktop interface. Friends join using a normal Minecraft server address. **There are no Enderlink accounts.**

The application is implemented in Rust/Tauri 2 and React/TypeScript. See [0.3.3 cross-platform control verification](docs/CONTROLS-VERIFICATION.md), [0.3.2 reset and uninstall verification](docs/MAINTENANCE-VERIFICATION.md), [0.3.1 interface refinement verification](docs/UI-REFINEMENTS-VERIFICATION.md), [0.3.0 worlds and history verification](docs/WORLDS-HISTORY-VERIFICATION.md), [0.2.5 account-mode verification](docs/OFFLINE-ACCOUNTS-VERIFICATION.md), [Playit setup verification](docs/PLAYIT-VERIFICATION.md), [interface verification](docs/THEME-VERIFICATION.md), and the [initial hosting verification](docs/IMPLEMENTATION-VERIFICATION.md) for what has actually been tested. The standalone `design/` prototype is a separate design artifact with simulated data.

## Download

The [latest GitHub release](https://github.com/Buggyguys/enderlink/releases/latest) provides direct downloads for supported desktop targets:

- [Windows x64 installer](https://github.com/Buggyguys/enderlink/releases/latest/download/Enderlink-windows-x64-setup.exe)
- [macOS Apple Silicon disk image](https://github.com/Buggyguys/enderlink/releases/latest/download/Enderlink-macos-arm64.dmg)
- [Linux x64 AppImage](https://github.com/Buggyguys/enderlink/releases/latest/download/Enderlink-linux-x64.AppImage)
- [Ubuntu/Debian x64 package](https://github.com/Buggyguys/enderlink/releases/latest/download/Enderlink-linux-x64.deb)

Each release includes a SHA-256 checksum beside every installer. Builds are currently unsigned and macOS packages are not notarized, so the operating system may show its normal first-run warning. No account is needed to download or use Enderlink. The links become available after the first tagged release is published.

## First session

1. Open **Settings → Server software**, choose Paper or Fabric and a Minecraft version, then **Download selected version**. The compatible Java runtime is installed privately with the engine.
2. For internet hosting, use **Settings → Playit connection** to link a free Playit account in your browser. Wait for **Device registered** in Enderlink. In Playit, choose **Minecraft Java → Playit Network (Global Anycast)**, click **Refresh agents**, select the Enderlink agent, and use local address **127.0.0.1:25565**. Use **Check connection** in Enderlink after creating the tunnel. This also registers agents linked by older Enderlink versions if Playit says “tunnel type not supported”; you can reuse the existing account and agent. Enderlink activates forwarding only while hosting and always targets the active world's local Minecraft port. No port forwarding is needed for this route. Provider availability and free-tier terms are controlled by Playit.
3. In **Host**, create a world, select an installed version, and read/accept Minecraft’s EULA yourself. Engine downloads alone do not accept it.
4. Open the world and add **your own Minecraft Java username and your friends’ usernames** to its allowed-player list. Worlds use verified Minecraft accounts by default. A stopped world’s **World settings → Change player account mode** offers offline accounts; Enderlink backs up the world before switching and rebuilds the allowed identities. In offline mode, use exact launcher names, including capitalization, and edit the list while stopped. Accounts are not verified: anyone can impersonate an allowed name, so public offline hosting needs a compatible password-login plugin/mod for identity protection. Verified/offline identities have separate inventories and progress; existing player files are kept, not automatically migrated.
5. **Start world**. First startup can take several minutes while the engine downloads its libraries. Join locally at the displayed `127.0.0.1:port`. Share the public Playit address with friends once the local server is ready and the tunnel is assigned.
6. Use **Save and stop** when finished. Your computer and Enderlink must stay running while friends play. The optional sleep inhibitor cannot override every laptop lid or OS power policy.

Friends need the matching Minecraft version and, for Fabric, compatible client mods. They do **not** need Enderlink or a Playit account. They paste the public address into Minecraft’s Multiplayer screen. Enderlink has **Host** and **Settings**; joining happens directly in Minecraft.

## Worlds and software

- Minecraft versions and stable Paper builds/Fabric loaders come from the official PaperMC Fill v3 and Fabric Meta v2 APIs. **Refresh versions** reloads the catalog; nothing is hardcoded into the dropdowns. Enderlink filters to supported stable Minecraft releases (1.18+).
- Create/edit a world with Survival, Creative, Adventure or Spectator, difficulty, PvP and an optional game-mode reset on every join. Hardcore uses Survival/Hard and is chosen before first start; existing generated worlds keep that rule. Changes require stopping the world.
- **Allow player commands (cheats)** enables explicit player permissions. After saving, use **Manage access → Commands** beside each chosen player. New grants are Minecraft operator level 2 (gameplay commands); enabling the world toggle alone grants nobody access. Existing operator permissions are preserved on upgrade. Offline names, including operators, remain unverified.
- Choose **None** or one of 20 original purple/pink block designs (including pumpkin, cake, mushroom and lantern) as world artwork. The choice is decorative, stays in backups, and can be changed while stopped. Motion and glass follow the global effects settings.
- Multiple worlds and installed engine versions; one world runs at a time. Changing the Settings engine toggle changes the default for new worlds only.
- Paper supports plugins. Fabric supports Fabric mods; it does not run Forge or NeoForge packs. Use trusted **server** files for the selected game version/loader. Do not blindly copy a client pack’s mods.
- Add a mod/plugin JAR or import a server folder/ZIP from World settings. Imports require a stopped world and create a backup first. A server folder/ZIP **replaces the instance**, including its world data; mod/plugin imports add individual JARs. Scripts in imported server packs are rejected, never executed.
- Settings lists installed versions, their dependent worlds, and stable update availability. Checks run when Settings opens, then at most every 15 minutes while it is visible; **Check updates** forces a refresh. A world’s **Check updates** offers stable engine builds/loaders for its current Minecraft version. Applying one backs up the complete stopped instance first. Minecraft version migration and Paper↔Fabric conversion are deliberately unavailable.
- Uninstalling a downloaded engine preserves worlds and backups. A missing engine can be reinstalled from its original pinned source and checksum. If the original source disappears, Enderlink reports the problem rather than substituting a different version.
- The dashboard’s **Backup timeline** runs from world creation to now, with each backup positioned at its actual time. Zoom from minutes to years, drag to pan, or use **All time** to reset. Select a dot for its exact local timestamp; closely spaced backups remain individually selectable. **Review restore** opens a confirmation before creating a separate world. Backups contain the complete stopped server instance and retain the app’s pinned world metadata alongside the ZIP. Restore creates a separate world. Exported ZIPs are ordinary server folders; they do not include Enderlink’s database, Playit credentials, or managed Java. Reimport into a matching world to use an exported archive.
- World deletion requires `DELETE <exact world name>`. Backups are kept by default. Individual backup deletion has its own typed confirmation.
- **Settings → Backups & storage → Clear all data…** is a factory reset: it deletes all managed worlds, backups, downloaded software, play history, preferences, old metadata snapshots and local Playit authorization. Enderlink stays installed. It requires `CLEAR ENDERLINK DATA`, a fresh inventory review and no active world/operation.
- **Uninstall Enderlink…** removes the current installed app and its dedicated local data. If worlds/backups exist, choose **Save to a folder** (default) or **Delete everything**. The save is completed and flushed before cleanup starts; it includes game files, mods/plugins, backup archives, account-mode/allowed-player settings and play history. An empty library skips that question. Confirm with `UNINSTALL ENDERLINK`. Your Playit account and existing external exports are not deleted.
- **Restore saved library** imports an Enderlink saved folder into an empty world library and checks file hashes before committing it. Installed engine caches and managed Java are excluded from saved libraries; reinstall each world's pinned software after restoring. Existing worlds/backups are never overwritten.
- Automatic app removal supports macOS app bundles, Windows NSIS installations, Linux AppImages, and recognized Linux distro packages with polkit. Development/unpackaged builds, MSI installations without a recognized uninstaller, or Linux without automatic authorization show OS-specific instructions before cleanup. See [platform details](docs/PLATFORMS.md). **Manage → Remove managed data…** remains available for partial cleanup with selected worlds/backups kept.

## Player activity

The dashboard reads confirmed Paper/Fabric console player lists for both verified and offline accounts. Terminal colours are stripped before parsing, and player chat cannot impersonate a server event. If the list is unavailable, Enderlink displays a waiting state rather than claiming zero players.

**Time together** shows the last 7 or 30 local calendar days. World activity counts time with at least one observed player connected; overlapping players count once. Select a player to overlay their individual connected time. It measures connection time, including AFK time, not keyboard/mouse activity. Offline and verified identities stay separate.

Recording begins with hosting sessions started in 0.3.0; old sessions are not reconstructed. History stays in the local database with a checkpoint about every 30 seconds, so a crash can lose the most recent half-minute. Sleep, unavailable player lists and unobserved gaps are excluded. Restoring a backup creates a new world with fresh Enderlink history. Deleting a world also deletes its history; retained game backups still restore its files and settings.

## Appearance and memory

Settings is a centered, vertically scrolling page. The hosting checklist remembers verified tunnel configuration after a world stops and flags engine updates or connection problems. “All good” means configuration is ready; it does not claim that a remote player has tested the connection.

The default theme uses an original neon linked-portal mark, custom SVG icons, neutral translucent glass, and independently scattered stars of varied sizes. Stars follow different drifting paths while shifting between pink and purple. The centered Host / Settings control slides between selections; the transparent header sits outside the scrolling page so scrollbar changes cannot move it. Under **A little atmosphere**, choose star density, movement (free drift, gentle float, or still), star speed, color shimmer, glass finish, and interface animation pace. **Clear** uses light blur and lets stars show through; **Frosted** softens them; **Dense** strongly mutes the background. Stars, glass, and all animation can also be disabled independently. **Use lightweight mode** disables all three together. Preferences are saved locally; the system’s reduced-motion preference also disables all motion. There are no downloaded fonts, remote artwork, canvas loops, or per-frame JavaScript for the background.

**Computer memory** in the running-world dashboard shows local memory measurements about every five seconds: system/other apps, Enderlink, recognized Minecraft clients, the hosted server, and available memory. Categories are estimates based on operating-system and process counters. Shared pages, OS-owned webview helpers, and unrecognized game clients can affect attribution; the UI explains these limits. No process command lines leave the Rust memory sampler.

**Settings → Default memory for new worlds** controls the initial Java heap limit, independently of your game launcher. Each world retains its own limit in World settings. A small collapsible allocation table explains starting ranges; there is no automatic memory recommendation. Disabling effects reduces graphics work, but exact RAM savings depend on the operating system/webview.

Notifications stack in the lower-right corner and fade after three visible seconds. Hovering or keyboard focus pauses dismissal; unfinished operations remain visible. Completed work from previous sessions is not replayed.

## Run from source

Install a current stable Rust toolchain (edition 2024), Node.js 22.12+ with npm, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS. Java is not needed to build Enderlink.

```sh
npm ci
npm run dev
```

Build the frontend and native desktop package:

```sh
npm run build
npm run desktop:build
```

For just the macOS app: `npm run tauri -w apps/desktop -- build --bundles app`.
Native bundles are written to `target/release/bundle/`. On macOS, `sh scripts/package-macos.sh` creates a plain disk image from the built app without Finder automation. Local packages are unsigned/unnotarized unless you configure your own signing identity. No signing credentials are included.

Run the complete local publishing gate after installing dependencies and Playwright's Chromium browser:

```sh
npm run validate
```

This gate scans the public tree for local data, checks version consistency, runs the unit/UI/Rust checks, builds the frontend, checks formatting and Clippy, audits dependencies, and verifies the design prototype. It uses mock IPC and temporary fixtures; it does not contact Playit, start Minecraft, or read your app-data directory. On macOS or Linux, set `ENDERLINK_VALIDATE_WEBKIT=1` after installing Playwright WebKit to repeat the UI checks in WebKit.

```sh
npm test
cargo test -p enderlink-core --lib
cargo check -p enderlink
cargo fmt --all --check
npx playwright install chromium
npm run test:ui
```

An explicit network smoke check downloads official artifacts into a **new empty directory**, validates them, and runs Java’s version command. It neither starts Minecraft nor accepts its EULA:

```sh
cargo run -p enderlink-core --example verify_downloads -- /tmp/enderlink-download-check
```

[Platform setup and packaging](docs/PLATFORMS.md) covers Windows, Apple Silicon macOS, Ubuntu, and Arch/Omarchy. The repository includes CI for native builds; configuring CI is not evidence that those jobs have run.

## Project

- `apps/desktop/src/`: live UI, typed IPC client, production styles and workflow tests.
- `apps/desktop/src-tauri/`: desktop shell, restricted capabilities, package configuration.
- `crates/core/src/`: server/runtime management, official downloads, Playit integration, SQLite metadata, backups and deletion recovery.
- [Architecture](docs/ARCHITECTURE.md), [UI specification](docs/DESIGN.md), [approved plan](PLAN.md), [acceptance matrix](docs/ACCEPTANCE.md).

## Tests and contributions

The test suites are part of the open-source project and should be run by contributors and in CI:

- `npm test` runs the React/component tests in jsdom, including dialogs, account modes, history, backups, maintenance flows and the shared cross-platform dropdown.
- `npm run build` runs strict TypeScript checks and creates the production frontend.
- `npm run test:ui` runs the built frontend in Playwright Chromium with mocked, test-only IPC. `ENDERLINK_TEST_BROWSER=webkit npm run test:ui` repeats the same checks in WebKit. These tests never access your real Enderlink data, credentials or Minecraft installation.
- `npm run validate` is the pre-push publishing gate; it combines the public-data scan, version check, tests, build, UI checks, prototype checks, Rust formatting/tests/Clippy and dependency audit. Set `ENDERLINK_VALIDATE_WEBKIT=1` on macOS/Linux for the additional WebKit pass.
- `cargo test --workspace --locked` runs Rust/core and native-shell tests using temporary fixtures and synthetic processes.
- `cargo clippy --workspace --all-targets --locked -- -D warnings` and `cargo fmt --all --check` enforce Rust quality.
- `npm audit --audit-level=high` checks the locked JavaScript dependency tree.

The optional `verify_downloads` example performs a real upstream Paper/Fabric/Java download only when you explicitly run it with a new empty directory. It does not accept the EULA or start Minecraft. Browser screenshots, build outputs, release assets, logs, `target/`, `node_modules/`, and local application data are intentionally ignored by Git. See [the documentation index](docs/README.md) before changing the release checks.

The optional `verify_playit_setup` example is a live diagnostic, not part of `npm run validate` or CI. Run it only after closing Enderlink and only when you intend to use the existing local Playit authorization; it contacts Playit, reads the app's credential store and app-data directory, and prints status flags without printing the authorization or starting a server. Use a disposable profile when testing a new checkout.

Enderlink is MIT licensed. See `THIRD_PARTY_NOTICES.txt` for dependency notices; regenerate it with `python3 scripts/generate-notices.py` after dependency changes. Bundled Paper, Fabric, and Playit logos come from their official projects; see [brand credits](apps/desktop/public/brands/README.md). Minecraft and downloaded engines/runtimes retain their own licenses. Not an official Minecraft product; not approved by or associated with Mojang or Microsoft.
