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
import { rank } from './lib/match.mjs';

const args = process.argv.slice(2);
const only = args.includes('--store') ? args[args.indexOf('--store') + 1] : null;
const LIST = args.find((a) => a.endsWith('.txt')) || 'list.txt';
const OUT = 'data/results.json';
const DELAY_MS = 6000;
const CACHE_MS = 24 * 60 * 60 * 1000;
const UA = 'food-planner/0.3 (personal shopping-list tool; low volume)';
// Bump when the extracted data changes shape, so old cached results are refetched once.
const CACHE_VERSION = 3;
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

  // Stores with a small online range (Lidl) are fetched whole, once a day, then
  // matched locally: fewer requests than one search per item, and nothing missed.
  if (store.rangeUrl) {
    const range = (db.ranges ||= {})[store.id];
    let products = range && range.v === CACHE_VERSION && Date.now() - range.fetchedAt < CACHE_MS ? range.products : null;
    if (products) console.log(`  cached  whole range (${products.length} products)`);
    else {
      const seen = new Map();
      let total = null, complete = false;
      for (let offset = 0; offset < 2000; offset += store.PAGE_SIZE) {
        if (offset > 0) await sleep(DELAY_MS);
        const res = await fetch(store.rangeUrl(offset), { headers: { 'User-Agent': UA, Accept: 'text/html' } });
        if (res.status !== 200) {
          console.error(`  Stopped ${store.label}: HTTP ${res.status} at offset ${offset}. Not retrying; run again later.`);
          break;
        }
        const page = store.rangePage(await res.text());
        total ??= page.total;
        const before = seen.size;
        for (const p of page.products) seen.set(p.id, p);
        console.log(`  page    ${offset / store.PAGE_SIZE + 1}: ${seen.size}${total ? ' of ' + total : ''} products`);
        if (seen.size === before || (total && seen.size >= total)) { complete = true; break; }
      }
      products = [...seen.values()];
      if (complete) db.ranges[store.id] = { v: CACHE_VERSION, fetchedAt: Date.now(), products };
      else console.error('  Range incomplete; matching what was fetched, not caching it.');
    }
    for (const { term } of items) {
      const matches = store.match(products, term, 12);
      cache[term] = { v: CACHE_VERSION, fetchedAt: Date.now(), products: matches };
      const top = rank(term, matches)[0];
      console.log(`  ${top ? 'ok     ' : 'none   '} ${term} → ${top ? `${top.name} £${top.price.toFixed(2)}` : 'not in Lidl\'s online range'}`);
    }
    await save();
    continue;
  }

  for (const { term } of items) {
    const hit = cache[term];
    if (hit && hit.v === CACHE_VERSION && Date.now() - hit.fetchedAt < CACHE_MS) {
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
      const products = store.extract(await res.text(), 12, term);
      cache[term] = { v: CACHE_VERSION, fetchedAt: Date.now(), products };
      const top = rank(term, products)[0];
      console.log(
        `  ok      ${term} → ${top ? `${top.name} £${top.price.toFixed(2)}${top.match ? ' (cheapest match)' : ' (no exact match)'}` : 'not listed online'}`,
      );
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
