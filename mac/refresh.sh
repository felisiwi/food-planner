#!/bin/zsh
# Nightly price refresh (launchd: mac/com.felix.food-planner-refresh.plist).
# Polite and slow: one request every few seconds with an honest user agent,
# stopping if a shop says no. Then mac/update-prices.sh rebuilds the website's
# data and pushes it, which makes Vercel redeploy.
set -u
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
log() { echo "$(date '+%F %T') $*"; }

log "refresh start"

# Skip the comparison crawl if one is already running (e.g. a manual run).
if ! pgrep -f "node compare.mjs" >/dev/null; then
  caffeinate -i node compare.mjs --delay 45 --patient >> data/compare.log 2>&1 || log "compare stopped early"
fi
# Receipts (Lidl Plus): upload new prices to Supabase if there are any.
[ -x .venv/bin/ilidl ] && node lidl-receipts.mjs >/dev/null 2>&1 && node mac/upload-receipts.mjs || true
zsh mac/update-prices.sh
log "refresh done"
