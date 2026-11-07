# Enderlink — product and interface design

Approved direction: local Minecraft Java hosting, Paper/Fabric, Playit, no Enderlink accounts, direct Minecraft addresses. The 0.2.3 production theme below supersedes the original green visual direction. The companion `design/enderlink.html` remains an earlier interactive prototype using illustrative versions, metrics, players, and simulated operations. It never downloads software, connects to a provider, or deletes real files.

## Product model

- **World:** a named saved server instance, including all dimensions, settings, engine version, mods/plugins, and player permissions.
- **Session:** one period during which the world is running. Stopping a session preserves the world.
- **Server software:** downloaded, pinned Paper/Fabric versions. Multiple versions may coexist. An engine is not a separate desktop application.
- **Connection:** the host's provider setup or explicit direct/LAN choice. One active world initially reuses the chosen hosting endpoint.
- **Player access:** Minecraft authentication and the host's whitelist. Copying an address, checking server status, or opening Enderlink grants no access.

Use ordinary language in product copy: “world,” “server software,” “allowed players,” “copy address,” and “save and stop.” Reserve process IDs, loaders' internal coordinates, manifests, and provider error codes for expanded diagnostics.

## Information architecture

Persistent top navigation: **Host · Settings**, centered inside a frosted segmented control with original SVG icons. Show a small active-world status alongside navigation. No permanent sidebar. Switching tabs preserves the running session and starts the selected page at the top. The header is outside the page scroller, so its position and width do not depend on scrollbar visibility.

Host has a world library and a world dashboard. Create/import uses a modal wizard with an internally scrolling content area. Friends join through Minecraft using the address shown on the host dashboard; Enderlink has no Join page, room-code directory or player-side bridge. Settings is one vertically scrolling page with clear section boundaries. Dialogs handle confirmations, update plans, details, player permissions, and world settings; a drawer handles the console.

Initial route is Host/library. The prototype opens the dashboard to demonstrate the design and offers “All worlds” to reach the library. Empty installations show one primary “Set up hosting” action until software is installed, then one “Create world” action. Host does not repeat setup buttons or show a generic “Made for your people” section. Once configured, ordinary Host use shows no setup prompts.

## Visual system

Deep near-black purple surfaces, soft lilac borders, white text, neon pink/purple accents, and neutral translucent glass with three distinct finishes: Clear (visible stars, light blur), Frosted (softened stars), and Dense (muted background). Independently scattered stars of varied sizes drift along different paths and shift between violet and pink across every route. The transparent header leaves the sky visible; only the segmented navigation control has a glass surface. The navigation indicator visibly slides; selected text/icons fade to a pink/purple gradient, while inactive labels stay white. Production tokens live in `theme.css`; no external fonts or remote theme resources are required.

Spacing scale: 4, 8, 12, 16, 24, 32 px. Card radius around 14 px; controls around 8 px. Body text 14–15 px, supporting text at least 12 px, page titles 24–28 px, numeric readouts 24–30 px. Use a system UI font stack and tabular digits. Original SVG icons replace emoji. The original Enderlink mark is a pair of linked neon portals. Official Paper, Fabric, and Playit logos identify their respective software/services and are bundled with attribution. No Minecraft game textures are bundled.

Use fluid grid layouts with deliberate constraints: three columns at wide desktop widths, two at medium widths, one in compact windows. Small statistic cards can remain in two columns when legible. Minimum product window target: 720×560; the design also adapts below that width for embedded review and text scaling. At small heights, the page scrolls and modals scroll internally; actions must remain reachable.

Layout stability rules:

1. Every form has a reserved feedback region. Errors replace that content; they do not insert a new row that pushes the form.
2. Buttons keep a fixed minimum inline size and constant block size while working. Spinners replace an icon without changing geometry.
3. Charts have fixed plot heights. Metric text has tabular digits and a reserved unit area.
4. Lists and logs use bounded viewports with stable scrollbar gutters. Long names truncate with an accessible full label/details view.
5. Transient notices live in a fixed overlay. Persistent failures use an existing status region with a details action. No error disappears solely because a toast expires.
6. Drawers and modal dialogs overlay rather than resize the dashboard. Their appearance must not change chart widths.
7. Skeletons have the same dimensions as loaded content. Updating metrics does not rerender the whole route or reset focus/scroll.
8. Use opacity/transform transitions and a 300–480 ms sliding selection. Decorative star motion is visible and bounded, with independently adjustable density, movement style, speed, and color shimmer. Interface pace is a separate control. Avoid card-height animation and automatic chart-axis jumping. Respect `prefers-reduced-motion` and the app’s animation switch; both disable all animations/transitions. A lightweight preset removes stars and blur too.

Keyboard navigation, visible focus, text status labels, appropriate contrast, and semantic headings apply throughout. Dialogs have a name and description, trap focus, close on Escape before commit, and restore focus. Use polite live regions for ordinary progress and assertive announcements for actionable failures. Production UI primitives should provide this behavior rather than hand-written focus traps.

## Host: world library

Header: “Your worlds” with a short description and Create world. Import server is a secondary action. Each card shows name, engine, Minecraft version, status, last played, and total instance size. Clicking Open enters the dashboard. A context menu contains Rename, Open files, Export, and Delete.

One-active-world constraint: if a different world is running, opening another dashboard is allowed but Start explains which world needs to stop. Never silently disconnect the current players. Empty and missing-engine states are first-class, with Create and Reinstall actions respectively.

## Create and import

Four steps: **World → Software → Resources → Review**.

World: name, optional seed, game mode/difficulty. Validate 1–64 Unicode characters after NFC normalization, disallow control characters, and display allowed characters without using the name as a filesystem path. Duplicate names may be rejected within the local library for clarity; immutable IDs identify instances.

Software: Paper/Fabric descriptions, supported Minecraft version, available pinned build/loader, and installation requirements. Use installed compatible components where possible; otherwise show a one-click prepare action. Fabric offers server-pack import or manual mods/config import. Describe client pack requirements. Do not offer arbitrary engine conversion.

Resources: an explicit server memory limit, player cap, and advanced options collapsed. Distinguish requested heap maximum from observed process memory; Enderlink does not make an automatic memory recommendation.

Review: versions, storage estimate, connection mode, initial player access, and explicit Minecraft EULA checkbox/link. Downloading an engine in Settings never implies acceptance. Create can save an unstarted profile; starting requires accepted terms and satisfied dependencies.

Import creates a new managed instance, preserves the original, validates archive entries, and never executes supplied setup scripts. Preview recognized engine/version/world/config/mod directories. If a pack is unsupported or missing essential metadata, explain the specific limitation before copying a partially usable world.

## Host: world dashboard

Header contains All worlds, name, engine/Minecraft labels, state badge, and the appropriate primary action (Start or Save and stop). Actions such as Back up, World settings, and Console remain secondary.

- **Overview:** process memory versus allocated maximum, CPU, online players versus cap, and session duration. Values unavailable while stopped show a dash with an explanation.
- **Resource history:** CPU and process memory over a bounded recent time window. Stable scales, readable units, and a textual current/min/max equivalent. Do not label process RSS as JVM heap.
- **Connection:** Local server ready, tunnel state, assigned public address, and observed endpoint response time with timestamp. Show when external reachability has not been independently confirmed. Copy address is available only when an address is known.
- **Players:** authenticated player names/UUID-based state, observed online status, and Manage access. Offline allowed players live in the access dialog, not the connected list.
- **Recent activity:** lifecycle, player, backup, and operation events with bounded history and readable timestamps. Secrets and arbitrary terminal escape codes are removed.
- **Protection:** last successful backup, engine update availability, and recovery actions. A backup timestamp means the archive completed and passed validation, not just that copying started.

Copy address feedback is a small overlay; the address card does not resize. Optional Copy joining instructions includes the address, exact Minecraft version, and host-supplied pack instructions as plain text. It creates no special link, token, or room-code infrastructure.

Console opens a fixed-width overlay drawer on large windows and a full-width overlay on narrow ones. Initial scope is logs plus a carefully scoped command entry for experienced hosts; unsupported/privileged commands are distinguished from the ordinary UI actions. Do not expose RCON publicly.

## Player access

“Allowed players” explains: “Only these Minecraft accounts can join. Friends do not need Enderlink.” A host adds a Minecraft username; the server's authenticated identity resolution produces a UUID and canonical name. Show Pending, Added, or an actionable lookup error.

Server properties default to online authentication, whitelist enabled, and effective whitelist enforcement. Paper documents the relevant settings in its [server properties reference](https://docs.papermc.io/paper/reference/server-properties/); validate equivalent vanilla/Fabric behavior for supported versions.

Revocation shows whether the player is currently online and states that removal disconnects them. Backend completion means permission removal and effective disconnection are verified or a clear partial-failure status is shown. Adding to the whitelist does not grant operator privileges.

“Require Enderlink to stay open” is not a first-release setting. It would require authenticated association between an app device and a Minecraft account, plus an enforcing server plugin/mod or private gateway. Hiding a public address or receiving unauthenticated heartbeats would not provide that protection. Ordinary whitelist access meets the current straightforward-joining requirement without that infrastructure.

## Direct joining

The implemented first release does not include a Join page. The host dashboard shows the local and public Minecraft addresses, and friends paste the public address into Minecraft Java → Multiplayer → Direct Connection. Friends do not need Enderlink or a Playit account, and Enderlink can be closed after the host has started the world. Access is enforced by Minecraft authentication and the host's allowed-player list; an address copy or status observation never grants access.

## Settings: vertical order

Settings uses a centered column up to 880 px wide, with responsive cards and no sidebar.

1. **Hosting setup:** four stateful tiles for software, account link, configured tunnel, and a first world with access permissions. Done steps turn violet/pink; update/check failures use an attention color. “All good” appears when configuration is ready. Stopping a session preserves the last verified tunnel setup. Remote reachability remains a separate live status.
2. **Server software:** branded Paper/Fabric switch saves the default for new worlds. Both can be installed; existing world pins stay unchanged. Version selectors and one download button include private Java. The inventory displays updates, dependent worlds, and uninstall/review actions.
3. **Connection provider:** official Playit branding and three concise steps, account/agent state, browser authorization, and Check connection / Open provider / Disconnect. No Enderlink login or provider password field.
4. **Memory:** a live stacked bar for system/other apps, Enderlink, recognized game clients, hosted server, and available memory. Explain estimation and refresh cadence. The default heap limit and compact allocation table distinguish the server from the game and the OS; there is no automatic headroom recommendation.
5. **Appearance:** animations, stars, glass, density, star movement/speed, color shimmer, glass finish, interface pace, and a one-click lightweight preset. Effects are enabled on a fresh install, except motion when the OS requests reduction. Changes persist locally and apply everywhere.
6. **Hosting behavior:** prevent-sleep preference and safe-close explanation.
7. **Backups and storage:** browse/export/restore, usage and cleanup, data folder, cache cleanup, and redacted diagnostics. Removal choices distinguish software from worlds/backups; OS uninstall limitations are explicit.

## Engine download, update, and uninstall

Installing a newer version and updating a world are distinct actions. Software inventory displays which worlds use each exact version. Stable-version checks run when Settings opens, then every 15 minutes while visible, with a 15-minute backend cache and a manual refresh. Group requests for identical engine/game versions; never install or apply updates automatically. Offline use can start existing worlds; update metadata is labeled as cached.

**Download:** show source, exact Minecraft/engine/runtime versions, size where known, progress, cancel, and retry. Commit the component inventory only after validation. A failed download leaves existing versions usable.

**Update review:** show old/new Minecraft/build/loader, affected world, compatibility checks, disk requirements, and backup behavior. Same-Minecraft Paper build updates and Fabric loader updates use explicit version-aware checks. A new Minecraft version is a separate migration and cannot be treated as a routine patch. Fabric metadata checks can find declared incompatibilities but cannot prove all mods work; use an explicit review status.

The apply sequence is stop → snapshot → verify snapshot → stage dependencies → change pinned binding → validate startup → report. A failed snapshot blocks the update. Restore after a world has started under new software requires restoring the matching full snapshot and prior binding, not merely swapping an older JAR. Never silently discard new player progress through automatic restoration.

**Uninstall review:** list exact versions, estimated reclaimable size, shared Java/runtime effects, and affected world names. Running use blocks removal and provides a route to stop. Stopped dependent worlds may be kept with a “Software missing — reinstall” state after explicit confirmation. Remove does not delete worlds, mod configuration, or backups. Unused cache/runtime deletion is a separately described choice.

## Delete world

Accessible from the world library menu or World settings → Delete world. The dialog is deliberately distinct from Stop, engine uninstall, and backup deletion.

1. Show full world name, engine, folder size, and what will be removed: dimensions, builds, inventory/player data, mods/plugins/config, and the local profile.
2. If running or busy, disable deletion and offer Save and stop / View current operation. Return to a fresh review after the operation completes.
3. Default **Keep existing backups** on. Show backup count/size. If none exist, offer Back up first; do not falsely promise recovery.
4. Require typing exactly **`DELETE <world name>`**, for example `DELETE Mossy Hollow`. Normalize Unicode consistently; matching is case-sensitive and tied to the reviewed world revision. Do not substitute the misspelling “DELEYE.”
5. Enable **Delete world** only after the phrase matches and prerequisites hold. Deletion is irreversible after purge; do not show an Undo action unless backed by a real retention mechanism.
6. Backend rechecks the world ID, revision, challenge, name, requested backup policy, locks, and owned paths. UI disabling is not the enforcement mechanism.
7. Completion returns to the library and provides a persistent activity record. Kept backups appear under “Backups from deleted worlds” and can restore into a new world ID. Partial cleanup displays “Removed; disk cleanup pending,” with retry/details.

A separate backup deletion flow also states what is lost. Full app cleanup summarizes all selected worlds and backups; a single-world phrase cannot authorize deleting unrelated data.

## States and error copy

Examples: “Server is ready on this computer. Connecting your public address…”; “Tunnel disconnected. Your world is still running locally.”; “This version is required by Mossy Hollow. Uninstalling keeps the world, but you’ll need to reinstall before starting it.”; “Backup failed. Your world has not been updated.”

Every asynchronous action has idle, working, success, recoverable failure, and cancellation behavior. Route navigation does not cancel critical server operations. The global operation indicator links back to an operation. On app restart, recover the backend snapshot and operation journal before displaying final states.

## Prototype boundaries

The interactive prototype covers the world library, create wizard, live/stopped dashboard, address sharing, player management, console, backups/restore, update review, typed deletion, an earlier illustrative Join/status screen, and Settings component lifecycle/setup. Sample data is prominently labeled. Its operations are simulated in memory and reset on reload. Provider linking, imports, and filesystem actions explain their eventual behavior rather than pretending to affect the computer. The prototype's Join screen is retained only as historical design material; it is not part of the production navigation.

Production release status is tracked separately in the architecture and acceptance documents. A convincing interface is not evidence of functioning hosting, compatibility, secure credentials, or platform packaging.
