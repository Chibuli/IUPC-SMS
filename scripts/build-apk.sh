#!/usr/bin/env bash
#
# Builds an installable Android APK from the web app.
#
#   bash scripts/build-apk.sh
#
# Produces android/app/build/outputs/apk/debug/app-debug.apk — debug-signed, so
# a phone will install it once "install unknown apps" is allowed for whatever
# app is used to open the file (Files, Chrome, or a USB transfer). It is not
# signed for the Play Store, and no store account is involved.
#
# The first run downloads the toolchain through scripts/android-toolchain.sh
# (~2 GB, needed only once) and Gradle fetches its distribution and the Android
# Gradle Plugin from the network.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
TOOLCHAIN="$ROOT/.android"
COMPILE_SDK=35

say() { echo "[apk] $*"; }
find_jdk() { find "$TOOLCHAIN" -maxdepth 1 -mindepth 1 -type d -name 'jdk-*' 2>/dev/null | head -1; }

if [ ! -d "$ROOT/android" ]; then
  say "no android/ project — run: npx cap add android"
  exit 1
fi

# ── toolchain ────────────────────────────────────────────────────────────────
JDK_HOME="$(find_jdk || true)"
if [ -z "$JDK_HOME" ] || [ ! -d "$TOOLCHAIN/sdk/platforms/android-$COMPILE_SDK" ]; then
  say "toolchain incomplete — running scripts/android-toolchain.sh (this is the slow part)"
  bash scripts/android-toolchain.sh
  JDK_HOME="$(find_jdk || true)"
fi
if [ -z "$JDK_HOME" ] || [ ! -d "$TOOLCHAIN/sdk/platforms/android-$COMPILE_SDK" ]; then
  say "toolchain still incomplete — stopping"
  exit 1
fi

SDK_WIN="$(cygpath -w "$TOOLCHAIN/sdk")"
# Gradle launches a real JVM, so it wants the SDK as a Windows path...
printf 'sdk.dir=%s\n' "${SDK_WIN//\\/\\\\}" > android/local.properties
export ANDROID_HOME="$SDK_WIN"
export ANDROID_SDK_ROOT="$SDK_WIN"
# ...while gradlew itself is a shell script, so JAVA_HOME stays in POSIX form and
# the JDK is also put on PATH for the fallback.
export JAVA_HOME="$JDK_HOME"
export PATH="$JDK_HOME/bin:$PATH"
say "JDK    $("$JDK_HOME/bin/java.exe" -version 2>&1 | head -1)"
say "SDK    $SDK_WIN"

# ── web build, copied into the native project ───────────────────────────────
say "building the web app"
npm run build
say "syncing the web build into the Android project"
npx cap sync android

# ── gradle ───────────────────────────────────────────────────────────────────
cd android
say "assembling the debug APK (first run downloads Gradle and the Gradle plugin)"
./gradlew assembleDebug --no-daemon

APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK" ]; then
  say "no APK at $APK"
  exit 1
fi
say "APK: $APK ($(du -h "$APK" | cut -f1))"
