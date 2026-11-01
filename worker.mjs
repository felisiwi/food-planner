// Answers "make my list" requests from the website, using Claude Code on this Mac.
// launchd runs it every 2 minutes (mac/com.felix.food-planner-worker.plist).
// It claims any waiting requests in Supabase, asks Claude for the ingredients
// (no tools, text only) and writes the answer back.
//
// Usage: node worker.mjs        (reads .fp-env)

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ingredientsPrompt, cleanIngredients } from './lib/ingredients.mjs';

const env = Object.fromEntries(
  readFileSync(new URL('./.fp-env', import.meta.url), 'utf8')
    .split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const CLAUDE = process.env.FP_CLAUDE || `${process.env.HOME}/.local/bin/claude`;

async function rpc(name, args) {
  const res = await fetch(`${env.FP_SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: env.FP_SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ k: env.FP_KEY, ...args }),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a);

const jobs = await rpc('fp_claim_requests', {});
for (const { id, meals } of jobs || []) {
  log(`request ${id}: ${String(meals).slice(0, 80).replace(/\n/g, ' ')}`);
  const r = spawnSync(CLAUDE, ['-p', '--tools', '', '--no-session-persistence', '--model', 'sonnet', '--output-format', 'text'], {
    input: ingredientsPrompt(meals), encoding: 'utf8', timeout: 5 * 60 * 1000, maxBuffer: 4 * 1024 * 1024,
  });
  try {
    if (r.status !== 0) throw new Error((r.stderr || r.error?.message || 'claude failed').slice(0, 300));
    const items = cleanIngredients(r.stdout);
    await rpc('fp_finish', { rid: id, result: items, err: null });
    log(`request ${id}: ${items.length} ingredients`);
  } catch (e) {
    const msg = e?.message || e?.code || String(e);
    await rpc('fp_finish', { rid: id, result: null, err: msg }).catch(() => {});
    log(`request ${id} failed: ${msg}`);
  }
}
