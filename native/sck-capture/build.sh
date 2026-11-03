#!/usr/bin/env bash
# Build the macOS ScreenCaptureKit helper (05-audio-capture §2.2).
#
#   ./native/sck-capture/build.sh
#   -> resources/bin/darwin-arm64/fispeak-audio-helper
#
# Requires the Xcode command line tools (swiftc). The output is gitignored.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$ROOT/native/sck-capture/Sources/main.swift"
ARCH="$(uname -m)"
OUT_DIR="$ROOT/resources/bin/darwin-$ARCH"
OUT="$OUT_DIR/fispeak-audio-helper"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "[sck-capture] swiftc not found - install the Xcode command line tools" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

swiftc \
  -O \
  -target "${ARCH}-apple-macosx13.0" \
  -framework ScreenCaptureKit \
  -framework CoreMedia \
  -framework CoreGraphics \
  -framework AVFoundation \
  -o "$OUT" \
  "$SOURCE"

chmod +x "$OUT"
echo "[sck-capture] built $OUT"
