#!/usr/bin/env bash
# Open TablePlus and put the local RadDash Postgres URL on the clipboard (when possible).
# In TablePlus: Create a new connection → PostgreSQL → Import from URL → paste (Ctrl+V).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="$(tr -d '[:space:]' <"$ROOT/scripts/tableplus-rad-dash.url")"

if command -v wl-copy >/dev/null 2>&1 && printf '%s' "$URL" | wl-copy 2>/dev/null; then
  echo "Copied connection URL to clipboard (wl-copy)."
elif command -v xclip >/dev/null 2>&1 && printf '%s' "$URL" | xclip -selection clipboard 2>/dev/null; then
  echo "Copied connection URL to clipboard (xclip)."
else
  echo "Install wl-copy (Wayland) or xclip (X11) to auto-copy; otherwise paste this URL:"
  echo ""
  echo "  $URL"
  echo ""
fi

if command -v tableplus >/dev/null 2>&1; then
  nohup tableplus >/dev/null 2>&1 &
  disown 2>/dev/null || true
  echo "Started TablePlus. Create → PostgreSQL → Import from URL → paste."
else
  echo "TablePlus CLI not found in PATH (install TablePlus for Linux)."
  exit 1
fi
