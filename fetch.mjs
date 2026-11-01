// Looks up each line of list.txt at each store and caches the top matches in
// data/results.json.
//
// Deliberately polite: one request every 6s per store, honest user agent,
// 24h cache per store+term, and each store stops at its first non-200 response
// without retrying. Don't lower the delay or disguise the requests.
//
// Usage: node fetch.mjs [list.txt] [--store morrisons|lidl]

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as morrisons from './lib/morrisons.mjs';
import * as lidl from './lib/lidl.mjs';
import { parseList } from './lib/list.mjs';

const args = process.argv.slice(2);
const only = args.includes('--store') ? args[args.indexOf('--store') + 1] : null;
const LIST = args.find((a) => a.endsWith('.txt')) || 'list.txt';
const OUT = 'data/results.json';
const DELAY_MS = 6000;
const CACHE_MS = 24 * 60 * 60 * 1000;
const UA = 'food-planner/0.2 (personal shopping-list tool; low volume)';
const STORES = [morrisons, lidl].filter((s) => !only || s.id === only);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const items = parseList(await readFile(LIST, 'utf8'));
await mkdir('data', { recursive: true });
const db = existsSync(OUT) ? JSON.parse(await readFile(OUT, 'utf8')) : {};
db.stores ||= {};
const save = () => writeFile(OUT, JSON.stringify(db, null, 2));

for (const store of STORES) {
  console.log(`\n${store.label}`);
  const cache = (db.stores[store.id] ||= {});
  let fetched = 0;
  for (const { term } of items) {
    const hit = cache[term];
    if (hit && Date.now() - hit.fetchedAt < CACHE_MS) {
      console.log(`  cached  ${term}`);
      continue;
    }
    if (fetched > 0) await sleep(DELAY_MS);
    const res = await fetch(store.searchUrl(term), { headers: { 'User-Agent': UA, Accept: 'text/html' } });
    fetched++;
    if (res.status !== 200) {
      console.error(`  Stopped ${store.label}: HTTP ${res.status} on "${term}". Not retrying; run again later.`);
      break;
    }
    try {
      const products = store.extract(await res.text(), 4, term);
      cache[term] = { fetchedAt: Date.now(), products };
      const top = products[0];
      console.log(`  ok      ${term} → ${top ? `${top.name} £${top.price.toFixed(2)}` : 'not listed online'}`);
    } catch (e) {
      console.error(`  failed  ${term}: ${e.message}`);
    }
    await save();
  }
}

db.list = items;
db.updatedAt = Date.now();
await save();
console.log(`\nSaved ${OUT}. Now run: node build.mjs`);
