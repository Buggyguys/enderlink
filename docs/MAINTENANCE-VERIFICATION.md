# Enderlink 0.3.2 — reset, preservation and uninstall

Verified on Apple Silicon macOS, 6 November 2026. Destructive verification used temporary fixtures only. The user's real world, backups and provider authorization were not cleared or uninstalled.

## Implemented behaviour

Settings → Backups & storage now exposes **Clear all data…**, **Uninstall Enderlink…**, and **Restore saved library**. Individual world/backup deletion and partial managed-data cleanup remain available.

Clear all data is a factory reset. A reviewed summary and `CLEAR ENDERLINK DATA` are required. It removes managed world and backup files, software/Java downloads, old metadata snapshots, quarantine/staging contents, play history, settings and saved Playit authorization. The running app remains installed with an empty library/default settings. Native webview browsing data is cleared too.

Uninstall requires `UNINSTALL ENDERLINK`. With existing worlds/backups, the default is **Save to a folder**; **Delete everything** is an explicit alternative. With an empty library, this choice is omitted. Preservation creates a new external child folder containing worlds, mods/plugins, backup archives, world settings/allowed identities, play history, checksums and restoration instructions. Saved data is flushed before the source is cleared. The target cannot be inside any application/data/cache path scheduled for removal.

**Restore saved library** requires an empty game library. It validates metadata, file paths, checksums and history, stages files and commits records in a transaction. It rejects corrupt/escaped paths and rolls back partial moves after a failed transaction. Existing worlds/backups are not overwritten. Pinned engine metadata is preserved; managed Java and engine caches must be reinstalled.

Maintenance requires no active or recovered server and no queued/running operations. Reviews expire after ten minutes and become invalid if metadata/inventory changes. Mutation IPC, modal dismissal and normal app/OS quit are blocked while destructive work is in progress. Only a committed uninstall authorizes the final exit.

## Native removal

- macOS verifies the current bundle identifier and writable installation location, then removes the exact app bundle and dedicated local data/cache/preferences after normal exit.
- Windows verifies the adjacent NSIS uninstaller's product identity. NSIS owns package files, shortcuts and registry registration; the helper removes remaining dedicated user data after exit. MSI/unpackaged fallback instructions are explicit.
- Linux supports verified AppImages and recognized Enderlink dpkg/pacman/rpm packages through polkit. Unsupported installations or missing authorization tools show manual instructions before cleanup. A canceled later OS authorization prompt may leave the package installed after the separately confirmed data cleanup; preserved libraries remain outside removal paths.

Preparing a helper is inert. It requires both a committed marker and parent exit before removal. Canceling preparation preserves files. Helpers do not kill the app or game processes. Failure logs remain in a private temporary folder, with an OS notification. The Playit account, external exports, unrelated Minecraft installations, system Java, source checkouts and other app copies are outside the removal scope.

## Evidence

- **74 Rust core tests pass**, including full reset and reopen, stale review, busy/recovered process guards, preservation before cleanup, exact saved-library round trip with activity history, corrupt checksums, traversal, symlinks, unportable filenames and rollback after database failure.
- **5 native uninstall tests pass**, using disposable targets and child processes: dedicated-path checks, traversal/symlink rejection, canceled preparation, removal only after exit, and preservation of an external folder.
- **70 React tests pass**, including 12 maintenance-dialog tests with mocked IPC for exact phrases, preservation defaults, empty-library omission, error/retry behaviour, unsupported installers and restore restrictions.
- Production-asset checks pass in Chromium and WebKit, including integrated Settings entry points, minimum-window layout, preservation selection, typed confirmation, empty-library flow, and Escape/Cancel being blocked during simulated reset. No real destructive IPC was called.
- TypeScript/production Vite build, Rust formatting, affected frontend formatting, workspace Clippy with warnings denied and POSIX helper syntax checks pass.
- The Apple Silicon release binary built successfully. Native Windows/Linux uninstall execution and PowerShell execution are not established by these macOS checks.

## Review without deleting data

Open Settings → Backups & storage and open either new confirmation dialog, then cancel. Verify the counts, default preservation choice and chosen save-folder preview. An empty test installation should skip the preservation question. Only submit the final typed confirmation on a disposable installation or when permanent cleanup/removal is intended.

Actual saved-credential deletion was not exercised against the user's credential store. Full reset reports credential-store removal errors before game files are deleted. No schema migration is required for this release.

## Local package and upgrade

The final 0.3.2 app passed signature verification, and its DMG passed `hdiutil verify`:

- `target/release/bundle/macos/Enderlink.app` — updated local app, reopened successfully.
- `target/release/bundle/macos-0.3.2/Enderlink.app` — staged versioned copy.
- `target/release/bundle/dmg/Enderlink_0.3.2_arm64.dmg` — Apple Silicon installer.

Post-launch native inspection reported `isFinishedLaunching=true` and `isTerminated=false`. Read-only integrity checks confirmed unchanged world, backup, component and settings metadata, schema 3, and four unchanged game files. No world was started and no real reset/uninstall was submitted. The previous process exited before any termination signal was sent. Packages are locally ad-hoc signed, not Developer ID signed/notarized.

## Startup credential wait

While preparing the local upgrade, the previously running 0.3.1 process did not respond to normal quit. A read-only process sample showed its main thread waiting in macOS Keychain during startup. Credential loading now runs on a blocking worker, leaving the window/event loop responsive. The UI explains a pending credential prompt. An epoch guard prevents a delayed lookup from reintroducing authorization after disconnect/reset or a newer link; a dedicated regression test passes. The agent does not approve or bypass system credential prompts.
