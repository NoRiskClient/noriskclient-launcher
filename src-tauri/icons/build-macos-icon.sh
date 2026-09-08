#!/usr/bin/env bash
# Compile NoRiskLauncher.icon into src-tauri/Assets.car.
#
# The macos-icon job in build.yml runs this exact script on every build, so
# releases always match the .icon source and CI cannot drift from what you get
# locally. Run it yourself when you want a dev build to pick up an icon change
# without going through CI, and commit the result.
#
# Note that actool is not reproducible: rendition names carry UUIDs and the
# compiling process id, so every run produces different bytes even from an
# unchanged source. Only commit the result when the icon actually changed.
#
# Needs Xcode 26 or newer — earlier actool versions do not understand Icon
# Composer .icon documents. The host does not have to run macOS 26; Xcode 26
# installs from macOS 15.6 up, and compiling works there. Only previewing the
# result in its dark/tinted/clear appearances needs macOS 26 (or Icon Composer,
# which ships inside Xcode).
set -euo pipefail

cd "$(dirname "$0")/.."

# Pick the Xcode to compile with, most explicit choice first: an exported
# DEVELOPER_DIR, then whatever xcode-select points at, and only then a scan of
# /Applications. That way this never overrides a deliberate setup — it just
# fills in when there is none. The glob covers all three naming schemes in the
# wild: Xcode.app (normal install), Xcode_26.0.app (GitHub runners) and
# Xcode-26.1.0.app (xcodes).
xcode_version() {  # developer-dir -> version, non-zero if it is not new enough
  local v major
  v="$("$1/usr/bin/xcodebuild" -version 2>/dev/null | head -1 | awk '{print $2}')"
  major="${v%%.*}"
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  [ "$major" -ge 26 ] || return 1
  echo "$v"
}

pick_developer_dir() {
  local cand
  if [ -n "${DEVELOPER_DIR:-}" ] && xcode_version "$DEVELOPER_DIR" >/dev/null; then
    echo "$DEVELOPER_DIR"; return
  fi
  cand="$(xcode-select -p 2>/dev/null || true)"
  if [ -n "$cand" ] && xcode_version "$cand" >/dev/null; then
    echo "$cand"; return
  fi
  for app in $(ls -d /Applications/Xcode*.app 2>/dev/null | sort -V -r); do
    if xcode_version "$app/Contents/Developer" >/dev/null; then
      echo "$app/Contents/Developer"; return
    fi
  done
}

DEV="$(pick_developer_dir)"
if [ -z "$DEV" ]; then
  {
    echo "Found no Xcode 26 or newer. actool cannot compile .icon documents without one."
    echo "Xcode 26 needs macOS 15.6 or newer; this host runs $(sw_vers -productVersion)."
    echo "Looked at DEVELOPER_DIR, xcode-select -p, and /Applications/Xcode*.app:"
    for app in $(ls -d /Applications/Xcode*.app 2>/dev/null | sort -V); do
      echo "  $app -> $("$app/Contents/Developer/usr/bin/xcodebuild" -version 2>/dev/null | head -1 || echo unreadable)"
    done
    echo "Set DEVELOPER_DIR, or run xcode-select -s, to point at one explicitly."
  } >&2
  exit 1
fi
export DEVELOPER_DIR="$DEV"
echo "Using $DEV (Xcode $(xcode_version "$DEV"))"

out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

xcrun actool icons/NoRiskLauncher.icon \
  --compile "$out" \
  --app-icon NoRiskLauncher \
  --include-all-app-icons \
  --output-partial-info-plist "$out/partial.plist" \
  --enable-on-demand-resources NO \
  --development-region en \
  --target-device mac \
  --minimum-deployment-target 26.0 \
  --platform macosx \
  --output-format human-readable-text --notices --warnings --errors

# grep -q exits on the first match and breaks the pipe, which pipefail treats
# as a failure, so run the two separately.
strings "$out/Assets.car" > "$out/strings.txt"
grep -q 'norisk-bolt' "$out/strings.txt"
cp "$out/Assets.car" Assets.car
echo "Wrote src-tauri/Assets.car ($(wc -c < Assets.car | tr -d ' ') bytes)"
