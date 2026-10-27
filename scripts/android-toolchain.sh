#!/usr/bin/env bash
#
# Fetches the JDK and Android SDK that a Capacitor APK build needs, into
# `.android/` inside the project — so nothing is installed system-wide and no
# administrator rights are required. Delete `.android/` to reclaim ~2 GB; the
# APK already built is unaffected.
#
#   bash scripts/android-toolchain.sh
#
# Installs: Temurin JDK 21 (Capacitor 7 requires JDK 21), Android
# command-line tools, platform-tools, platform android-35 and build-tools 35.0.0
# (the compile SDK Capacitor 7 targets). Idempotent: each step is skipped once
# it is in place.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLCHAIN="$ROOT/.android"
SDK="$TOOLCHAIN/sdk"
DL="$TOOLCHAIN/dl"
CMDLINE_BUILD=16111833
COMPILE_SDK=35
BUILD_TOOLS=35.0.0

say() { echo "[toolchain] $*"; }
mkdir -p "$DL" "$SDK"

# ── JDK ──────────────────────────────────────────────────────────────────────
# The archive unpacks to its own versioned folder, which is used in place as the
# JDK home — renaming it into a fixed directory fails on Windows.
find_jdk() { find "$TOOLCHAIN" -maxdepth 1 -mindepth 1 -type d -name 'jdk-*' 2>/dev/null | head -1; }
JDK_HOME="$(find_jdk)"
if [ -z "$JDK_HOME" ] || [ ! -x "$JDK_HOME/bin/java.exe" ]; then
  if [ ! -s "$DL/jdk21.zip" ]; then
    say "downloading Temurin JDK 21 (~190 MB)"
    curl -fSsL --retry 3 --retry-delay 3 -o "$DL/jdk21.zip" \
      "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse"
  fi
  say "extracting JDK"
  unzip -q -o "$DL/jdk21.zip" -d "$TOOLCHAIN"
  rm -f "$DL/jdk21.zip"
  JDK_HOME="$(find_jdk)"
else
  say "JDK already present"
fi
if [ -z "$JDK_HOME" ] || [ ! -x "$JDK_HOME/bin/java.exe" ]; then
  say "no JDK after extracting — stopping"
  exit 1
fi
"$JDK_HOME/bin/java.exe" -version 2>&1 | head -1

# ── command-line tools ───────────────────────────────────────────────────────
if [ ! -f "$SDK/cmdline-tools/latest/bin/sdkmanager.bat" ]; then
  say "downloading Android command-line tools (~160 MB)"
  curl -fSsL --retry 3 --retry-delay 3 -o "$DL/cmdline-tools.zip" \
    "https://dl.google.com/android/repository/commandlinetools-win-${CMDLINE_BUILD}_latest.zip"
  say "extracting command-line tools"
  rm -rf "$DL/cmd-x" && mkdir -p "$DL/cmd-x"
  unzip -q "$DL/cmdline-tools.zip" -d "$DL/cmd-x"
  # The SDK manager only recognises the toolset in a directory called `latest`,
  # and the folder is copied into place rather than renamed: a move inside a
  # watched project directory is refused on Windows.
  rm -rf "$SDK/cmdline-tools/latest"
  mkdir -p "$SDK/cmdline-tools/latest"
  cp -r "$DL/cmd-x/cmdline-tools/." "$SDK/cmdline-tools/latest/"
  rm -rf "$DL/cmd-x" "$DL/cmdline-tools.zip"
else
  say "command-line tools already present"
fi

# The SDK manager is a Windows batch file, so it needs Windows-style paths.
export JAVA_HOME="$(cygpath -w "$JDK_HOME")"
SDKMGR="$SDK/cmdline-tools/latest/bin/sdkmanager.bat"
# `sdkmanager` is now a shim over the `android` CLI. The CLI binary is called
# directly for installs because a batch file re-splits `platforms;android-35` on
# the semicolon — cmd.exe treats it as a separator, so the package arrives as two
# unknown names.
CLI="$SDK/cmdline-tools/latest/bin/android.exe"
SDK_WIN="$(cygpath -w "$SDK")"

# ── SDK packages ─────────────────────────────────────────────────────────────
if [ ! -d "$SDK/platforms/android-$COMPILE_SDK" ]; then
  say "accepting SDK licences"
  yes | "$SDKMGR" --sdk_root="$SDK_WIN" --licenses >"$DL/licenses.log" 2>&1 || true
  say "installing platform-tools, android-$COMPILE_SDK and build-tools $BUILD_TOOLS"
  if [ -x "$CLI" ] || [ -f "$CLI" ]; then
    "$CLI" sdk install --sdk="$SDK_WIN" \
      "platform-tools" "platforms;android-$COMPILE_SDK" "build-tools;$BUILD_TOOLS"
  else
    "$SDKMGR" --sdk_root="$SDK_WIN" \
      "platform-tools" "platforms;android-$COMPILE_SDK" "build-tools;$BUILD_TOOLS"
  fi
else
  say "SDK platform android-$COMPILE_SDK already present"
fi

say "JAVA_HOME=$JAVA_HOME"
say "ANDROID_HOME=$SDK_WIN"
ls -d "$SDK"/platforms/* "$SDK"/build-tools/* 2>/dev/null
say "done"
