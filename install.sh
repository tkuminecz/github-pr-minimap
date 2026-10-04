#!/bin/sh
# Installs or updates GitHub PR Minimap from its latest GitHub release:
#
#   curl -fsSL https://raw.githubusercontent.com/tkuminecz/github-pr-minimap/main/install.sh | sh
#
# The release is unzipped into one folder (~/.github-pr-minimap, or $PR_MINIMAP_DIR), replacing the
# version already there, so Chrome keeps loading the extension from the same place.
# PR_MINIMAP_ZIP_URL downloads a different zip, such as a local build for testing (file://...).
set -eu

dir=${PR_MINIMAP_DIR:-"$HOME/.github-pr-minimap"}
url=${PR_MINIMAP_ZIP_URL:-https://github.com/tkuminecz/github-pr-minimap/releases/latest/download/github-pr-minimap.zip}

for tool in curl unzip; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "This needs $tool, which isn't installed." >&2
    exit 1
  fi
done

# Only ever replace a folder holding this extension, never anything else at that path.
if [ -e "$dir" ] && ! grep -qs '"name": "GitHub PR Minimap"' "$dir/manifest.json"; then
  echo "$dir already exists and isn't GitHub PR Minimap, so it's been left alone." >&2
  echo "Set PR_MINIMAP_DIR to install somewhere else." >&2
  exit 1
fi

# Download and unpack first, so a failed download leaves the installed version as it was.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$url" -o "$tmp/release.zip"
unzip -q "$tmp/release.zip" -d "$tmp"
if ! grep -qs '"name": "GitHub PR Minimap"' "$tmp/github-pr-minimap/manifest.json"; then
  echo "The download doesn't look like a release of GitHub PR Minimap." >&2
  exit 1
fi

if [ -e "$dir" ]; then updating=true; else updating=false; fi
rm -rf "$dir"
mkdir -p "$(dirname "$dir")"
mv "$tmp/github-pr-minimap" "$dir"
version=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' "$dir/manifest.json")

if $updating; then
  echo "Updated GitHub PR Minimap to v$version, in $dir"
  echo "Open chrome://extensions and click the reload icon on its card."
else
  echo "Installed GitHub PR Minimap v$version, in $dir"
  echo "To load it in Chrome (just once):"
  echo "  1. Open chrome://extensions and turn on Developer mode (top right)."
  echo "  2. Click Load unpacked and choose that folder. In the file picker, Cmd+Shift+G (Mac)"
  echo "     or Ctrl+L (Linux) lets you paste its path."
  if command -v pbcopy >/dev/null 2>&1; then
    printf %s "$dir" | pbcopy
    echo "     The path is on your clipboard."
  fi
  echo "Run this again to update; then click reload on the extension's card."
fi
