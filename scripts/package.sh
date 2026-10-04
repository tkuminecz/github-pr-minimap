#!/bin/sh
# Zips the built extension (dist/) for a release: release/github-pr-minimap.zip, holding a single
# github-pr-minimap/ folder to load with "Load unpacked". The name has no version in it, so the
# latest release's zip is always at .../releases/latest/download/github-pr-minimap.zip, which is
# what install.sh downloads. Run `pnpm build` first.
set -eu
rm -rf release
mkdir -p release/github-pr-minimap
cp -R dist/. release/github-pr-minimap/
(cd release && zip -qr github-pr-minimap.zip github-pr-minimap)
echo release/github-pr-minimap.zip
