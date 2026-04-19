#!/usr/bin/env bash
# lint-no-hex.sh — Reject hardcoded hex color literals in overlay/legend files.
# Colors must come from frontend/src/design/ramps.js, not be hardcoded.
#
# Exempt: hex values inside comments, and the ramps.js / tokens.css files themselves.

set -euo pipefail

SEARCH_DIR="$(dirname "$0")/../src"
PATTERN='#[0-9a-fA-F]{3,8}\b'
FAIL=0

# Files to check: *Layer*.js and *Legend.js
while IFS= read -r -d '' file; do
  # Skip design system files themselves
  case "$file" in
    */design/*) continue ;;
    */config/*) continue ;;
  esac

  # grep for hex pattern, ignoring comment lines (// and /* */)
  matches=$(grep -nE "$PATTERN" "$file" | grep -vE '^\s*(//|/?\*)' || true)

  if [[ -n "$matches" ]]; then
    echo "❌ Hex color literal found in: $file"
    echo "$matches"
    echo "   → Import colors from frontend/src/design/ramps.js instead."
    FAIL=1
  fi
done < <(find "$SEARCH_DIR" -type f \( -name "*Layer*.js" -o -name "*Legend.js" \) -print0)

if [[ $FAIL -eq 1 ]]; then
  echo ""
  echo "lint-no-hex: FAILED — fix the above before building."
  exit 1
else
  echo "✅ lint-no-hex: no hex literals found in layer/legend files."
fi
