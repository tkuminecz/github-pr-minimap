#!/bin/sh
# Zips the built extension (dist/) for a release: release/github-pr-minimap-v<version>.zip, holding a
# single github-pr-minimap/ folder to load with "Load unpacked". Run `pnpm build` first.
set -eu
version=$(node -p "require('./package.json').version")
rm -rf release
mkdir -p release/github-pr-minimap
cp -R dist/. release/github-pr-minimap/
(cd release && zip -qr "github-pr-minimap-v$version.zip" github-pr-minimap)
echo "release/github-pr-minimap-v$version.zip"
