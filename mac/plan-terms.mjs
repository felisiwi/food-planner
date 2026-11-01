// Writes data/plan-list.txt: list.txt plus every item on the saved plan in
// Supabase, so the price fetch covers what you're actually going to buy.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const env = Object.fromEntries(
  readFileSync(new URL('.fp-env', root), 'utf8').split('\n').filter((l) => /^\w+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const res = await fetch(`${env.FP_SUPABASE_URL}/rest/v1/rpc/fp_get_state`, {
  method: 'POST',
  headers: { apikey: env.FP_SUPABASE_ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ k: env.FP_KEY }),
});
const state = res.ok ? await res.json() : {};
const base = existsSync(new URL('list.txt', root)) ? readFileSync(new URL('list.txt', root), 'utf8').split('\n') : [];
const terms = new Set(base.map((l) => l.replace(/#.*/, '').replace(/^\s*\d+\s*x\s*/i, '').trim().toLowerCase()).filter(Boolean));
for (const it of state.plan?.value?.items || []) if (it?.item) terms.add(String(it.item).trim().toLowerCase());
writeFileSync(new URL('data/plan-list.txt', root), [...terms].join('\n') + '\n');
console.log(`${terms.size} terms`);
