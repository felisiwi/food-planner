// Builds list.html, a self-contained phone page, from data/results.json plus
// any manual prices in prices/<store>.csv.
// Usage: node build.mjs [data/results.json] [list.html]

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseCsv } from './lib/list.mjs';
import { rank, relevant } from './lib/match.mjs';

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

// Prices you actually paid, from Lidl Plus receipts (node lidl-receipts.mjs).
// Receipt names are often shortened ("Chop Tomatoes"), so a looser match is
// allowed and flagged as "closest" on the page.
const receiptBook = existsSync('data/lidl-receipt-prices.json')
  ? Object.values(JSON.parse(await readFile('data/lidl-receipt-prices.json', 'utf8')).items || {})
  : [];
const stem = (w) => w.toLowerCase().replace(/[^a-z]/g, '');
function fromReceipts(term) {
  const words = term.split(/\s+/).map(stem).filter((w) => w.length >= 3);
  return receiptBook
    .map((r) => {
      if (relevant(term, r.name)) return { r, match: true };
      const have = r.name.split(/\s+/).map(stem);
      const loose = words.length && words.every((w) => have.some((h) => h.length >= 3 && (w.startsWith(h) || h.startsWith(w))));
      return loose ? { r, match: false } : null;
    })
    .filter(Boolean)
    .map(({ r, match }) => ({
      name: r.name + (r.perKg ? ' (per kg)' : ''),
      price: r.price,
      date: r.date,
      source: 'receipt',
      match,
      category: [],
      available: true,
    }));
}

const rows = (db.list || []).map(({ qty, term }) => {
  const stores = {};
  for (const s of STORES) {
    const receipts = s.id === 'lidl' ? fromReceipts(term) : [];
    const online = rank(term, [...receipts, ...(db.stores?.[s.id]?.[term]?.products || [])]);
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
const page = template.replace('/*__DATA__*/null', payload);
await writeFile(OUT, page);

// Same page without the document wrapper, for publishing as a claude.ai artifact
// (the host adds its own doctype, head and body).
const fragment = page
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<body>\s*/i, '')
  .replace(/<\/body>\s*<\/html>\s*$/i, '');
await writeFile(OUT.replace(/\.html$/, '') + '.artifact.html', fragment);
console.log(`Wrote ${OUT} (${rows.length} items)`);
