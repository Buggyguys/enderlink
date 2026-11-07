# Enderlink implementation architecture

This describes the implemented 0.3.3 application. `PLAN.md` records the original design intent; `ACCEPTANCE.md` remains the broader release acceptance checklist. Real cross-platform and remote-player verification is tracked separately in `CONTROLS-VERIFICATION.md` and `IMPLEMENTATION-VERIFICATION.md`.

## Boundaries

The Tauri 2 shell owns a Rust `Service`. React uses a single finite action dispatcher over Tauri IPC; no shell or general filesystem API is exposed to the renderer. Dialogs select import/export paths. Only the external Playit and Minecraft web domains can be opened by the scoped URL permission. No remote page runs inside the privileged application window. Release CSP disallows remote scripts. The frontend contains no credentials and no production sample data.

```text
apps/desktop/src/
  App.tsx                  Host library/dashboard, centered Host/Settings shell, dialogs
  components/Select.tsx    OS-independent accessible option menus
  components/SettingsPage.tsx  guided setup, engine inventory, effects controls
  components/MemoryPanel.tsx   dashboard memory status and settings allocation table
  components/Atmosphere.tsx    bounded decorative CSS starfield
  components/WorldHistory.tsx  local-day connected-time chart
  components/BackupTimeline.tsx  date-scaled backup dots, zoom/pan and restore review
  components/timelineMath.ts   bounded ranges and local-calendar time ticks
  components/Notifications.tsx  stacked timed feedback and persistent active work
  components/MaintenanceDialogs.tsx  reviewed reset, uninstall and library restore
  components/WorldBlock.tsx    original projected SVG blocks and optional picker
  components/GameplayFields.tsx  world rules and explicit command settings
  components/Icons.tsx         original SVG icons and Enderlink mark
  types.ts / api.ts        typed snapshot and IPC client
  styles.css / theme.css   layout, purple frost, responsive grids, reserved feedback
  App.test.tsx             production UI workflow tests with a mocked IPC boundary
apps/desktop/src-tauri/
  src/main.rs              app lifetime, safe quit, finite commands
  src/removal.rs           installation detection and inert native uninstall helpers
  uninstall/              fixed platform helper templates; no interpolated shell code
  capabilities/            dialog and scoped opener permissions
crates/core/src/
  model.rs                 serialized records, names, IDs, time
  service.rs               orchestration, SQLite, backups, recovery, command dispatch
  maintenance.rs           reviewed full reset, portable library save/restore
  downloads.rs             official catalogs, immutable artifacts, managed Java
  runtime.rs               process ownership, strict console parsing, telemetry, access properties
  activity.rs              connected-time intervals, union aggregation, checkpoints
  gameplay.rs              validated stopped-world rules and explicit operator access
  world_config.rs          legacy rules/operator adoption and bounded level.dat reading
  provider.rs              embedded Playit agent, browser authorization, keyring
  accounts.rs              verified/offline identities and backed-up account-mode changes
  status.rs                bounded Minecraft status protocol and SRV resolution
  memory.rs                cached local OS/process memory measurements
  updates.rs               cached read-only stable component update observations
  files.rs                 checksum, ownership, safe archives, durable writes
  cleanup.rs               explicit backup and managed-data removal
```

## Storage and versioning

Tauri resolves the per-user app-data directory for `io.github.buggyguys.enderlink`. The Unix root has mode 0700. An OS file lock prevents two app processes from opening the same store.

```text
app-data/
  instance.lock
  state.sqlite             versioned JSON document in transactional SQLite (WAL/FULL)
  server-owner.json        owned Java PID + start time; never a generic PID kill list
  components/<uuid>/server.jar
  java/<major>/...          private Temurin runtime and its license files
  worlds/<uuid>/instance/  complete Minecraft server directory
  worlds/<uuid>/import-previous/   temporary interrupted-import recovery
  backups/<uuid>/instance.zip
  backups/<uuid>/manifest.json    full world configuration and SHA-256
  staging/<uuid>/          downloads/extraction temporary data
  quarantine/<token>/     committed deletion awaiting final purge
```

Schema version 3 retains the versioned metadata document and deletion journal, and adds `activity_worlds`, `activity_players`, and indexed `activity_spans` tables. Versions 1/2 are upgraded after validating the document and preserving legacy on-disk gameplay rules/operators. A consistent `VACUUM INTO` snapshot named `state-before-v3-<uuid>.sqlite` is created before the single metadata/schema update. The guard prevents older executables from silently dropping offline account, gameplay and command-permission settings. Missing cosmetic fields default to no artwork. Older backups carry an unconfigured-gameplay marker and adopt their saved rules when restored. Unknown newer schemas are refused.

World and component names never form paths; generated UUIDs do. Names normalize to NFC. Worlds embed their exact component coordinates/hash/source URL. Paper/Fabric selections in Settings affect new-world defaults; existing worlds retain their pins. Reinstallation reuses the identity referenced by saved worlds/backups and checks the original digest when available. No automatic Minecraft-version migration or loader-family conversion exists.

Credentials are separate: macOS/Windows native stores or Linux Secret Service. If persistence is unavailable, an explicitly linked account works in memory for the current app session. Disconnect removes saved authorization; the provider account itself remains with Playit.

## Operations and UI state

A global async mutation lock serializes downloads, start/restart, backup, import, update, uninstall, and deletion. There is one active game process. Short metadata operations validate inputs/revisions; destructive operations revalidate immediately before commit. Read-only snapshots continue during operations. Downloads are HTTPS-only, bounded by size/time and disk checks, with SHA-256 verification where the upstream publishes one. Fabric launcher artifacts have no separately published digest in this flow: transport is official HTTPS and the computed digest is pinned thereafter.

Long actions return an operation ID. The bounded operation list reports queued/running/completed/failed state, progress, and actionable errors. The frontend polls snapshots every two seconds with a sequence guard against stale requests. This is a simpler implementation than the originally proposed event stream. Logs are bounded to 500 lines of 4,096 characters; individual incoming read chunks are also bounded. Resource charts keep 120 samples in memory. Connected-time history is stored locally in SQLite; there is no analytics service. Cancellation is honored while queued and during downloads; committed filesystem work finishes safely.

The top navigation is outside the page scroll container, with no full-width backing or blur layer that masks the sky. The content scroller reserves scrollbar space, including a persistent-scroll fallback for older webviews; switching to a long route cannot resize the header. Native scrollbar tracks, track pieces, corners, and buttons are explicitly transparent. A ResizeObserver watches the content and viewport sizes; it only paints the thumb when content actually overflows, without changing the reserved gutter. Cards use neutral translucent backgrounds with selectable opacity. Dialogs preserve draft state across snapshot refreshes. Radix provides modal focus management. Feedback regions, graph dimensions, and floating operation messages reserve space; errors do not insert new dashboard rows. Reduced motion honors both OS preference and the local setting. A lightweight preset atomically disables animations, stars, and blur; all three can also be controlled independently. The default starfield has 56 bounded particles (32/88 for other density choices), each with a separate color layer. Independent seeded samples determine placement, size, shape, path, duration, and phase; rejection sampling avoids crowded points without rows or a grid. CSS transforms move each particle along its own loop. Movement mode, speed, and color shimmer are independent preferences; no frame loop is used, and effects pause when the document is hidden. Cards keep their selected transparency if backdrop filters are unavailable; disabling glass explicitly makes them solid. Clear uses 14% surface opacity and 1 px blur, Frosted 42% / 3 px, and Dense 84% / 8 px. These strengths preserve recognizable stars in Clear instead of smearing every preset into an indistinct background. Icons and the neon linked-portal mark are original SVGs. The mark is one continuous path with tangent arcs through its center, shared by the inline and packaged artwork; the engine/provider logos are locally bundled official artwork with attribution. The UI distinguishes local process state, provider-agent state, and an assigned address. Neither a successful local status check nor an assigned endpoint proves a remote player can join.

## Server lifecycle

Java starts with an argument vector, not a shell string. World names, user paths, and addresses never become shell commands. The instance working directory isolates generated engine libraries/configuration. Java is selected for the pinned Minecraft/engine version and host architecture, downloaded from Adoptium and hash verified. No global Java installation is modified.

The server binds loopback by default for Playit; an explicit LAN setting binds all IPv4 interfaces. Generated configuration enforces the world's explicitly selected account mode, `white-list=true`, `enforce-whitelist=true`, RCON disabled, and the managed world directory. New and legacy worlds default to verified accounts (`online-mode=true`, `enforce-secure-profile=true`). Explicit offline mode disables both verification properties and derives whitelist UUIDs from MD5 of `OfflinePlayer:<exact username>` with UUID version/variant bits, matching Minecraft. Imported server properties cannot silently change this choice. The host must explicitly accept the EULA during world creation. Engine download does not accept it.

Changing account mode requires a stopped world, a current revision, and a successful complete backup. Offline identities are derived locally; returning to verified mode resolves every allowed name through Mojang before backing up or changing state. Player data files are kept under their original UUIDs, not renamed or merged. The UI explains separate inventories/progress and username impersonation; it does not represent an offline whitelist as proof of identity. Existing plugin/mod authentication is not automatically configured by Enderlink.

Readiness comes from Minecraft’s ready log message. Process RSS and CPU are real OS measurements, not Java heap usage or server TPS. Player events are supplemented by periodic `list` commands; names are bounded/validated. Verified-mode mutations to a running whitelist wait for Minecraft’s written whitelist to confirm the UUID change. Removal also sends a kick command. Offline player-list edits require stopping the world and write explicit offline UUIDs, avoiding Minecraft's name command resolving an online/cached UUID instead. Minecraft remains responsible for login behavior and permissions.

Stop sends Minecraft’s `stop` command, waits for saving and observed process exit, then releases the tunnel/sleep inhibitor. A 90-second timeout reports failure; it does not silently kill the process. Force stop requires `FORCE STOP`. Restart uses the same safe stop before launch. Closing a hosting window asks whether to save/stop/quit.

Windows owns Java via a kill-on-close Job Object. Unix launches an owned process group and records PID plus process start time. On reopening after an abnormal exit, a matching surviving process blocks world mutation. Recovery signals only that verified process; it never guesses ownership from a PID alone. Power failure and forced termination still carry Minecraft’s normal unsaved-progress risk.

## Connectivity

The implementation embeds the BSD-licensed Playit agent core and API client from upstream tag `v1.2.0`, pinned by Cargo.lock to commit `7acf13568a99707dda73028234fdb376e45b15da`. It does not install a global Playit service.

Authorization uses Playit’s browser claim setup/exchange. Only a claim URL and non-secret connection state reach the frontend; the resulting agent secret stays in Rust/keyring. Claim completion immediately performs a temporary upstream control handshake to register the bundled agent's version/platform and give Playit its compatibility schema. The control socket is then dropped; setup creates no game process or TCP/UDP forwarder. The forwarding agent runs only while hosting. Its runtime tunnel list is refreshed every 20 seconds, filtering enabled Minecraft Java tunnels. Origin destinations are overridden to the current world’s loopback port, preventing this integration from forwarding unrelated local services. Connection loss retries with bounded per-attempt timeouts. Generation numbers prevent old agent tasks from overwriting a newer connection’s UI state.

**Check connection** performs the same registration if it has not succeeded in this app session, then reads the account’s tunnel configuration while no server runs. This repairs pre-0.2.4 claims that left the agent version/schema unknown, causing Playit's dashboard to reject Minecraft Java. Successful registration is tracked separately from account linking and tunnel configuration. Checks are serialized, registration has a 45-second deadline, and disconnect/hosting transitions cancel a pending setup handshake. Checks reuse a running hosting agent instead of replacing its control connection. A failure leaves authorization linked for retry. The last observed tunnel configuration and timestamp persist separately from live endpoints, so stopping a server does not reset setup progress. Authorization and its generation are captured together; stale responses cannot update a newly linked account. Setup readiness is configuration evidence, not a remote reachability test.

The host creates the free Minecraft Java tunnel through Playit’s own dashboard. Enderlink reads its public address and reuses it across worlds. Friends paste it directly into Minecraft; no Enderlink account, room-code directory, VPN, client-side proxy, or required Enderlink-presence gate exists.

The diagnostic checker speaks the Minecraft Java status protocol over TCP with an 8-second deadline, 1 MiB response limit, strict lengths, and escaped text rendering. They advertise real protocol version 763 rather than -1, because Minecraft-aware relays such as Playit can reject the latter. A status request does not require the same protocol version as gameplay. Addresses support explicit ports, bracketed IPv6, and SRV lookup for a hostname without a port. Status checking is not game login or access authorization.

## Backups, updates, imports, and deletion

Backups require a stopped world and archive the complete instance, including dimensions, mods/plugins, configuration, and player state. Manifest plus checksum are stored outside the world so a retained backup survives deletion. Recovery discovers completed backup manifests if the final metadata commit was interrupted. Restore validates the archive hash and safe paths, checks extraction bounds, and creates a new world UUID; it never overwrites newer progress in an existing world.

Settings checks the installed inventory on entry and every 15 minutes while visible, with a backend 15-minute cache and serialized checks. Requests are grouped by engine/Minecraft version; a manual refresh bypasses the cache. These observations never install software or modify world pins. An unavailable catalog remains distinct from “up to date.”

Updates are limited to an explicit stable engine build/loader for the same Minecraft version. They install a separate candidate, verify revision/stopped state, take a complete backup, then atomically change the world’s pin. Other worlds stay pinned. The candidate is copied into the instance on the next start. If it fails, restore the prior backup into a separate world. Mod compatibility cannot be inferred from equal loader versions; the UI says it needs a matching pack.

Imports copy external files without changing their source. Server imports reject symlinks, path traversal and executable installer scripts, normalize a custom `level-name`, and replace the complete instance after a backup. A sibling `import-previous` directory permits startup recovery if the directory swap is interrupted. Individual JAR imports add/replace a mod or plugin with a pre-import backup. Java mods/plugins are executable code; trust and version compatibility remain the host’s responsibility. They are not sandboxed by Enderlink.

World deletion requires a backend-issued challenge bound to UUID, revision, exact normalized `DELETE <world name>` phrase, backup set/policy, and a five-minute expiry. Confirmation consumes the challenge, verifies that the world is stopped and unchanged, writes durable intent, renames the world into quarantine on the same volume, updates metadata, and purges only reviewed owned paths. Startup reconciles incomplete journal entries. Retained backups restore under a new UUID.

Backup deletion uses its own typed phrase. Bulk cleanup uses `REMOVE ENDERLINK DATA`, an exact reviewed world/backup inventory, stopped-process checks, and keep-world/keep-backup choices. The executable and minimal metadata database are not self-deleted. Diagnostics export an allowlisted report of platform/version/count/status fields; no credentials, endpoint addresses, usernames, absolute paths, or raw logs are exported.

## Local memory accounting

The Rust sampler caches measurements for five seconds and refreshes immediately when the managed server PID changes. It reads physical/available memory and process RSS with sysinfo; process arguments are used only locally to recognize known Java client entrypoints. No process command lines or names are returned to the renderer, logged, or persisted. The app total includes its identifiable descendants, excluding the managed server subtree. OS-owned webview helpers may instead be attributed to system/other apps.

The bar includes available memory and normalizes overlapping RSS if reported process totals exceed system usage. Numeric process estimates remain visible and explained; the residual is labeled **System & other apps**, not exact OS memory. The live breakdown belongs to the running-world dashboard. Settings retains the default for new worlds and a compact allocation table; each world has its own heap limit. Automatic headroom recommendations were removed. The same sysinfo API is used across Windows, macOS, and Linux; native platform verification is tracked separately.

## Deliberate limits

No Enderlink service/accounts, Bedrock/Forge/NeoForge support, app-controlled mod distribution, live-world backup, automatic Minecraft migration, unattended engine updates, automated backup retention, app updater, provider-independent relay, or enforced client app presence. The current native platform and remote-game acceptance evidence is explicit in the verification record. Signing/notarization and additional hardware tests need actual release infrastructure; they are not simulated by the application.


## Gameplay and connected-time history (0.3.0)

World records include `hardcore`, `pvp`, `allowCommands`, `forceGamemode` and optional `coverBlock`. Creation and editing validate game modes, difficulty and the bounded artwork catalog. `hardcore` is immutable after the first launch or saved level metadata; imported worlds retain their stored hardcore flag. Commands are implemented through `ops.json`, not an invented `allow-cheats` server property. New command grants create level-2 entries for explicitly selected allowed players. The world toggle can revoke all effective commands without forgetting selections. Existing operator levels/limit exemptions are adopted during migration, and new grants always use the narrower defaults. Identity replacements and operator changes require stopping the world. Whitelist output contains only UUID/name fields.

Console tracking strips ANSI/OSC sequences and Minecraft colour codes before parsing recognized Paper/Fabric server frames. Complete lists must have a matching validated name count. Chat/plugin lookalikes and malformed lists never become presence events. The snapshot's `playersKnown` differentiates unknown tracking from an empty server. List polling begins at readiness and repeats every 16 seconds; stale tracking pauses recording.

Activity records use one interval per player connection plus the union of time with at least one player present. Offline identities use exact-name Minecraft offline UUIDs; verified identities use known account UUIDs and never silently merge with offline records. In-memory spans are included in queries and checkpointed to existing rows about every 30 seconds. Completed spans leave memory after a successful checkpoint. Process replacement, sleep, long observation gaps and clock discontinuities do not bridge unobserved time. A crash can lose the uncheckpointed tail.

The `playtime` IPC accepts a world ID and 2–91 increasing UTC timestamp boundaries generated from local calendar midnights. Aggregation clips to observation time and unions overlapping persisted/live intervals per identity. Frontend polling is every 15 seconds while visible; requests are guarded against stale world responses. The chart offers 7/30 days, a world line, an optional player overlay, keyboard inspection and a numeric table. Earlier dates have no fabricated history. Failed refreshes retain valid readings. Restored worlds start fresh history, and permanent deletion removes only that world's activity tables.

World artwork uses twenty original SVG face designs plus None, projected into 2D CSS matrices for 3D rotation. This avoids nested `preserve-3d` differences between webviews. Motion uses bounded CSS keyframes with independent seeded duration/direction/phase, static picker previews, and visibility/reduced-motion controls. No texture is copied from Minecraft and no graphics runtime or downloaded artwork is added.

## Timeline and notification interactions (0.3.1)

The backup timeline uses the saved world creation timestamp through the current time. Zoom/pan ranges are bounded to that domain and survive two-second snapshot updates. Ticks use local calendar boundaries, including month/year steps and DST-aware day changes. Repeated fallback-hour labels include their zone. Backup circles retain actual time positions; overlapping hit areas expose a count and an exact-time selector, including backups with identical timestamps. Selection never restores automatically. Details occupy fixed space, and ordinary vertical scrolling stays with the page.

Notifications track newly completed operation IDs separately from the backend's bounded operation history. Initialization waits for a successful snapshot, so reconnecting after an initial load error does not replay old completions. Running work stays visible. Completed work and local messages expire after three visible seconds plus a short fade; hovering, keyboard focus, hidden windows and overflow outside the notification stack pause the timer. Focus is reconciled when queued actions disappear. Polling does not restart timers or resurrect dismissed messages.

World creation still requires explicit EULA consent below the account-mode selector for both verified and offline accounts. Offline authentication changes how players are identified, not the server software's license agreement. This release has no new data-schema migration.

## Complete reset and uninstall (0.3.2)

A ten-minute maintenance token binds the review to current metadata and root inventory. Execution checks the exact phrase, an idle server and empty operation queue, and acquires exclusive mutation/maintenance guards. Ordinary mutation IPC and window/OS quit requests are blocked while saving or clearing. Explicit committed uninstall uses a separate native exit authorization.

Factory reset removes all managed file entries except the live SQLite/lock files, deletes activity and deletion-journal rows, replaces metadata with defaults, vacuums/checkpoints the database and clears transient state. Old schema snapshots and quarantined files are removed. The native shell clears webview browsing data. Full Playit credential removal errors are reported before game files are deleted; the provider account is untouched.

Portable libraries contain validated typed metadata, activity rows, game files and backup archives with a SHA-256 manifest. They omit credentials, managed Java and engine caches. A new external folder is required, and all saved files are flushed before cleanup. Restore requires an empty game library, validates paths, IDs, pinned official software sources and checksums, stages files, then commits metadata/history in one database transaction. Failures roll back moved folders; existing data is not overwritten. Untrusted SQLite databases or scripts are never imported or executed.

Native uninstall verifies the currently running installation. Preparing its helper is inert; dropping preparation cancels it. The helper removes only the verified package and dedicated application directories after explicit commit and normal process exit. It never kills the app/server. Windows delegates installer registration/shortcuts to NSIS; Linux distro removal uses the owning package manager with polkit. Unsupported installations show instructions before cleanup. A save destination inside an app/data/cache deletion target is rejected. Helpers report removal failures via the OS and retain a diagnostic log in their private temporary directory.

Saved-provider authorization loads on a blocking worker after the native window setup, because OS keychain access may wait for a permission prompt. The lookup never holds the provider-auth lock while waiting. Results are accepted only for the original startup epoch; disconnect/reset/new authorization invalidates late results. Normal quit remains available during this read-only wait.

## Cross-platform controls (0.3.3)

Visible option fields use the shared Radix Select component instead of native `<select>` popups. This keeps menu backgrounds, text, focus, disabled states and selection indicators readable in Windows WebView2, macOS WKWebView and Linux WebKitGTK. Menus use a portal with bounded collision-aware scrolling, preserve dialog focus, support keyboard/typeahead navigation and handle empty selections without sentinels. Native file pickers, credential prompts and installer dialogs remain native OS surfaces. See `CONTROLS-VERIFICATION.md` for browser-engine evidence and the remaining native acceptance checks.
