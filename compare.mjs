// Compares everyday food Lidl lists online (plus your Lidl receipt items) with
// the cheapest equivalent at Morrisons, and writes compare.html.
//
// Lidl's range comes from data/results.json (run `node fetch.mjs --store lidl`
// first). For each Lidl product it searches Morrisons for the plain product
// ("grated mozzarella", not "MILBONA XXL Grated Mozzarella 500 g").
// Polite like fetch.mjs: 6s between Morrisons requests, honest user agent,
// results cached 7 days, stops at the first non-200 response.
//
// Usage: node compare.mjs [--limit N] [--delay SECONDS] [--patient]
//   --delay    seconds between Morrisons searches (default 6; use 45 for long runs)
//   --patient  on a block, wait 30 minutes and carry on at the same slow pace,
//              giving up after 3 blocks (for unattended overnight runs)

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as morrisons from './lib/morrisons.mjs';
import { relevant } from './lib/match.mjs';

const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const DELAY_MS = (args.includes('--delay') ? Number(args[args.indexOf('--delay') + 1]) : 6) * 1000;
const PATIENT = args.includes('--patient');
const BLOCK_WAIT_MS = 30 * 60 * 1000;
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE = 'data/compare-morrisons.json';
const UA = 'food-planner/0.3 (personal shopping-list tool; low volume)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Everyday food sections of Lidl's online range (seasonal sweets, alcohol,
// flowers, non-food and in-store bakery pastries left out).
const EVERYDAY = /^(Food Cupboard|Ready meals|Cheese, dairy|Meat & Poultry|Fruit & vegetables|Frozen food|Oils, Spices|Coffee, tea|Muesli|Fish & Seafood)/;
const isEveryday = (p) => EVERYDAY.test(p.category?.[0] || '') || (p.category?.[0] === 'Bakery' && !/Pastries/.test(p.category?.[1] || ''));

// "MILBONA XXL Grated Mozzarella 500 g" → "grated mozzarella"
function plainTerm(name) {
  return name
    .replace(/\b0\d{6}\b/g, '') // receipt product codes
    .replace(/\b[A-Z][A-Z'&.-]{1,}\b(\s+[A-Z][A-Z'&.-]{1,}\b)*/g, (m) => (m.length <= 3 && /^(UHT|BBQ)$/.test(m) ? m : '')) // brands are in capitals
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b\d+([.,]\d+)?\s*(x\s*\d+\s*)?(g|kg|ml|cl|l|ltr|pt|pint|pack|pk|s)\b/gi, ' ')
    .replace(/\b\d+\s*x\b|\bx\s*\d+\b|\b\d+\b/gi, ' ')
    .replace(/\b(xxl|loose|large pack|pack|family|classic|h protein)\b/gi, (m) => (/h protein/i.test(m) ? 'high protein' : ' '))
    .replace(/[^\w\s&'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Unit prices in comparable units: per kg, per litre or each.
function perUnit(p) {
  if (!p.unitPrice || !p.unitLabel) return null;
  const l = p.unitLabel.toLowerCase().replace(/\s/g, '');
  if (/per100g/.test(l)) return { v: p.unitPrice * 10, u: 'kg' };
  if (/per100ml/.test(l)) return { v: p.unitPrice * 10, u: 'l' };
  if (/perkg/.test(l)) return { v: p.unitPrice, u: 'kg' };
  if (/per(l|litre|ltr)$/.test(l)) return { v: p.unitPrice, u: 'l' };
  if (/pereach|perunit|peritem/.test(l)) return { v: p.unitPrice, u: 'each' };
  return null;
}

const db = JSON.parse(await readFile('data/results.json', 'utf8'));
const range = (db.ranges?.lidl?.products || []).filter((p) => p.isFood && p.price > 0 && isEveryday(p));
const receipts = existsSync('data/lidl-receipt-prices.json')
  ? Object.values(JSON.parse(await readFile('data/lidl-receipt-prices.json', 'utf8')).items || {})
      .filter((r) => !/shower|gel|toilet|doughnut|choc/i.test(r.name))
      .map((r) => ({
        name: r.name, price: r.price, image: null, category: [], source: 'receipt', date: r.date,
        unitPrice: r.perKg ? r.price : null, unitLabel: r.perKg ? 'per kg' : '',
      }))
  : [];
const lidl = [...range.map((p) => ({ ...p, source: 'online' })), ...receipts];
if (!range.length) console.warn('No Lidl range cached. Run: node fetch.mjs --store lidl');

const cache = existsSync(CACHE) ? JSON.parse(await readFile(CACHE, 'utf8')) : {};
const terms = [...new Set(lidl.map((p) => plainTerm(p.name)).filter((t) => t.split(' ').length >= 1 && t.length >= 3))];
console.log(`${lidl.length} Lidl products → ${terms.length} Morrisons searches (${terms.filter((t) => cache[t] && Date.now() - cache[t].fetchedAt < CACHE_MS).length} cached).`);

let fetched = 0, blocks = 0;
const stamp = () => new Date().toTimeString().slice(0, 5);
search: for (const term of terms.slice(0, LIMIT)) {
  if (cache[term] && Date.now() - cache[term].fetchedAt < CACHE_MS) continue;
  let res;
  for (;;) {
    if (fetched > 0) await sleep(DELAY_MS);
    res = await fetch(morrisons.searchUrl(term), { headers: { 'User-Agent': UA, Accept: 'text/html' } });
    fetched++;
    if (res.status === 200) break;
    blocks++;
    if (!PATIENT || blocks >= 3) {
      console.error(`${stamp()} Stopped: Morrisons returned HTTP ${res.status} on "${term}". Run again later (progress is saved).`);
      break search;
    }
    console.error(`${stamp()} Morrisons returned HTTP ${res.status} on "${term}" (block ${blocks} of 3). Waiting 30 minutes.`);
    await sleep(BLOCK_WAIT_MS);
  }
  try {
    cache[term] = { fetchedAt: Date.now(), products: morrisons.extract(await res.text(), 12) };
  } catch (e) {
    console.error(`failed ${term}: ${e.message}`);
  }
  await writeFile(CACHE, JSON.stringify(cache));
  if (fetched % 10 === 0) console.log(`${stamp()}  ${Object.keys(cache).length} of ${terms.length} searched`);
}

// Pair each Lidl product with the cheapest real Morrisons match, comparing by
// unit price where both have the same unit, otherwise by pack price.
const pairs = [];
for (const l of lidl) {
  const term = plainTerm(l.name);
  const cands = (cache[term]?.products || []).map(morrisons.fixUnit).filter((m) => relevant(term, m.name));
  if (!cands.length) continue;
  const lu = perUnit(l);
  const sameUnit = lu ? cands.filter((m) => perUnit(m)?.u === lu.u) : [];
  const pool = sameUnit.length ? sameUnit : cands;
  const by = sameUnit.length ? (m) => perUnit(m).v : (m) => m.price;
  const m = pool.reduce((a, b) => (by(b) < by(a) ? b : a));
  const unit = sameUnit.length ? lu.u : null;
  const lv = unit ? lu.v : l.price;
  const mv = unit ? perUnit(m).v : m.price;
  pairs.push({
    term,
    section: l.category?.[0] || 'From receipts',
    lidl: { name: l.name, price: l.price, unit: lu, image: l.image, offer: l.offer || null, source: l.source, date: l.date || null },
    morrisons: { name: m.name, price: m.price, unit: perUnit(m), image: m.image, offer: m.offer || null },
    basis: unit ? `per ${unit}` : 'per pack',
    saving: Math.round(((mv - lv) / Math.max(mv, lv)) * 1000) / 10, // + means Lidl cheaper
  });
}

// One row per Morrisons product if several Lidl items map to it: keep the closest price.
const seen = new Map();
for (const p of pairs) {
  const k = p.lidl.name.toLowerCase();
  if (!seen.has(k)) seen.set(k, p);
}
const rows = [...seen.values()].sort((a, b) => b.saving - a.saving);
const out = { createdAt: Date.now(), rows, lidlCount: lidl.length };
await writeFile('data/compare.json', JSON.stringify(out, null, 2));

const lidlWins = rows.filter((r) => r.saving > 0.5).length;
const morrWins = rows.filter((r) => r.saving < -0.5).length;
console.log(`\nCompared ${rows.length} products: Lidl cheaper on ${lidlWins}, Morrisons on ${morrWins}, about the same on ${rows.length - lidlWins - morrWins}.`);

const payload = JSON.stringify(out).replace(/</g, '\\u003c');
const tpl = await readFile(new URL('./compare-page.html', import.meta.url), 'utf8');
const page = tpl.replace('/*__DATA__*/null', payload);
await writeFile('compare.html', page);
await writeFile(
  'compare.artifact.html',
  page.replace(/<!doctype html>\s*/i, '').replace(/<html[^>]*>\s*/i, '').replace(/<\/?head>\s*/gi, '')
    .replace(/<meta charset[^>]*>\s*/i, '').replace(/<meta name="viewport"[^>]*>\s*/i, '')
    .replace(/<body>\s*/i, '').replace(/<\/body>\s*<\/html>\s*$/i, ''),
);
console.log('Wrote compare.html');
