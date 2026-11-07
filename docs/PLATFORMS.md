# Platform setup and packaging

## macOS (Apple Silicon)

Use macOS 13 or newer. Install Xcode Command Line Tools, stable Rust, and Node.js 22.12+. `npm ci` then `npm run dev` runs the desktop application. `npm run tauri -w apps/desktop -- build --bundles app,dmg` creates an app and disk image under `target/release/bundle`.

If Tauri’s styled DMG step cannot automate Finder, build just the app with `npm run tauri -w apps/desktop -- build --bundles app`, then run `sh scripts/package-macos.sh`. This creates and verifies a plain compressed disk image without AppleScript.

The current local build is arm64 and has no developer signature or notarization. Distribution without Gatekeeper friction requires a suitable signing/notarization identity. Enderlink does not buy, request, or embed developer credentials. Build locally for development; do not disable platform protections to run unknown binaries.

App data: `~/Library/Application Support/io.github.buggyguys.enderlink/`. Provider authorization uses the macOS credential store if you choose Remember. Deleting the `.app` alone does not delete its app data or credential. Use Enderlink’s managed-data cleanup first.

## Windows x64

Install Visual Studio Build Tools with the **Desktop development with C++** workload and Windows SDK, Microsoft Edge WebView2, stable Rust (MSVC), and Node.js 22.12+. `npm ci` then `npm run dev`. `npm run desktop:build` builds installer bundles. Build on Windows; a macOS build does not verify Windows process/credential behavior.

The process supervisor uses a Job Object with kill-on-close for owned Java processes. Normal stop still uses Minecraft’s saving shutdown command. Provider authorization uses Windows Credential Manager. App data lives in the per-user application-data location reported in Settings (normally `%APPDATA%\io.github.buggyguys.enderlink`).

## Ubuntu / Debian-family Linux x64

Install the following Tauri development dependencies on Ubuntu 24.04, plus stable Rust and Node.js 22.12+:

```sh
sudo apt update
sudo apt install build-essential pkg-config libssl-dev libdbus-1-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

Then `npm ci` and `npm run dev`. Use `npm run desktop:build` for deb/rpm/AppImage packages supported by Tauri’s current bundler. WebKitGTK is a native runtime dependency; a Rust backend does not make the graphical app dependency-free. Install a running Secret Service provider (e.g. GNOME Keyring) if persistent credentials are wanted. Without an available/unlocked credential store, linking lasts only for the current app session and the UI says so.

## Arch Linux / Omarchy

Use a current Arch system with a graphical user session. Install stable Rust and Node.js, plus the matching native dependencies:

```sh
sudo pacman -S --needed base-devel pkgconf openssl dbus webkit2gtk-4.1 libayatana-appindicator librsvg patchelf
```

Run `npm ci` and `npm run dev`, or build locally using `npm run tauri -w apps/desktop -- build --no-bundle` and run `target/release/enderlink`. This does not register any global server or tunnel daemon. A user D-Bus session and optional Secret Service keyring are separate desktop components; a compositor alone does not provide them. Omarchy/Wayland, HiDPI, and Secret Service still need real-machine acceptance testing.

Linux app data normally lives at `$XDG_DATA_HOME/io.github.buggyguys.enderlink`, falling back to `~/.local/share/io.github.buggyguys.enderlink`. Confirm the exact path in Settings.

## Release checks

The GitHub workflows validate the source on Windows x64, macOS arm64 (`macos-15`), and Linux x64. A `v*` tag runs the same checks, builds a Windows NSIS installer, a macOS Apple Silicon DMG, and Linux x64 AppImage/Debian packages, then attaches them with SHA-256 files to the GitHub release. Builds are unsigned unless the repository owner configures signing credentials; no provider or signing secrets are stored in the repository. Only the local macOS build has been exercised in this workspace. Native builds are not substitutes for testing real Minecraft clients, remote networks, power events, and desktop credential prompts.

Run `npm run validate` before creating a tag. It checks the public tree and all local test gates without using real app data. The direct download links in the root README point to the stable release asset names.

Before public distribution, complete the outstanding checks in `IMPLEMENTATION-VERIFICATION.md`: a real Paper session, matching Fabric server/client pack, whitelisted and denied accounts, provider disconnect/reconnect from a separate network, graceful close while hosting, and native platform smoke checks. Keep free-tier descriptions accurate as provider terms change.

The 0.2.3 visual theme uses local assets and CSS with prefixed WebKit blur support and solid-surface fallbacks. System reduced motion and the app’s lightweight preset disable effects across platforms. See [0.2.3 verification](THEME-VERIFICATION.md) for measured coverage and memory-attribution limits.

## Clear data and uninstall (0.3.2)

In **Settings → Backups & storage**, Clear all data resets the app but keeps it installed. Uninstall Enderlink offers to save the game library to a new external folder first; an empty library skips that choice. Neither action is enabled while hosting or while operations are pending. Confirm the exact phrase shown in the dialog. Playit credentials are removed from the current user's credential store, so that store must be accessible when saved authorization needs removal. The Playit account is not deleted.

- **macOS:** automatic uninstall verifies the current `.app` bundle identifier and a writable containing directory, then removes that app and dedicated application-support/cache/preferences directories after exit. It does not remove other app copies, downloaded DMGs or the source project. Move a read-only DMG copy to a writable installation folder first.
- **Windows:** a verified Enderlink NSIS `uninstall.exe` handles package files, shortcuts and installer registration. Windows may show its normal authorization UI. Remaining dedicated user-data directories are removed after the app/installer exit. MSI and unpackaged builds without a recognized uninstaller show instructions to use Windows Settings or remove the standalone build.
- **Linux:** verified AppImages are removed directly after exit. Recognized `enderlink`, `enderlink-bin` and `enderlink-git` packages use dpkg, pacman or rpm through polkit. If automatic authorization is unavailable, the dialog provides the package-manager command and does not start data cleanup. Canceling a later OS authorization prompt can leave the package installed after the explicitly confirmed data cleanup; any preserved library remains safe. Manually created AppImage shortcuts need separate removal.

The **Save to a folder** option creates an `Enderlink saved worlds <timestamp>` child folder. Restore it with **Restore saved library** after reinstalling, then reinstall the pinned engine versions. Game files and backup ZIPs are also readable without Enderlink.

## Form controls and webviews (0.3.3)

All visible option dropdowns use Enderlink’s shared in-app Select component, including version catalogs, account/gameplay choices, appearance, memory, backup selection and player comparison. The open lists have explicit opaque backgrounds, foregrounds, focus outlines and selection marks. Their colours do not come from native OS popup menus. File/folder choosers and system credential/installer prompts remain native.

Tauri uses WebView2 (Chromium) on Windows, WKWebView on macOS, and WebKitGTK on Linux. See the [official webview reference](https://v2.tauri.app/reference/webview-versions/). Browser-engine checks are useful coverage but do not establish native platform behaviour. The workflow now runs Chromium UI checks on all three OS runners and WebKit checks on macOS/Linux, alongside native bundle builds; those remote jobs have not been run from this workspace.

The shared controls support keyboard selection/typeahead, constrained scrolling lists, small windows, explicit disabled states and Windows contrast themes. Solid fallbacks cover missing blur support and the OS reduced-transparency preference where the webview exposes it. See [control verification and remaining native checks](CONTROLS-VERIFICATION.md).
