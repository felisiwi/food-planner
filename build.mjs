// Builds list.html, a self-contained phone page, from data/results.json plus
// any manual prices in prices/<store>.csv.
// Usage: node build.mjs [data/results.json] [list.html]

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseCsv } from './lib/list.mjs';

const IN = process.argv[2] || 'data/results.json';
const OUT = process.argv[3] || 'list.html';
const STORES = [
  { id: 'morrisons', label: 'Morrisons', place: 'Stamford Hill' },
  { id: 'lidl', label: 'Lidl', place: 'Amhurst Park' },
];

const db = JSON.parse(await readFile(IN, 'utf8'));

// Manual prices fill items a store doesn't list online (or replace a bad match).
const manual = {};
for (const s of STORES) {
  const f = `prices/${s.id}.csv`;
  manual[s.id] = {};
  if (!existsSync(f)) continue;
  for (const r of parseCsv(await readFile(f, 'utf8'))) {
    const price = Number(r.price);
    if (r.term && price > 0) {
      manual[s.id][r.term] = { name: r.name || r.term, price, date: r.date || '', source: 'manual', category: [], available: true };
    }
  }
}

const rows = (db.list || []).map(({ qty, term }) => {
  const stores = {};
  for (const s of STORES) {
    const online = db.stores?.[s.id]?.[term]?.products || [];
    const m = manual[s.id][term];
    stores[s.id] = m ? [m, ...online] : online;
  }
  return { qty, term, stores };
});

const payload = JSON.stringify({ rows, stores: STORES, updatedAt: db.updatedAt || Date.now(), demo: !!db.demo }).replace(
  /</g,
  '\\u003c',
);
const template = await readFile(new URL('./page.html', import.meta.url), 'utf8');
await writeFile(OUT, template.replace('/*__DATA__*/null', payload));
console.log(`Wrote ${OUT} (${rows.length} items)`);
