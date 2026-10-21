#!/usr/bin/env bash
# Builds DesktopRobovac.app from the Swift package.
#
#   Scripts/make-app.sh            # release build, ad-hoc signed, no sandbox
#   Scripts/make-app.sh --sandbox  # also applies Resources/DesktopRobovac.entitlements
#   Scripts/make-app.sh --debug    # debug build
#
# Output: build/DesktopRobovac.app
set -euo pipefail

cd "$(dirname "$0")/.."

CONFIG=release
SANDBOX=0
for arg in "$@"; do
  case "$arg" in
    --sandbox) SANDBOX=1 ;;
    --debug) CONFIG=debug ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

swift build -c "$CONFIG" --product DesktopRobovac

BIN="$(swift build -c "$CONFIG" --show-bin-path)/DesktopRobovac"
APP="build/DesktopRobovac.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/DesktopRobovac"
cp Resources/Info.plist "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

if [ "$SANDBOX" = "1" ]; then
  codesign --force --sign - --entitlements Resources/DesktopRobovac.entitlements "$APP"
else
  codesign --force --sign - "$APP"
fi

echo "Built $APP"
echo "Run it with: open $APP"
