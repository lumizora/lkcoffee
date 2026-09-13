#!/bin/zsh
set -euo pipefail
root=${0:A:h:h}
app="$root/native/LocationHelper.app/Contents"
mkdir -p "$app/MacOS"
cp "$root/native/Info.plist" "$app/Info.plist"
swiftc -framework AppKit -framework CoreLocation "$root/native/LocationHelper.swift" -o "$app/MacOS/LocationHelper"
codesign --force --sign - "$root/native/LocationHelper.app" >/dev/null
