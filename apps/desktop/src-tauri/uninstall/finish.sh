#!/bin/sh
# Arguments are passed directly by the native module; no generated shell code.
set -eu
parent_pid=$1
work=$2
method=$3
target=$4
shift 4
committed=0
success=0
cleanup() {
  if [ "$committed" -eq 0 ] || [ "$success" -eq 1 ]; then
    /bin/rm -rf "$work"
  elif [ "$method" = macos_bundle ]; then
    /usr/bin/osascript -e 'on run argv' -e 'display alert "Enderlink could not finish uninstalling" message ("Remove the app using Finder. Any saved-worlds folder is unaffected. Details: " & item 1 of argv) as warning' -e 'end run' "$work/uninstall.log" >/dev/null 2>&1 || true
  elif [ -x /usr/bin/notify-send ]; then
    /usr/bin/notify-send 'Enderlink could not finish uninstalling' "Use your system package manager to finish removing the app. Any saved-worlds folder is unaffected. Details: $work/uninstall.log" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
printf 'ready\n' > "$work/ready"

# Preparing an uninstall does nothing until the app commits it. If the app
# exits or the user cancels before that point, leave the installation alone.
while [ ! -f "$work/commit" ]; do
  [ ! -f "$work/cancel" ] || exit 0
  kill -0 "$parent_pid" 2>/dev/null || exit 0
  sleep 1
done
committed=1
attempt=0
while kill -0 "$parent_pid" 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -gt 60 ]; then
    printf 'Enderlink did not exit. No application files were removed.\n' >&2
    exit 1
  fi
  sleep 1
done

case "$method" in
  macos_bundle)
    /bin/rm -rf "$target"
    # Remove the app's preference domain from cfprefsd as well as its file.
    /usr/bin/defaults delete io.github.buggyguys.enderlink 2>/dev/null || true
    ;;
  linux_appimage)
    /bin/rm -f "$target"
    ;;
  linux_dpkg)
    /usr/bin/pkexec /usr/bin/dpkg --remove "$target"
    ;;
  linux_pacman)
    /usr/bin/pkexec /usr/bin/pacman --remove --noconfirm -- "$target"
    ;;
  linux_rpm)
    /usr/bin/pkexec /usr/bin/rpm --erase -- "$target"
    ;;
  *)
    printf 'Unknown uninstall method. Nothing removed.\n' >&2
    exit 1
    ;;
esac

for owned_path do
  /bin/rm -rf "$owned_path"
done
success=1
