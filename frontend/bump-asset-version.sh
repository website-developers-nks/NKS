#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${1:-$(date +%s)}"

for f in *.html; do
  sed -i -E "s#(src|href)=\"((css|js)/[^\"?]+\.(css|js))(\?v=[^\"]*)?\"#\1=\"\2?v=${VERSION}\"#g" "$f"
done

echo "Bumped asset version to: ${VERSION}"
