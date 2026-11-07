# Enderlink documentation

These are the documents intended to ship with the open-source repository.

## Current implementation

- [README](../README.md) — installation, first host setup, direct joining, worlds, backups, cleanup and contributor commands.
- [Architecture](ARCHITECTURE.md) — Rust/Tauri boundaries, storage, process ownership, Playit integration, backups, reset/uninstall and cross-platform controls.
- [Platform setup](PLATFORMS.md) — macOS, Windows, Ubuntu/Debian and Arch/Omarchy prerequisites, packaging and native-control limits.
- [Interface design](DESIGN.md) — the implemented Host/Settings product model and visual/accessibility rules.
- [Acceptance matrix](ACCEPTANCE.md) — release scenarios and the checks that still need real clients, accounts or hardware.
- [0.3.3 control verification](CONTROLS-VERIFICATION.md) — shared menus, contrast, keyboard behavior and local evidence.
- [Platform setup and release downloads](PLATFORMS.md) — native prerequisites, validation gates and tagged installer publishing.

## Historical verification records

The versioned records preserve what was tested at each implementation milestone. Their old version numbers and counts are intentional; they are evidence for those milestones, not claims about the current release.

- [0.3.2 reset, preservation and uninstall](MAINTENANCE-VERIFICATION.md)
- [0.3.1 interface refinements](UI-REFINEMENTS-VERIFICATION.md)
- [0.3.0 worlds and activity](WORLDS-HISTORY-VERIFICATION.md)
- [0.2.5 offline accounts](OFFLINE-ACCOUNTS-VERIFICATION.md)
- [0.2.4 Playit setup](PLAYIT-VERIFICATION.md)
- [0.2.3 theme and resource verification](THEME-VERIFICATION.md)
- [0.1.0 implementation baseline](IMPLEMENTATION-VERIFICATION.md)
- [Prototype design verification](DESIGN-VERIFICATION.md)

The separate [`design/`](../design/) folder is a self-contained, simulated prototype retained for design history. It does not access the production app, files, Minecraft, or provider accounts.
