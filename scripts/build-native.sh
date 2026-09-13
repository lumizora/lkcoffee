#!/bin/zsh
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)

location_app="$root/native/LocationHelper.app/Contents"
mkdir -p "$location_app/MacOS"
cp "$root/native/Info.plist" "$location_app/Info.plist"
swiftc -framework AppKit -framework CoreLocation "$root/native/LocationHelper.swift" -o "$location_app/MacOS/LocationHelper"
codesign --force --sign - "$root/native/LocationHelper.app" >/dev/null

audio_app="$root/native/AudioHelper.app/Contents"
mkdir -p "$audio_app/MacOS"
cp "$root/native/AudioHelper.Info.plist" "$audio_app/Info.plist"
swiftc -framework AVFoundation -framework AVFAudio -framework CoreAudio "$root/native/AudioHelper.swift" -o "$audio_app/MacOS/AudioHelper"
codesign --force --sign - "$root/native/AudioHelper.app" >/dev/null
