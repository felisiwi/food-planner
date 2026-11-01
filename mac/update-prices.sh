#!/bin/zsh
# Fetches prices for list.txt plus the saved plan, rebuilds the website's data
# and pushes it if anything changed (Vercel then redeploys in about a minute).
# Used by the worker after a new list and by the nightly refresh.
set -u
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
log() { echo "$(date '+%F %T') $*"; }
mkdir data/.update.lock 2>/dev/null || { log "update already running"; exit 0; }
trap 'rmdir data/.update.lock' EXIT

git pull -q --rebase --autostash origin main || log "git pull failed"
node mac/plan-terms.mjs >/dev/null && caffeinate -i node fetch.mjs data/plan-list.txt >/dev/null 2>&1 || log "fetch stopped early"
[ -d app/node_modules ] || npm --prefix app ci --silent
node build-app.mjs >/dev/null || { log "build failed"; exit 1; }
if ! git diff --quiet -- app/public/data.json; then
  git add app/public/data.json
  git commit -qm "Price update $(date '+%F %H:%M')"
  git push -q origin main && log "pushed new prices" || log "push failed"
else
  log "no price changes"
fi
