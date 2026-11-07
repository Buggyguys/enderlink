# Enderlink 0.3.0 — worlds and activity

Implemented on 6 November 2026. This record supplements the earlier hosting, Playit, appearance and account-mode verification records.

## Delivered behaviour

- Host/Settings navigation; friends enter their address directly in Minecraft. No Enderlink accounts or client-app requirement.
- Live PaperMC/Fabric catalogues, explicit refresh and numeric newest-first stable build/loader selection. Existing world pins are unchanged until an explicit update.
- Confirmed player counts for verified and offline accounts. Coloured console output is normalized, complete lists are reconciled, and unknown tracking is distinct from zero players.
- Local 7/30-day world activity plus selectable individual-player connected time, including AFK time. World totals union overlapping players. No historical data is fabricated.
- Horizontal backup timeline with selection, scroll controls and restore review. Restores create separate worlds with fresh Enderlink history.
- Survival/Creative/Adventure/Spectator, difficulty, PvP, optional mode reset on every join, and creation-time Hardcore. Saved/imported Hardcore rules are preserved.
- Explicit per-player command permissions after enabling the world's commands option. New grants use Minecraft level 2; no player is promoted automatically. Existing operator permissions survive upgrades.
- Sixteen original decorative block designs, optional None, static previews, independent gentle motion, and global reduced-motion/glass/visibility controls.

## Automated evidence

- 64 Rust tests pass, including a real child-process console-reader test with offline player names; union/day-boundary aggregation; persisted/live deduplication; checkpoint restart behaviour; sleep/clock gaps; stale tracking; account-mode separation; deletion; operator controls; immutable Hardcore; old-data migration; saved-NBT parsing; and backup/restore preservation.
- 34 React tests pass, including gameplay submission, explicit command grants, offline counts versus unknown state, no Join route, backup review, keyboard block selection, and chart/player/day interactions. IPC is mocked in these tests.
- TypeScript and production Vite build pass. Rust formatting, frontend formatting and core Clippy with warnings denied pass.
- Production assets pass Chromium and WebKit layout/interaction checks at 1180×830, 900×700 and 720×560. These checks include full-width history, horizontal backup scrolling, restore review, selected block rendering, centered two-tab navigation, fixed scrollbar geometry, stable error regions and reduced-motion settings.
- All sixteen block designs were inspected in Chromium/WebKit. Rendering uses projected SVG faces and CSS matrix keyframes because nested CSS `preserve-3d` flattened in headless WebKit. No per-frame JavaScript loop or copied Minecraft textures were added.
- Read-only requests to the official PaperMC and Fabric APIs succeeded. For Minecraft 1.20.1 the live catalogues reported Paper build 196 and Fabric loader 0.20.1 as their newest listed stable choices at verification time. These values are observations, not application constants.

## Native package and local upgrade

The Apple Silicon release binary was built successfully, staged as Enderlink 0.3.0, locally ad-hoc signed, and verified with `codesign --verify --deep --strict`. The DMG was created and passed `hdiutil verify`:

- `target/release/bundle/macos/Enderlink.app` — updated local app, launched successfully.
- `target/release/bundle/macos-0.3.0/Enderlink.app` — staged versioned copy.
- `target/release/bundle/dmg/Enderlink_0.3.0_arm64.dmg` — installable local disk image.

The user's existing app was closed normally after confirming no running world or staged operation. The new app remained running and migrated its real schema-2 data to schema 3. Read-only checks confirmed the existing world, engine pin, account mode, allowed identities, installed components and backup IDs remained intact. SHA-256 fingerprints of the existing server properties, whitelist, operator file and saved level metadata were unchanged. The schema backup and activity tables were present. No Minecraft world was started or remote player session performed during this update. This package is locally signed, not Developer ID signed/notarized.

## Data handling

Schema 1/2 is validated and upgraded to 3 with a consistent `state-before-v3-<uuid>.sqlite` backup. Existing server rules and operator identities/levels are adopted without rewriting instance files during migration. Old backup metadata retains a marker so its saved rules can be adopted when it is restored. Imported saved worlds use their actual Hardcore flag from bounded, validated `level.dat` data.

Activity lives only in local SQLite tables. New hosting sessions begin recording; old logs are not backfilled. Checkpoints occur about every 30 seconds, so a crash can lose the latest uncheckpointed tail. Unobserved gaps and unavailable player lists are excluded. World deletion removes that world's activity; retained game backups still contain game files and world configuration. Activity history is not part of exported game ZIPs or backup restores.

## Manual acceptance after updating

1. Open an existing stopped world and check its account mode and allowed-player list. In World settings, choose an artwork block and save. Return to Host to see it; None removes it.
2. Start the world and connect two players, including an offline-name client if using offline mode. The count and list should update promptly (the periodic list poll is every 16 seconds). Leave one player connected and disconnect the other to check that count changes.
3. After a few minutes, inspect Time together. Select each player and switch between 7/30 days. The world's duration should not double when both players overlap. Stop, reopen Enderlink, and confirm the recorded activity remains.
4. While stopped, create a backup. Inspect the timeline and use Review restore. The confirmation should describe a new world, and cancelling should not restore anything.
5. Create a disposable test world for Creative, PvP and commands. Enable commands, save, and explicitly grant yourself Commands in Manage access before starting. Check a gameplay command such as `/gamemode`. Disabling the world command option and restarting should revoke it. Test Hardcore only on a disposable new world.
6. In Settings, refresh Paper/Fabric versions. Check that this does not change any existing world's version. Toggle reduced motion/lightweight mode and confirm the block and stars stop animating.

A real remote Minecraft session with these new statistics and gameplay options remains a manual acceptance step. The user's successful friend connection predates this update. Browser checks are not native Windows/Linux execution, and this machine cannot establish those platform results.
