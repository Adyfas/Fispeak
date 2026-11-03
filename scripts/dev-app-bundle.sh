#!/usr/bin/env bash
# Create a stable macOS app bundle for development.
#
# Why: macOS ties the Screen Recording permission to a bundle identity plus its code
# signature. The dev build lives in node_modules and is re-signed whenever Electron is
# reinstalled, so the permission would be revoked again and again. This script copies
# Electron.app to ~/Applications once, gives it its own bundle id, and signs it ad-hoc.
# The bundle is never overwritten, so the grant survives every rebuild of the app itself.
#
#   ./scripts/dev-app-bundle.sh            # create/update the bundle
#   ./scripts/dev-app-bundle.sh --run      # create it and launch the app from it
#
# After the first run: System Settings -> Privacy & Security -> Screen Recording ->
# enable "fispeak dev" (and "fispeak-audio-helper" if macOS lists it separately).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="fispeak dev"
BUNDLE_ID="app.fispeak.dev"
DEST_DIR="$HOME/Applications"
BUNDLE="$DEST_DIR/fispeak-dev.app"
HELPER_NAME="fispeak-audio-helper"
ARCH="$(uname -m)"

ELECTRON_APP="$ROOT/node_modules/electron/dist/Electron.app"
if [ ! -d "$ELECTRON_APP" ]; then
  ELECTRON_APP="$(find "$ROOT/node_modules/.pnpm" -maxdepth 4 -path "*electron/dist/Electron.app" -type d 2>/dev/null | head -1)"
fi
if [ -z "${ELECTRON_APP:-}" ] || [ ! -d "$ELECTRON_APP" ]; then
  echo "[dev-bundle] Electron.app not found - run pnpm install first" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"

if [ ! -d "$BUNDLE" ]; then
  echo "[dev-bundle] creating $BUNDLE"
  cp -R "$ELECTRON_APP" "$BUNDLE"
else
  echo "[dev-bundle] reusing existing $BUNDLE (signature is kept stable)"
fi

PLIST="$BUNDLE/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID" "$PLIST" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string $BUNDLE_ID" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleName $APP_NAME" "$PLIST" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Add :CFBundleName string $APP_NAME" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $APP_NAME" "$PLIST" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string $APP_NAME" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString 0.1.0" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion 0.1.0" "$PLIST" 2>/dev/null || true

# The helper lives inside the bundle so it shares the app's identity: one Screen Recording
# grant then covers the app and the helper. Replacing it invalidates the signature, so the
# user has to grant the permission again - that is why the copy is only done on demand.
HELPER_SRC="$ROOT/resources/bin/darwin-$ARCH/$HELPER_NAME"
if [ -f "$HELPER_SRC" ]; then
  HELPER_DST="$BUNDLE/Contents/Resources/$HELPER_NAME"
  if [ ! -f "$HELPER_DST" ] || ! cmp -s "$HELPER_SRC" "$HELPER_DST"; then
    echo "[dev-bundle] copying the audio helper into the bundle (re-grant the permission after this)"
    cp "$HELPER_SRC" "$HELPER_DST"
    chmod +x "$HELPER_DST"
    # A bare ad-hoc binary inside a signed bundle is killed by the kernel, so the helper
    # needs its own signature before the bundle is sealed.
    codesign --force --sign - "$HELPER_DST" >/dev/null 2>&1
  else
    echo "[dev-bundle] audio helper already up to date"
  fi
fi

# The app icon lives in the bundle too: Finder, the Dock preview, permission dialogs and
# notifications all take it from CFBundleIconFile. Like the helper, only replace it when it
# really changed - every change to the bundle re-signs it and can reset the TCC grants.
ICON_SRC="$ROOT/resources/icon.icns"
if [ -f "$ICON_SRC" ]; then
  ICON_DST="$BUNDLE/Contents/Resources/fispeak.icns"
  if [ ! -f "$ICON_DST" ] || ! cmp -s "$ICON_SRC" "$ICON_DST"; then
    echo "[dev-bundle] copying the app icon into the bundle"
    cp "$ICON_SRC" "$ICON_DST"
    /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile fispeak.icns" "$PLIST" 2>/dev/null || \
      /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string fispeak.icns" "$PLIST"
    # Nudge Finder/LaunchServices so the new icon shows up without a logout.
    touch "$BUNDLE"
  else
    echo "[dev-bundle] app icon already up to date"
  fi
fi

echo "[dev-bundle] signing ad-hoc"
codesign --force --sign - "$BUNDLE" >/dev/null 2>&1

echo "[dev-bundle] done: $BUNDLE"
echo "[dev-bundle] run it with:"
echo "  $BUNDLE/Contents/MacOS/Electron $ROOT"

if [ "${1:-}" = "--run" ]; then
  exec "$BUNDLE/Contents/MacOS/Electron" "$ROOT"
fi
