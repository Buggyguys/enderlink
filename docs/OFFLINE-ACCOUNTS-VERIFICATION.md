# Offline account support — Enderlink 0.2.5

Recorded 2026-11-06. The host requested support for friends using unauthenticated launcher accounts. The option applies to both Paper and Fabric; verified Minecraft accounts remain the default.

## Behavior

- Create a world with an explicit **Player accounts** choice, or save/stop an existing world and use **World settings → Change player account mode → Offline accounts → Back up & use offline accounts**.
- Existing-world changes require the current revision and a successful full backup. Offline mode writes `online-mode=false` and `enforce-secure-profile=false`, retains the whitelist, and converts the allowed-player list to Minecraft's exact-name offline UUIDs. No automatic conversion of inventories, ender chests, progress, operators, or entity ownership is attempted. Existing player files remain under their original identities.
- Offline player-list changes require a stopped world. Enderlink writes the correct UUIDs directly, avoiding Minecraft's name command looking up an authenticated/cached profile. Exact capitalization matters. Offline lookups make no Mojang requests; switching back to verified mode must resolve all names before changing anything.
- The UI explicitly labels usernames as unverified and explains impersonation. A whitelist alone does not authenticate offline players. Password-login plugins/mods are not installed or configured automatically.
- App metadata upgrades to schema 2 after a consistent SQLite backup in the app-data directory. Older Enderlink executables refuse this version instead of accidentally forcing verification on an offline world. Legacy worlds and backups default to verified accounts.

Primary references: [Paper server properties](https://docs.papermc.io/paper/reference/server-properties/), [Fabric's mapped Minecraft offline UUID API](https://maven.fabricmc.net/docs/yarn-1.20.1+build.10/net/minecraft/util/Uuids.html), and [the `OfflinePlayer:` prefix](https://maven.fabricmc.net/docs/yarn-1.20.1+build.10/constant-values.html).

## Connection checker

The old status query advertised protocol version -1. Live diagnostic probes showed Playit resetting that request while accepting real protocol values 763 and 47 for the same address. Enderlink now sends 763 (Java 1.20.1) for status checks; gameplay version compatibility is still enforced by Minecraft. The protocol regression fixture rejects negative version values so this behavior cannot silently return.

An attempted live check of the updated Rust implementation found the world had been stopped: localhost refused the connection and the public tunnel timed out. This does not establish remote gameplay connectivity. A **Connection refused** error remains a transport issue, separate from account verification.

## Verification

The test suite covers offline UUID vectors/capitalization, both server engines, backup-before-switch and preserved player files, backup restore with the original identities, active/stale/failed-backup guards, offline access with network lookups deliberately blocked, default verified behavior, and schema migration/downgrade protection. UI tests cover explicit selection, active-world restrictions, accurate identity labels, and the new-world default.

Production layout checks include the account-mode dialog at 720×560 and confirm switching its help text does not change the dialog or feedback height. These use test-only IPC fixtures.

Passed: 38 Rust tests, 14 React workflow tests, Clippy with warnings denied, formatting, TypeScript/Vite production build, and the Chromium production-layout checks. The macOS arm64 release binary was built separately while the existing app bundle remained untouched. After confirming that the world and installations were stopped, the updated bundle was installed locally and reopened as 0.2.5. Native startup migrated the existing metadata to schema 2 and created one pre-migration SQLite backup; the one existing world remained in verified mode and was not started or converted.

The app's ad-hoc signature verification and `hdiutil verify` both passed. Installer: `target/release/bundle/dmg/Enderlink_0.2.5_arm64.dmg`. This is a local development build, not a developer-notarized release.

Actual offline Minecraft login, plugin/mod password protection, and execution on Windows/Linux remain user/hardware acceptance checks. The host must explicitly choose offline mode in the app; a successful code test does not prove that a friend's network can reach the tunnel.
