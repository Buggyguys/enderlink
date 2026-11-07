#!/bin/sh
# Package an already-built .app without Finder/AppleScript automation.
set -eu
enderlink_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
enderlink_app="${1:-$enderlink_root/target/release/bundle/macos/Enderlink.app}"
enderlink_stage=$(mktemp -d "${TMPDIR:-/tmp}/enderlink-package.XXXXXX")
trap 'rm -rf "$enderlink_stage"' EXIT HUP INT TERM
enderlink_version=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$enderlink_app/Contents/Info.plist")
enderlink_arch=$(uname -m)
enderlink_output="$enderlink_root/target/release/bundle/dmg/Enderlink_${enderlink_version}_${enderlink_arch}.dmg"
mkdir -p "$(dirname -- "$enderlink_output")"
ditto "$enderlink_app" "$enderlink_stage/Enderlink.app"
ln -s /Applications "$enderlink_stage/Applications"
hdiutil create -volname Enderlink -srcfolder "$enderlink_stage" -format UDZO -ov "$enderlink_output"
hdiutil verify "$enderlink_output"
printf 'Created %s\n' "$enderlink_output"
