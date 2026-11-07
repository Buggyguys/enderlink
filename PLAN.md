# Enderlink — proposed product and implementation plan

> Historical planning document. The production first release supersedes the early Host/Join/Settings proposal with **Host/Settings** and direct Minecraft address joining. The original Join design remains below to preserve decision history; see `docs/DESIGN.md` and `README.md` for the implemented behavior.

Status: approved baseline, revised for the full design phase. Interactive design and implementation specifications are being produced; a working hosting backend is not yet implemented.

Working name: Enderlink, taken from this repository. Research checked on 6 November 2026. Provider capabilities and packaging details must be rechecked during implementation.

## 1. The product

Enderlink is a desktop app that helps someone run a Minecraft Java Edition server on their own computer, save and manage its worlds, and invite friends over the internet. Minecraft runs on the host's hardware; Enderlink manages the software and connection.

The app opens with three primary choices: **Host**, **Join**, and **Settings**. Users should not need a terminal, edit configuration files, install Java manually, or understand port forwarding to use the recommended hosting mode.

Confirmed direction, incorporating your follow-up requirements:

- Windows x64, macOS Apple Silicon, and Linux x64, including Arch/Omarchy and Ubuntu.
- Tauri 2 with a Rust backend and React/TypeScript frontend.
- Paper for ordinary/plugin servers and Fabric for modded servers in the first complete release.
- A free third-party provider account is acceptable for hosting only. Playit is the recommended provider after comparing the options below; direct/LAN connectivity remains an alternative.
- No Enderlink accounts, subscriptions, owned relay infrastructure, or mandatory player-side installation.
- A polished dark interface with a persistent top bar: **🏠 Host · 🔗 Join · ⚙️ Settings**. Use emojis alongside text, never as the only label.
- A responsive dashboard built from cards, charts, player lists, connection status, and address-sharing controls, with stable layout during errors and restrained animations.
- Settings includes a Paper/Fabric selector, one-button downloads, and management of both engines as internal components of Enderlink.
- Several saved server profiles, with one running at a time in the initial release.
- Initial validation with a small friend group, roughly 2–8 players; actual capacity depends on the host, world, mods, and connection.

## 2. Corrections to the earlier conversation

**Free hosting is achievable; universal connectivity without infrastructure is not a promise we can make.** Direct internet connections need a reachable host, such as port-forwarded IPv4 or usable IPv6. Hole punching fails on some networks; signaling only helps peers discover each other. A relay actually transports traffic when a direct path fails. A free cloud account does not guarantee enough free bandwidth or permanent availability. See [RFC 5128](https://www.rfc-editor.org/rfc/rfc5128).

**A tunnel provider and custom peer-to-peer networking are different designs.** This plan chooses an existing game tunnel for the initial release. We will not build custom UDP transport, a virtual network adapter, or a matchmaking service as prerequisites.

**Playit currently fits the desired player experience.** It advertises free Minecraft hosting tunnels with no player-side software. The host uses an agent and provider setup; players connect to a public Minecraft address. Its service, limits, latency, and availability remain external dependencies. See [Playit](https://playit.gg/).

**Cloudflare Tunnel is not an interchangeable public Minecraft TCP endpoint.** Its documented arbitrary TCP route requires client-side connection software. That adds a different joining flow and is not the default. Ngrok's free TCP endpoints require a valid payment method. See [Cloudflare supported protocols](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/protocols/) and [ngrok TCP endpoints](https://ngrok.com/docs/universal-gateway/tcp/).

**The app and the Minecraft server are separate programs.** Rust does not remove Java from Minecraft. Enderlink will manage a compatible Java runtime privately, without replacing the user's system Java. Requirements vary by server version; there must be no single hardcoded Java version. See [Paper requirements](https://docs.papermc.io/paper/getting-started/).

**Tauri does not mean an entirely Rust UI.** The server management stays in Rust; the interface uses web technology. Networking does not require Tauri, but Tauri is a good fit for the requested polished desktop interface. Linux still has system webview dependencies. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

**Paper is not a Forge/Fabric modpack server.** Fabric also does not support Forge or NeoForge packs. The exact Minecraft version, loader, pack version, and required shared mods matter. The launcher brand does not need to match. Client-only mods should not be blindly copied into the server; prefer the pack author's server distribution. See [Fabric server installation](https://fabricmc.net/use/server/).

**A room invitation is not access control.** A public address can be shared further. Keep Minecraft authentication enabled and use a player whitelist, with explicit host management. Players still need their normal legitimate Minecraft access; “no accounts” means no extra Enderlink or tunnel account for joining.

**The app must not accept Minecraft's EULA silently.** Show it and record an explicit host decision before enabling a server. Download server software from its official source rather than bundling Minecraft itself. See [Minecraft EULA](https://www.minecraft.net/en-us/eula).

The earlier Antigravity SDK example is not a validated implementation recipe and will not be treated as an available API. Parallel implementation should use the actual agent tools available in the development environment, after module contracts are agreed.

## 3. Scope and user journeys

### Top-level navigation and saved worlds

Keep **🏠 Host · 🔗 Join · ⚙️ Settings** in a persistent top navigation bar. Open to the world library in Host by default, while allowing a first-time player to immediately choose Join without encountering hosting setup. Keep a compact active-session indicator in the top bar so users can change tabs without losing context.

Use **World** for the saved, persistent server profile and **Session** for the period when it is running. Avoid making users create a separate room for each play session. A world includes its dimensions, engine, configuration, mods, and player permissions. Its card shows the name, Paper/Fabric, Minecraft version, last played, and current state. Offer **Create world** and **Import server**; selecting an existing card opens its dashboard. Keep several saved worlds and one running session initially.

### Host

1. **Create or import a server profile.** Choose a name, Paper or Fabric, a supported Minecraft version, and optionally a seed. Explain Paper as “ordinary Minecraft with optional server plugins” and Fabric as “mods; players may need the matching pack.” Include a link to the pack requirements field.
2. **Choose resources.** Recommend memory based on available RAM, reserve capacity for the OS and local game, and expose advanced settings separately. Explain that modpacks may need more resources; avoid one universal RAM promise.
3. **Prepare software.** Show exact Java, Minecraft, and loader versions; obtain explicit EULA acceptance; download and verify required files. Show progress, cancel, retry, required disk space, and actionable failures.
4. **Set up connectivity.** Choose Playit, LAN, or direct internet. Recommend Playit for remote friends. Provider setup is per host account/installation, not repeated for every world.
5. **Configure players.** Enable the whitelist by default. The host adds permitted Minecraft players using supported server commands and sees lookup or authentication failures clearly.
6. **Start the session.** Show separate server and connection status. “Server ready locally” must not be labeled “reachable from the internet” merely because a process started.
7. **Invite friends.** Copy the public Minecraft address, with optional plain-text version/modpack instructions. Show the host's own local address separately.

The dashboard shows the server name, version/loader, player count and names when available, allocated memory, useful process metrics, and clear Start/Stop/Restart/Copy address actions. Cards cover server health, connection health, memory/CPU history, connected players, address sharing/access, and recent events. Do not invent tick-rate or per-player metrics unsupported by the engine. A console drawer and advanced settings are available without dominating the normal flow.

Implement a telemetry adapter per engine. Baseline metrics come from process sampling, engine lifecycle events, Minecraft status queries, and supported player-list commands/log events. Reconcile player lists periodically instead of trusting an unbounded log history. Optional richer engine integrations can add tick-rate or per-player ping later. Charts label unavailable/stale data and use honest measurements: endpoint response time is not automatically a player's in-game ping, process memory is not Java heap usage, and connected TCP sockets are not authenticated players. Keep a bounded in-memory history with fixed sampling intervals; no cloud analytics or user accounts are needed.

Closing the app while hosting asks whether to stop safely, keep running in the background, or cancel. Supported background behavior must work on Linux desktops without depending on a visible tray icon. Explain that sleep, shutdown, and loss of internet interrupt hosting; offer an explicit prevent-sleep-while-hosting setting where supported.

### Join

1. Show a Minecraft server address input and **Check server** button.
2. Validate the address, query public server status, and show online/offline/unknown plus any advertised version information. Provider-specific details and mod requirements are only shown when actually known.
3. Provide **Copy address** and concise Minecraft Multiplayer instructions. Save the address locally if requested.

Friends can paste the host's address directly into Minecraft without Enderlink. There are no invitation codes, special links, local forwarding bridge, or required player accounts in Enderlink. A status check does not connect a player to the game or authorize them.

Access is controlled by Minecraft authentication and the host's whitelist. Requiring players to keep Enderlink connected is a separate, deferred feature: it would need authenticated identity binding and enforcement by a server integration or authenticated network gateway. Merely opening Enderlink, hiding an address, or setting a presence flag cannot enforce this.

### Settings

Use a single vertical scrolling page, grouped from top to bottom. Avoid a second navigation sidebar for this screen. Place hosting setup first and remember completed steps; joining never requires completing them.

- **Hosting setup:** a short numbered guide: choose an engine, download it, link the provider, verify the connection, and create a world. Reuse the same setup state and components in the Host wizard.
- **Server software:** a Paper/Fabric segmented selector sets the default for new worlds and selects which component to manage. Show the exact Minecraft/build/loader version, disk size, and **Download**/**Update**/**Remove** action. Download includes the compatible managed Java runtime if needed. Both engines may be installed together. Existing worlds keep their engine/version; changing the selector does not convert them.
- **Connections:** provider description, official setup links, guided steps, connection verification, reconnect/disconnect, and optional credential persistence. Show only supported providers as selectable choices.
- **Java and storage:** managed runtime status, optional custom Java selection, disk usage, data location, and download cache controls.
- **Resources:** defaults for memory, player limits, and sleep behavior.
- **Appearance and accessibility:** theme, reduced motion, readable scaling, keyboard support, and persistent text labels.
- **Backups and diagnostics:** retention/storage limits, export diagnostics with secrets removed, app version, and update information.
- **Storage and removal:** show engine/runtime/cache/world usage separately, remove unused downloaded versions, and offer **Remove Enderlink and managed components**, with explicit choices for preserving/exporting worlds and backups.

## 4. Connection architecture

### Provider decision

Recommend **Playit for the first release**, as the best fit among the reviewed options for free Minecraft hosting with host-only setup. This is a requirements-based recommendation, not a claim that it provides the lowest latency in every country.

- **Playit:** explicitly supports free Minecraft tunnels, no credit card is advertised as required, players need no agent, and the upstream agent has Windows/Linux/macOS support. Extra protocols such as voice-chat UDP may require paid features. Integration automation and distribution still need the milestone-0 proof. [Official service](https://playit.gg/) · [official agent](https://github.com/playit-cloud/playit-agent).
- **ngrok:** supports public TCP, but free TCP endpoints require a valid payment method. This adds onboarding friction for the target users, so it is not the default. [Official TCP documentation](https://ngrok.com/docs/universal-gateway/tcp/).
- **Pinggy:** supports TCP, but its free tunnels time out after 60 minutes and restarting changes the address. This is unsuitable for uninterrupted Minecraft sessions. [Official plans and FAQ](https://pinggy.io/#prices).
- **Cloudflare Tunnel:** arbitrary TCP requires client connection software and a different access model; it does not meet the simplest direct-Minecraft joining goal. [Official protocol documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/protocols/).

Ship one well-supported provider rather than filling Settings with speculative integrations. Keep the adapter boundary so another provider can be added if its free service is a better fit later. Never ask users for payment details in Enderlink; keep provider login in the provider's official browser flow. No Enderlink account database, login UI, password reset, or developer-owned identity backend is part of the architecture.

### Host connection

In the default mode, the traffic path is: **friend's Minecraft → Playit public endpoint → host's Playit agent → local Minecraft server**. Enderlink controls the local processes and presents their status. The game world is always on the host computer.

Use the maintained Playit agent behind a Rust provider adapter, preferably as an app-managed foreground child process. Do not assume the provider's standard installer is a harmless sidecar: current upstream packaging can install background services. The first technical milestone must establish a supported foreground integration, credential injection, release artifacts or reproducible source builds, and clean process ownership on every target platform. See the [official agent source and packaging documentation](https://github.com/playit-cloud/playit-agent).

Prefer a provider-supported browser claim/link flow over asking users for a broad account API key. Where supported, also accept the exact agent credential type with explanatory text and validation. A credential field alone cannot provision a cloud server or guarantee a tunnel exists. If a provider step cannot safely be automated, show the precise dashboard step and verify the resulting tunnel afterward.

The provider contract covers setup, verification, start, stop, endpoint discovery, health events, and credential removal. Persist one provider connection reference and let profiles select it. Reuse the endpoint when practical for the one-active-server design; friends must be told when an address changes.

For direct mode, show LAN addresses and a guided port-forwarding path. Java gameplay normally needs TCP; extra UDP services are pack-specific. Do not automatically open router ports. Automated UPnP/NAT-PMP/PCP and a self-hosted relay adapter can be added later with their own setup and tests.

Status distinguishes local readiness, agent connection, assigned public address, and actual external reachability. A probe from the host is useful but does not prove every remote network can connect. Verify the release with a friend on a separate network.

### Address sharing and access

Copy the provider-assigned public Minecraft address and optionally a plain-text message with version/pack instructions. No short-code directory, invitation parsing, custom deep links, or player-side proxy is required.

Keep `online-mode=true`, `white-list=true`, and the compatible engine's whitelist enforcement enabled. The host adds players by their Minecraft names, which resolve to authenticated game identities. Removing a currently connected player must include explicit effective revocation (kick/reload as supported), not just a misleading visual removal.

An optional future “Enderlink required” mode is outside this release. It requires an independently designed authenticated protocol and server-side enforcement; an app-presence checkbox is not access control.

## 5. Application architecture

Build a modular desktop application, not a collection of network services.

- **Frontend:** Tauri 2, React, TypeScript, Vite, Tailwind CSS, and accessible headless UI primitives. Use design tokens for spacing, typography, color, focus, and motion. The frontend never receives stored credentials or unrestricted shell/filesystem access.
- **Desktop bridge:** narrow typed Tauri commands, a restrictive content security policy, scoped capabilities, and typed progress/status events. External provider setup opens in the system browser, not privileged embedded remote content.
- **Rust application core:** Tokio tasks, validated domain types, per-profile operation locks, cancellations, timeouts, and error codes mapped to useful user actions.
- **Runtime manager:** discover custom Java or install a verified official runtime for the target OS/architecture. Select it from engine/version requirements, cache it, and pin it per profile.
- **Engine adapters:** Paper and Fabric expose supported versions, requirements, installation, launch commands, readiness checks, and graceful shutdown. Future Forge/NeoForge adapters fit the same interface without pretending the install commands are identical.
- **Process supervisor:** owns Java and the tunnel process, streams bounded logs, handles restarts, protects against duplicate launches, and tracks actual child identity. Use process groups on Unix and Job Objects or an equivalent verified strategy on Windows. Do not kill a process solely because a stale PID matches.
- **Connectivity adapters:** Playit and direct/LAN, with explicit provider capabilities rather than a universal “paste token” abstraction.
- **Server discovery:** bounded Minecraft status requests with address validation, DNS/SRV support, cancellation, timeout handling, and truthful observed status.
- **Storage:** SQLite for profiles, preferences, sessions, connection references, backup metadata, and schema migrations. Server files and world data remain normal folders in platform-standard app data locations.
- **Secrets:** native credential storage on Windows/macOS and Secret Service on Linux. Some Arch/Omarchy installations have no unlocked credential store: offer session-only use and an explanation. Do not silently fall back to plaintext. Ensure the managed agent does not create an unprotected persistent copy; verify this during the integration milestone.
- **Backup manager:** safe snapshots, retention limits, disk checks, restore validation, and export. Initial backups stop the server gracefully before copying the complete instance; live backup protocols are a later feature.

Keep core logic separate from Tauri so tests can exercise installations and process supervision without a GUI. Use a small number of crates/modules initially; split more only when justified.

Each profile records a stable ID, display name, engine, exact Minecraft/loader/build versions, Java runtime reference, resource settings, data directory, connection reference, EULA acceptance, and backup policy. Each operation and running session has its own ID, timestamps, and progress state.

Server states include uninstalled, preparing, stopped, starting, running, stopping, and failed. Connection states are independent: unconfigured, connecting, connected, degraded, and disconnected. Startup events need sequence/session IDs so late asynchronous results cannot overwrite a newer session's state.

Installation is staged and committed only after validation. Downloads use HTTPS, bounded retries, available trusted checksums/signatures, and cached pinned versions. Treat redirects and archive contents carefully; reject path traversal, escaping symlinks, and unreasonable expansion sizes. Never pass names, paths, or addresses through a shell command string.

Default to authenticated Minecraft, whitelisting, and RCON disabled. In tunnel mode, bind the game to loopback where compatible. LAN/direct access uses an explicit interface setting. Do not expose the desktop command bridge or administration interfaces to the public network.

## 6. Server and modpack behavior

### Contained, app-managed components

Paper and Fabric are internal managed components, with no separate application shortcuts or required standalone GUI. Settings downloads versioned artifacts into an Enderlink-owned location; the Host flow uses those same components automatically. A component manifest tracks versions, checksums, sizes, installation state, and references from worlds. Reuse compatible Java downloads and versioned engine artifacts where safe, while keeping each world's writable configuration/data separate.

App-owned storage is distinct from physically writing into the executable bundle. Signed macOS bundles and Windows program directories are unsuitable for mutable downloads. Use platform-standard Enderlink data/cache directories, never global Java installation or unrelated Minecraft launcher directories. A download operation stages and verifies data before it appears as Installed. A pending download can be canceled without damaging an existing version.

Removing an engine in Settings first identifies dependent worlds and running sessions. Stop active use safely and explain that affected worlds will need a reinstall before starting. Remove only the selected engine artifacts/cache, not saved worlds, and reclaim a Java runtime only when no remaining profile/component uses it. Engine download itself does not silently accept Minecraft's EULA.

Provide an explicit cleanup/uninstall flow that stops owned processes, removes managed engines/Java/cache, disconnects local provider credentials, and optionally exports or deletes worlds/backups. Default to preserving worlds and make deletion a deliberate action. Windows installers can expose this cleanup through the uninstaller; macOS/Linux need a supported cleanup workflow too. Removing local credentials does not necessarily remove a provider-side tunnel/account; link to provider controls or use an explicitly confirmed supported revocation action.

**Platform limit:** arbitrary deletion of a macOS `.app`, a Linux executable/AppImage, or a package cannot reliably invoke cleanup of user data. Do not promise that dragging the app to Trash removes every downloaded component. Full removal is guaranteed only through Enderlink's documented uninstall/cleanup path; explain this in Settings and uninstall instructions.

### Worlds and modpacks

The first release offers new Paper and Fabric profiles, pinned version selection, and controlled import of existing server folders or server-pack archives for those supported engines. Stage imports into a fresh managed directory; leave the original intact.

Import does not run arbitrary bundled shell scripts. Supported engines use verified launch recipes; unsupported packs receive a clear explanation. User-selected mods/plugins still execute code inside Java and must come from sources the host trusts; archive validation does not sandbox them.

Fabric configuration includes installing compatible mods/configuration and showing the required client pack. A pack import preserves relevant configs, libraries, scripts as non-executed files where appropriate, and world data; copying only the mods folder is insufficient for many packs. Server/client mod parity is not always correct because client-only and server-only mods exist.

No automatic mod redistribution or guaranteed arbitrary pack conversion. Client mod synchronization, Modrinth/CurseForge browsing, and loader-specific installers for Forge/NeoForge are later integrations unless your chosen pack makes them first-release requirements.

Never silently upgrade a running world, loader, or modpack. An update is explicit, checks compatibility, takes a backup, and retains a recovery path. Do not offer destructive engine switching as a dropdown on an existing world. Unsafe downgrades and incompatible migrations must be blocked or performed on a separate copy with clear limitations.

## 7. UI direction and quality requirements

Aim for a calm desktop utility with a little Minecraft character, rather than a dense administration dashboard. Use readable modern typography, restrained accent colors, generous spacing, clear status labels, and a consistent primary action on each screen. Avoid copying Minecraft artwork or branding.

Keep the top navigation stable across Host, Join, and Settings. Within Host, a saved-world library leads to a focused session view with a back-to-worlds control. The first-run wizard shows progress and a back button; advanced options remain available without interrupting the normal route. Settings stays vertically organized. Avoid a permanent sidebar initially; secondary details can use a modal or overlay drawer.

Use a responsive CSS grid: typically three card columns on wide windows, two on medium windows, and one on narrow windows. Cards have intentional minimum heights; chart areas and player-list viewports reserve their dimensions. Charts keep a bounded number of points and stable numeric formatting, with tabular digits for frequently changing values. The layout changes at responsive breakpoints because the user resized the window, not because an API request succeeded or failed.

Prevent visual jumps deliberately: reserve form feedback space, keep button width/height unchanged for loading labels, place transient toasts in an overlay, and keep persistent errors in an established status region with accessible announcements and a details action. Long errors scroll/expand inside a designated region or open details; they never push adjacent cards unexpectedly. Skeletons match final content geometry. Preserve scroll/focus across data refreshes and virtualize bounded log/player lists only where needed.

Use short, restrained opacity/transform transitions, approximately 120–200 ms, for button feedback, tab content, and overlay drawers. Do not animate page dimensions or card reflow on every status update. Respect reduced-motion preferences. If a sidebar is added later, overlay it or reserve its width; opening it must not repeatedly resize charts or shove the dashboard sideways.

Design empty, loading, downloading, ready, reconnecting, error, and stopped states alongside the happy path. Errors say what failed and provide the next useful action: retry a download, select compatible Java, resolve a port conflict, reconnect the provider, or view the relevant log.

Target keyboard operation, visible focus, screen-reader labels, reduced motion, and WCAG AA contrast. Never communicate state by color alone. Validate long server names, log wrapping, high-DPI displays, small desktop windows, and Linux window decorations/Wayland behavior.

The approved design phase establishes the design tokens and clickable interface prototype first. Then connect a small working hosting flow to the design before expanding the remaining screens. UI quality is a milestone acceptance criterion throughout the build.

## 8. Delivery sequence and completion criteria

### Milestone 0 — confirm the risky integrations

Prove a managed Paper server and compatible Java can start/stop locally. Verify Playit provisioning or guided claiming, endpoint retrieval, credential handling, foreground process behavior, macOS ARM support, and licensing/redistribution requirements. Test a direct Minecraft connection through the provider on another network. Establish the app-owned component layout and platform cleanup constraints.

Pass condition: a reproducible written integration recipe for every target platform, a measured end-to-end connection, and a clear account/free-tier boundary. If a platform/provider integration fails, resolve or narrow it openly before building UI promises around it.

### Milestone 1 — app foundation and design

Create the Tauri/Rust/TypeScript project, typed contracts, local schema/migrations, error model, design system, top navigation, and Host/Join/Settings screens with realistic state fixtures. Include the world library, responsive dashboard cards, chart placeholders with reserved geometry, step-by-step setup, software selector, and stable error/loading states. Establish CI formatting, linting, builds, and core tests.

Pass condition: an accessible desktop shell that runs on all target platforms and illustrates every main user journey without claiming simulated servers are real.

### Milestone 2 — complete Paper hosting flow

Implement Java installation, version selection, EULA prompt, profile creation, whitelisting, one-click component downloads, process lifecycle, console, truthful dashboard telemetry, stop/restart, and recovery from failed startup. Add the component inventory and dependency-aware removal action.

Pass condition: a clean installation can create a world, join locally, stop safely, restart, and retain its world without manually editing files.

### Milestone 3 — internet hosting and direct joining

Connect the proven Playit adapter to onboarding and the dashboard. Add direct/LAN mode, credential persistence, reconnect states, address sharing, address validation/status checks, saved servers, and compatibility guidance.

Pass condition: a host completes the documented setup; an allowed friend on a separate network can join by pasting the host’s public address directly into Minecraft. Enderlink can check/save that address but is not required to play. A provider outage is shown correctly and does not cause a world to be deleted or recreated.

### Milestone 4 — Fabric, imports, and world protection

Implement Fabric installation, controlled supported-pack imports, mod/config management, pack instructions, consistent backups, restore, storage limits, and explicit version-update safeguards.

Pass condition: the selected representative Fabric pack works with compatible clients; a backup is restored and the restored world successfully boots. Unsupported loaders and incompatible packs fail with useful messages.

### Milestone 5 — release and usability validation

Package Windows, macOS Apple Silicon, and Linux builds. Test clean machines, no Java installation, paths with spaces/non-ASCII characters, missing Linux keyrings, high DPI, Wayland, interrupted downloads, restart recovery, sleep/wake, tunnel loss, and limited disk space. Verify component removal and documented full cleanup, including keeping/exporting worlds. Exercise error/loading/list/graph updates at several window sizes and check that fixed elements retain their positions. Complete onboarding documentation and redact exported diagnostics.

Pass condition: a nontechnical tester can install, create, invite, join, stop, and restore a server following the interface. Record real platform test results; a successful cross-compile alone does not count as OS validation.

## 9. Multi-agent implementation approach

Parallelize after defining shared types, event contracts, storage ownership, and the milestone acceptance checks. Up to three implementation agents can work beside a lead integrator:

1. **UI agent:** interface components, design tokens, accessibility, state presentation, and frontend tests.
2. **Runtime agent:** Java, engine adapters, process supervision, filesystem operations, backups, and backend tests.
3. **Connectivity agent:** provider integration, secret storage interfaces, address/status handling, connection diagnostics, and network tests.

The lead owns shared contracts, schema changes, integration, and release checks. Give each task bounded files/modules and testable deliverables. Avoid having multiple agents edit the same interface or migration concurrently. Integration reviews and end-to-end checks remain sequential where one component depends on another.

Use separate branches/checkouts only through the available agent tooling when isolation is requested. Do not assume parallelism shortens external API research, release signing, hardware validation, or tests requiring a real remote player. Agent boundaries apply to implementation tasks after these shared contracts exist.

## 10. Testing, distribution, and costs

Tests should protect real failure modes: invalid addresses and archives, incompatible Java, interrupted installations, stale process identity, double starts, stop/save behavior, missing keychains, credential redaction, provider errors, and consistent backup/restore. Use fake child processes and HTTP/provider fixtures for repeatable tests, plus a small number of real-engine and real-network acceptance checks.

Run Rust formatting/lints/tests and frontend type/lint/component checks. Use frontend automation for important workflows and OS-level smoke tests for Tauri integration. Validate Windows process teardown, macOS packaging, and Arch/Omarchy Wayland behavior on actual target systems or suitable VMs. If a test environment is unavailable, mark that platform unverified rather than claiming support.

Planned packages: a Windows installer, Apple Silicon `.app`/`.dmg`, Linux `.deb` and AppImage where viable, and an Arch packaging recipe. Test actual runtime dependencies; AppImage does not guarantee compatibility with every distribution. Later consider RPM and additional CPU architectures.

The app can be free and need no developer-operated backend. Hosts still pay for their hardware, electricity, internet, and their normal Minecraft access. Playit's free service is external and can change. Extra mod services such as voice chat may require an additional UDP tunnel and a provider feature outside the free Minecraft tunnel; show that limitation instead of promising all mod networking is free.

Public app distribution has its own costs. In particular, normal notarized macOS distribution needs paid Apple developer credentials; unsigned local/beta distribution has installation friction. Choose the initial release approach explicitly without asking users to disable OS protections. See [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/).

Verify licenses for redistributed dependencies/agents and include notices. Fetch Minecraft server artifacts at setup, follow official download API requirements, and pin stable builds. Paper's API has specific identification requirements and cautions against automatic production updates; see its [download service documentation](https://docs.papermc.io/misc/downloads-service/).

## 11. Deferred features

Mandatory player-side Enderlink presence, invitation links/codes, player-side forwarding, custom game-server engines, custom P2P transports, our own cloud relay, short-code directory infrastructure, Bedrock/Geyser, client launchers, automatic client mod synchronization, arbitrary engine imports, multiple simultaneous servers, live engine conversion, remote administration, and unattended world/modpack updates are outside the approved first-release scope.

Forge and NeoForge are the first candidates to move into scope if your actual modpack requires them. The architecture must support adding them; a Fabric implementation alone is not evidence that Forge/NeoForge already work.

## 12. Approved direction and design deliverables

The user approved the plan and asked for the full design. Direct Minecraft address entry is sufficient; invitation links/codes and the local Join bridge are removed from the first release. There are no Enderlink accounts. The host uses the third-party tunnel provider, and Minecraft authentication plus whitelisting controls access.

Explicit requirements include Paper/Fabric updates and uninstall in Settings, deleting worlds, and a typed deletion phrase. Use `DELETE <exact world name>` (for example, `DELETE Mossy Hollow`). Deletion requires the world to be stopped and no conflicting operation, lists affected files, preserves separate backups by default, and is revalidated by the backend.

Download newer engine versions separately from applying them to a world. Updates require a compatibility review, a stopped world, and a complete restorable backup. Do not auto-update Minecraft, loader, mods, or worlds. Engine uninstall never silently deletes worlds; affected worlds can reinstall their exact pinned version.

See `docs/DESIGN.md` for the full product/interface specification, `docs/ARCHITECTURE.md` for storage, commands, lifecycle, and failure recovery, and `docs/ACCEPTANCE.md` for implementation completion criteria. `design/enderlink.html` is an interactive design with sample data and simulated operations, not a real server manager.

Assume the working name Enderlink, a small friend group, one active server, player-side app optional, and private beta distribution first. Public publishing and external account provisioning remain separate release actions.
