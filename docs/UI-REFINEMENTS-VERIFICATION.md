# Enderlink 0.3.1 — interface refinements

Verified on 6 November 2026 on Apple Silicon macOS. This record supplements the historical 0.3.0 worlds/history verification.

## Changes

- A continuous backup timeline from world creation to now, with circles at actual backup times. Click to inspect the exact local timestamp, including seconds and time zone. Zoom/pan covers minute, hour, day, week, month, quarter, half-year, year and multiyear tick intervals as the world's age permits. **All time** resets the view. Nearby or identical-time backups remain individually selectable. Restore still requires a separate review.
- Removed the page footer and artwork picker arrow buttons. The picker still scrolls horizontally and supports keyboard radio navigation.
- Notifications stack at the lower right. Completed work and local messages expire after three visible seconds; running work remains. Hover, focus, hidden windows and overflow pause expiry. Historical operations are not replayed after startup or an initial snapshot failure.
- Live computer memory measurements moved to the running-world dashboard. Settings retains the default for new worlds; world settings retains each world's own heap limit. Removed automatic headroom recommendations. The allocation guide is a small collapsible table.
- Shortened account, Playit and appearance text. Lightweight mode is a single button. EULA consent sits below the account selector and remains explicit in both account modes: offline authentication does not exempt a server from the [Minecraft EULA](https://www.minecraft.net/en-us/eula).
- Added four original artwork choices: pumpkin, cake, mushroom and lantern. There are now twenty blocks plus None. No Minecraft textures were copied. Global motion/glass preferences still apply.

## Automated evidence

- 58 React tests pass. New coverage includes local calendar ticks and DST, zoom bounds, clustered and identical-time backups, selection across polling, world switches, scroll behaviour, memory placement, independent notification timers, focus removal, overflow visibility, and historical-operation suppression. Existing gameplay, account-mode and player-history tests remain green.
- 64 Rust core tests pass. New artwork IDs are accepted by backend validation without changing the schema.
- TypeScript, the production frontend build, Rust formatting, affected frontend formatting, and core Clippy with warnings denied pass.
- Production-asset checks pass in Chromium and WebKit at 1180×830, 900×700 and 720×560. Checks include timeline zoom/selection and restore review, stacked notification layout/expiry, centered navigation and stable scrollbar geometry, removed footer, moved memory breakdown, compact guide table, twenty-one artwork choices, and reduced-motion controls. IPC is explicitly mocked; no server or account changes are made.
- Isolated timeline checks also cover 480px width, recent and multiyear ranges, an empty timeline, drag pan, and coincident dots. Visual inspection caught and fixed a zero-height SVG gradient that otherwise made the line invisible in webviews.
- The four new blocks were visually inspected in Chromium and WebKit. They use the existing projected SVG/CSS rendering path.

## Native package and existing data

The final Apple Silicon release binary built successfully. The versioned app and canonical local app passed `codesign --verify --deep --strict`; the disk image passed `hdiutil verify`.

- `target/release/bundle/macos/Enderlink.app` — updated and reopened as 0.3.1.
- `target/release/bundle/macos-0.3.1/Enderlink.app` — versioned staged copy.
- `target/release/bundle/dmg/Enderlink_0.3.1_arm64.dmg` — installable local disk image.

The previous app quit normally after confirming no active world or staged operation. Post-launch checks confirmed schema 3 and unchanged hashes for the existing worlds, backups, installed components and saved settings, including account mode and allowed players. Four game files (server properties, whitelist, operators and saved level metadata) were unchanged. No world was started by the update. The app is locally ad-hoc signed, not Developer ID signed or notarized.

## Try after updating

1. Open a world and inspect Backup timeline. Select a dot, zoom in/out, drag left/right, then choose All time. Close any restore review without confirming if you only want to inspect it.
2. Trigger two ordinary notifications, such as copying an address twice. They should stack and fade after about three seconds. Keep the pointer away to allow expiry; hovering pauses it.
3. Start a world to see Computer memory in its dashboard. Settings should show only the default memory selector and collapsible allocation table.
4. While stopped, select a new artwork block in World settings, save, and return to Host. None still removes the block.

These are UI verification steps. They do not replace a real remote Minecraft session. Browser-engine tests are not native Windows/Linux execution; those platforms remain unverified on this machine.
