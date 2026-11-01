// Combines Aldi category pages into data/aldi-range.json.
//
// aldi.co.uk refuses scripted requests, but its robots.txt allows Claude's web
// fetcher on category pages (not search results or page 2+). So the pages are
// read with Claude's WebFetch, one per food category, and saved as JSON arrays
// of {category, name, size, price, unitText, was, url, image}; this script
// checks and merges them.
//
// Usage: node aldi.mjs part1.json part2.json ...           (category pages -> data/aldi-range.json)
//        node aldi.mjs --lookups x1.json x2.json ...      (single product pages found per list item
//                                                          -> data/aldi-lookups.json, added to what's there)

import { readFile, writeFile } from 'node:fs/promises';
import { toProduct } from './lib/aldi.mjs';

const lookups = process.argv.includes('--lookups');
const files = process.argv.slice(2).filter((a) => a !== '--lookups');
if (!files.length) { console.error('Usage: node aldi.mjs part.json ...'); process.exit(1); }

const seen = new Map();
const perCat = {};
let dropped = 0, labelOff = 0;
const unpriced = {};
if (lookups) {
  // Keep earlier lookups; newer ones for the same item replace them.
  const old = JSON.parse(await readFile('data/aldi-lookups.json', 'utf8').catch(() => '{"products":[],"unpriced":{}}'));
  const fresh = new Set();
  for (const f of files) for (const r of JSON.parse(await readFile(f, 'utf8'))) if (r.term) fresh.add(r.term);
  for (const r of old.products) if (!fresh.has(r.term)) seen.set(r.term + '|' + (r.url || r.name), r);
  for (const [t, v] of Object.entries(old.unpriced || {})) if (!fresh.has(t)) unpriced[t] = v;
}
for (const f of files) {
  for (const raw of JSON.parse(await readFile(f, 'utf8'))) {
    if (!raw.name) continue;
    const price = Number(raw.price);
    if (lookups && !(price > 0)) {
      // On Aldi's site but no price shown ("currently not available").
      if (raw.term) (unpriced[raw.term] ||= []).push({ name: raw.name, url: raw.url || null });
      continue;
    }
    if (!(price > 0) || price > 100) { dropped++; continue; }
    const p = toProduct(raw);
    // No pack size and no per-item price (e.g. joints priced per 0.5 kg): can't say what a pack costs.
    if (!p.unitPrice) { dropped++; continue; }
    // Cross-check: Aldi's own unit-price figure should match price ÷ pack size,
    // either as shown or read as per kg (the label sometimes says /100 G for a per-kg figure).
    const shown = Number(String(raw.unitText || '').match(/£\s*(\d+(?:\.\d+)?)/)?.[1]);
    if (shown && p.unitPrice && Math.abs(shown - p.unitPrice) / p.unitPrice > 0.06 && Math.abs(shown * 10 - p.unitPrice) / p.unitPrice > 0.06) { labelOff++; continue; }
    const key = lookups ? raw.term + '|' + (raw.url || raw.name) : raw.name + '|' + raw.size;
    if (!seen.has(key)) {
      seen.set(key, { ...raw, price, was: Number(raw.was) || null });
      perCat[raw.category] = (perCat[raw.category] || 0) + 1;
    }
  }
}
const products = [...seen.values()];
if (lookups) {
  // An item that got a price somewhere isn't "unpriced".
  for (const p of products) delete unpriced[p.term];
  await writeFile('data/aldi-lookups.json', JSON.stringify({ fetchedAt: Date.now(), source: 'aldi.co.uk product pages, looked up per list item', products, unpriced }, null, 1));
  console.log(`${products.length} looked-up Aldi products; ${Object.keys(unpriced).length} items on Aldi's site without a price (${dropped} dropped, ${labelOff} failed the price check).`);
  process.exit(0);
}
await writeFile('data/aldi-range.json', JSON.stringify({ fetchedAt: Date.now(), source: 'aldi.co.uk category pages, first page each', products }, null, 1));
console.log(`${products.length} Aldi products from ${Object.keys(perCat).length} categories (${dropped} rows dropped, ${labelOff} left out because price, pack size and unit price didn't agree).`);
