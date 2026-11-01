// Sends receipt prices (data/lidl-receipt-prices.json) to Supabase, where the
// website reads them with the household key. Safe to run repeatedly.
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const env = Object.fromEntries(
  readFileSync(new URL('.fp-env', root), 'utf8').split('\n').filter((l) => /^\w+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const file = new URL('data/lidl-receipt-prices.json', root);
if (!existsSync(file)) process.exit(0);
const items = Object.values(JSON.parse(readFileSync(file, 'utf8')).items || {});
const res = await fetch(`${env.FP_SUPABASE_URL}/rest/v1/rpc/fp_add_receipts`, {
  method: 'POST',
  headers: { apikey: env.FP_SUPABASE_ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ k: env.FP_KEY, items }),
});
console.log('receipts uploaded:', res.ok ? await res.text() : `failed ${res.status}`);
