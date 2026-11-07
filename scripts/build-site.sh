#!/usr/bin/env bash
# Assemble the GitHub Pages landing page into a single directory.
# The page lives in site/. The live badge on it is this repository's own
# production build of the embed entry, copied in at build time.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$root/_site}"

version="$(node -p "require('$root/package.json').version")"
if ! grep -q "v$version" "$root/site/index.html"; then
  echo "site/index.html does not mention v$version; update the page before deploying." >&2
  exit 1
fi

if [ ! -d "$root/node_modules" ]; then
  (cd "$root" && npm ci)
fi
(cd "$root" && npm run clean >/dev/null && NODE_ENV=production npm run build >/dev/null)

rm -rf "$out"
mkdir -p "$out/badge"
cp -R "$root/site/." "$out/"
cp -R "$root/dist/embed/." "$out/badge/"
rm -f "$out/badge/module-graph.json"
cp "$root/LICENSE" "$out/badge/LICENSE"
touch "$out/.nojekyll"
echo "Site assembled in $out (badge $version)"
