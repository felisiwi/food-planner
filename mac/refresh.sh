#!/bin/zsh
# Nightly price refresh (launchd: mac/com.felix.food-planner-refresh.plist).
# Polite and slow: one request every few seconds with an honest user agent,
# stopping if a shop says no. Then rebuilds the website's data and pushes it,
# which makes Vercel redeploy.
set -u
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
log() { echo "$(date '+%F %T') $*"; }

log "refresh start"
git pull -q --rebase --autostash origin main || log "git pull failed"

# Skip the comparison crawl if one is already running (e.g. a manual run).
if ! pgrep -f "node compare.mjs" >/dev/null; then
  caffeinate -i node compare.mjs --delay 45 --patient >> data/compare.log 2>&1 || log "compare stopped early"
fi
caffeinate -i node fetch.mjs || log "fetch stopped early"
[ -d app/node_modules ] || npm --prefix app ci --silent
node build-app.mjs || { log "build failed"; exit 1; }

# Receipts (Lidl Plus): upload new prices to Supabase if there are any.
[ -x .venv/bin/ilidl ] && node lidl-receipts.mjs >/dev/null 2>&1 && node mac/upload-receipts.mjs || true

if ! git diff --quiet -- app/public/data.json; then
  git add app/public/data.json
  git commit -qm "Nightly price refresh $(date +%F)"
  git push -q origin main && log "pushed new prices" || log "push failed"
else
  log "no price changes"
fi
log "refresh done"
