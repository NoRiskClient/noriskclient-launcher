#!/usr/bin/env bash
# Compile NoRiskLauncher.icon into src-tauri/Assets.car.
#
# CI does this on every build (see the macos-icon job in build.yml), so releases
# always match the .icon source. Run this locally when you want a dev build to
# pick up an icon change without going through CI, and commit the result.
#
# Needs a macOS 26 host with Xcode 26: earlier actool versions do not understand
# Icon Composer .icon documents.
set -euo pipefail

cd "$(dirname "$0")/.."

DEV="$(ls -d /Applications/Xcode_26*.app 2>/dev/null | sort -V | tail -1 || true)"
if [ -n "$DEV" ]; then
  export DEVELOPER_DIR="$DEV/Contents/Developer"
fi

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

strings "$out/Assets.car" | grep -q 'norisk-bolt'
cp "$out/Assets.car" Assets.car
echo "Wrote src-tauri/Assets.car"
