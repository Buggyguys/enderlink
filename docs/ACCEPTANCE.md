# Enderlink — acceptance and verification matrix

This is the release acceptance checklist. The live implementation and actual test results are recorded in [IMPLEMENTATION-VERIFICATION.md](IMPLEMENTATION-VERIFICATION.md); unchecked hardware and account-dependent scenarios remain unverified. The separate HTML prototype is a design artifact.

## Design review

- Host and Settings remain reachable at desktop and narrow embedded widths; friends join directly in Minecraft using the host's address.
- Library, create flow, dashboard, stopped/missing-software states, console, access, backup/restore, update/uninstall, and typed deletion have a defined presentation.
- Form errors do not move input/buttons; card charts keep their plot dimensions; overlays do not change the content grid.
- Long names, 200% text scaling, empty lists, error detail, and narrow/short windows retain readable controls.
- Keyboard focus is visible; dialogs have a title/description, modal focus behavior, Escape cancellation, and focus return. Reduced motion removes nonessential transitions.
- Prototype metrics and operations are unmistakably sample data. No real provider login, download, server connection, or deletion is claimed.

## Hosting and joining

- Clean machine with no Java: prepare compatible runtime/engine, obtain explicit EULA acceptance, create/start/join/stop/restart with preserved world data.
- Friend on a separate network joins via the public address in ordinary Minecraft with no Enderlink/provider account or player-side app.
- Whitelisted legitimate account joins; a non-whitelisted account is refused; spoofed offline identity is not accepted. Revoking an online player removes access effectively.
- Same engine/version/pack succeeds; wrong loader or pack yields useful guidance without claiming unsupported compatibility detection.
- Server ready and tunnel ready are independently displayed. Tunnel outage does not delete/recreate the world or report the local server as stopped.
- The host dashboard distinguishes local readiness, tunnel state and assigned public address; it never claims that an assigned address proves remote reachability.
- Copying an address never claims that a player joined, became whitelisted, or needs Enderlink open to continue playing.

## Software installation and removal

- Paper/Fabric and different versions can coexist; changing the Settings default never converts existing worlds.
- Interrupted/corrupt download does not replace working versions; retries are bounded; installed state appears only after verification.
- Required Java follows exact selected versions/architecture; custom system Java is never overwritten or deleted.
- Removing an unused version removes only its owned artifacts. Shared runtime use prevents unreviewed garbage collection.
- Running/pending consumers block uninstall. Explicitly removing stopped-world dependencies preserves world data and exact reinstall coordinates.
- Missing software has a working Reinstall action, and restored profiles use their original compatible version rather than the latest by accident.

## Updates and restore

- Check for updates only reports candidates; no unattended installation, binding changes, or game-version migration.
- Plan shows exact old/new versions, unknown/known incompatibilities, capacity, and affected world.
- Backup failure prevents mutation. Update cannot run while save, delete, or another update holds the world lock.
- Crash at each update stage recovers a coherent binding and instance or reports a recoverable failure; no profile points at nonexistent staged files.
- A failed new-version startup offers restoration from a verified complete snapshot, including all dimensions/config/mods and matching binding.
- Restoration after newer world writes warns about progress loss and requires deliberate confirmation. A JAR-only downgrade is not described as rollback.
- Backup restore to a new ID succeeds in a real engine. Retention does not delete the protected pre-update snapshot before resolution.

## Deletion and cleanup

- Delete disabled for running/busy worlds. Correct phrase is `DELETE <exact world name>`; wrong case/name/phrase is refused.
- Backend rejects forged confirmation booleans, stale/expired/reused challenges, renamed worlds, changed backup policy, and mismatched revisions.
- Unicode names are normalized consistently; traversal-like names never become filesystem paths. Symlink/import boundaries cannot delete unrelated data.
- Kept backups survive world deletion, remain discoverable, and restore into a fresh world. No-backup worlds have no misleading recovery promise.
- Crash before/after quarantine rename and during purge reconciles correctly. Partial cleanup remains visible and disk metrics do not claim reclaimed space prematurely.
- Uninstall cleanup stops owned processes and removes reviewed managed components/credentials. User-selected external Java/import sources and unselected backups remain outside deletion scope.
- macOS Trash/Linux executable deletion limitations are documented; only the provided cleanup workflow promises managed-data removal.

## Cross-platform and operational quality

- Windows x64, macOS arm64, Ubuntu Linux x64, and Arch/Omarchy Wayland receive real smoke-test records.
- Test paths containing spaces/non-ASCII, locked/missing credential store, high-DPI/scaling, app close while hosting, sleep/wake, port conflict, network loss, and low disk.
- No orphaned owned processes on deliberate stop; stale PIDs do not permit killing unrelated processes. App reopening reconstructs truthful session state.
- Command arguments bypass shell interpolation; untrusted archives/status/MOTD/log data cannot escape paths, execute script, or create unbounded memory use.
- Provider secrets never appear in frontend snapshots, plaintext preferences, logs, sample files, backup archives, or exported diagnostics.
- Native runtime dependencies and signing state are documented. Release artifacts include dependency notices and versioned migration compatibility.

## Verification strategy

Use unit tests for address/manifest/confirmation validation and state transitions; integration tests with fake processes and provider/HTTP fixtures for lifecycle/recovery; filesystem fault injection around journal/rename/backup operations; UI workflow tests for modal/error geometry and focus; and focused real-engine/provider acceptance checks. Make the destructive-operation tests meaningful rather than merely duplicating implementation branches.

Do not broaden test scope after required checks pass unless a new change or unresolved failure justifies it. Store a concise per-platform result with app version, OS, engine/Java/provider versions, completed scenarios, limitations, and evidence. A polished mockup is tracked separately from implementation readiness.
