#!/usr/bin/env bash
# Dijalankan setelah "npx cap add android":
# memasang plugin TCP RouterOS, ikon, dan splash screen ALHUDA_D.NET
set -e
cd "$(dirname "$0")/.."

PKG=android/app/src/main/java/id/alhuda/dnet
RES=android/app/src/main/res
mkdir -p "$PKG"
cp native/RosSocketPlugin.java native/MainActivity.java "$PKG/"

for d in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  mkdir -p "$RES/mipmap-$d"
  cp resources/android/mipmap-$d/ic_launcher.png "$RES/mipmap-$d/ic_launcher.png"
  cp resources/android/mipmap-$d/ic_launcher_round.png "$RES/mipmap-$d/ic_launcher_round.png"
  rm -f "$RES/mipmap-$d/ic_launcher_foreground.png"
done
# pakai ikon PNG di semua versi Android (hapus ikon adaptif bawaan Capacitor)
rm -rf "$RES/mipmap-anydpi-v26"

find "$RES" -name 'splash.png' | while read -r f; do
  case "$f" in
    *land*) cp resources/splash-land.png "$f" ;;
    *) cp resources/splash-port.png "$f" ;;
  esac
done

echo "Plugin RosSocket, ikon dan splash ALHUDA_D.NET terpasang."
