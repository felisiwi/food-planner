// Every Lidl price we have (online range + receipts) against its closest
// Morrisons equivalent, compared for the same amount (the Lidl pack's size).
// Uses cached data only; makes no requests.
//
// Usage: node analysis/lidl-vs-morrisons.mjs  -> analysis/lidl-vs-morrisons.json + summary

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { relevant } from '../lib/match.mjs';
import { fixUnit } from '../lib/morrisons.mjs';

globalThis.window = { __FP_DATA__: { morrisons: {}, lidl: [], receipts: [] } };
const { packSize, perUnit } = await import('../app/src/data.js');

const read = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);
const results = read('data/results.json', {});
const cache = read('data/compare-morrisons.json', {});
const receipts = Object.values(read('data/lidl-receipt-prices.json', { items: {} }).items || {});

// Same rule as compare.mjs for what counts as everyday food.
const EVERYDAY = /^(Food Cupboard|Ready meals|Cheese, dairy|Meat & Poultry|Fruit & vegetables|Frozen food|Oils, Spices|Coffee, tea|Muesli|Fish & Seafood)/;
const isEveryday = (p) => EVERYDAY.test(p.category?.[0] || '') || (p.category?.[0] === 'Bakery' && !/Pastries/.test(p.category?.[1] || ''));
function plainTerm(name) {
  return name
    .replace(/\b0\d{6}\b/g, '')
    .replace(/\b[A-Z][A-Z'&.-]{1,}\b(\s+[A-Z][A-Z'&.-]{1,}\b)*/g, (m) => (m.length <= 3 && /^(UHT|BBQ)$/.test(m) ? m : ''))
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b\d+([.,]\d+)?\s*(x\s*\d+\s*)?(g|kg|ml|cl|l|ltr|pt|pint|pack|pk|s)\b/gi, ' ')
    .replace(/\b\d+\s*x\b|\bx\s*\d+\b|\b\d+\b/gi, ' ')
    .replace(/\b(xxl|loose|large pack|pack|family|classic|h protein)\b/gi, (m) => (/h protein/i.test(m) ? 'high protein' : ' '))
    .replace(/[^\w\s&'-]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Every Morrisons product we've seen, by search term.
const morrisonsBy = {};
for (const [t, v] of Object.entries(cache)) morrisonsBy[t] = (v.products || []).map(fixUnit);
for (const [t, v] of Object.entries(results.stores?.morrisons || {})) morrisonsBy[t.toLowerCase()] ||= (v.products || []).map(fixUnit);

const lidl = [
  ...(results.ranges?.lidl?.products || []).filter((p) => p.isFood && p.price > 0 && isEveryday(p))
    .map((p) => ({ ...p, regular: p.regularPrice || p.price, plus: p.price, from: 'online' })),
  ...receipts.filter((r) => !/shower|gel|toilet|doughnut|choc/i.test(r.name)).map((r) => ({
    name: r.name, price: r.price, regular: r.price, plus: r.price, from: 'receipt', category: ['From receipts'],
    unitPrice: r.perKg ? r.price : null, unitLabel: r.perKg ? 'per kg' : '', source: 'receipt',
  })),
];

const flag = (re, s) => re.test(s);
const tierOf = (name) => (/\bthe best\b/i.test(name) ? 'premium' : /\bsavers\b/i.test(name) ? 'value' : 'standard');
const lidlTier = (name) => (/\bDELUXE\b/.test(name) ? 'premium' : 'standard');

// Pairs checked by eye on 1 Nov 2026 and found not to be the same product.
const BAD_MATCH = [
  /^Bananas Loose/i,                 // -> banana crisps
  /Gnocchi/i,                        // -> cauliflower gnocchi
  /DULANO Meatballs/i,               // -> tinned meatballs in gravy
  /ERIDANOUS Greek Yogurt/i,         // Greek yogurt -> Greek-style yogurt
  /ERIDANOUS Tuna/i,                 // Greek tuna -> tuna chunks in spring water
  /^Olives 250/i,                    // whole olives -> sliced black olives
  /^Dips 250/i,                      // unnamed dip -> salsa
];
const OWN = /^(Morrisons|Market Street|Savers)\b/i;

const pairs = [], skipped = [];
for (const l of lidl) {
  const term = plainTerm(l.name);
  if (BAD_MATCH.some((re) => re.test(l.name))) { skipped.push({ name: l.name, why: 'checked: not the same product' }); continue; }
  // A "regular price" far above the app price is usually a misread (e.g. a per-kg figure).
  if (l.regular > l.plus * 1.6) { skipped.push({ name: l.name, why: 'Lidl regular price unclear' }); continue; }
  const lsize = packSize({ ...l, price: l.regular });
  const lu = perUnit({ ...l, price: l.regular, unitPrice: l.unitPrice && l.regular !== l.plus ? null : l.unitPrice });
  const qty = lsize?.loose ? { qty: 1, u: 'kg' } : lsize;
  if (!qty || !qty.qty) { skipped.push({ name: l.name, why: 'Lidl pack size unknown' }); continue; }
  const pool = (morrisonsBy[term] || []).filter((m) => relevant(term, m.name) && m.price > 0);
  const cands = pool
    .map((m) => ({ m, size: packSize(m) }))
    .filter(({ m, size }) => size && size.u === qty.u)
    // Like for like: organic, free range and premium ranges only match their own kind.
    .filter(({ m }) => flag(/organic/i, m.name) === flag(/organic/i, l.name))
    .filter(({ m }) => flag(/free.?range/i, m.name) === flag(/free.?range/i, l.name))
    .filter(({ m }) => (tierOf(m.name) === 'premium') === (lidlTier(l.name) === 'premium'))
    .map((c) => ({ ...c, per: c.m.price / c.size.qty, ratio: c.size.qty / qty.qty }));
  if (!cands.length) { skipped.push({ name: l.name, term, why: pool.length ? 'no like-for-like size/type' : 'no Morrisons match' }); continue; }
  // Prefer a similar pack size (half to double); cheapest per unit among those.
  const near = cands.filter((c) => c.ratio >= 0.5 && c.ratio <= 2);
  const pickFrom = (list) => list.reduce((a, b) => (b.per < a.per ? b : a));
  const best = pickFrom(near.length ? near : cands);
  const std = cands.filter((c) => tierOf(c.m.name) !== 'value');
  const bestStd = std.length ? pickFrom(std.filter((c) => c.ratio >= 0.5 && c.ratio <= 2).length ? std.filter((c) => c.ratio >= 0.5 && c.ratio <= 2) : std) : null;
  const same = (c) => +(c.per * qty.qty).toFixed(2); // Morrisons cost for the Lidl pack's amount
  pairs.push({
    section: l.category?.[0] || '?', from: l.from, term,
    lidl: { name: l.name, regular: l.regular, plus: l.plus, qty },
    morrisons: { name: best.m.name, price: best.m.price, ratio: +best.ratio.toFixed(2), tier: tierOf(best.m.name), offer: best.m.offer || null },
    mSame: same(best),
    mStd: bestStd ? same(bestStd) : null, mStdName: bestStd?.m.name || null,
    ownBrand: OWN.test(best.m.name) && !/^[A-Z]{3,}/.test(l.name.replace(/^(XXL|PARTY)\s/, '')) ? 'both' : OWN.test(best.m.name) ? 'morrisons-own' : 'morrisons-branded',
    sizeNear: !!near.length,
  });
}

// One row per Lidl product name.
const uniq = [...new Map(pairs.map((p) => [p.lidl.name.toLowerCase(), p])).values()];
const sum = (rows, f) => rows.reduce((a, r) => a + f(r), 0);
const report = (rows, label, lf = (r) => r.lidl.regular, mf = (r) => r.mSame) => {
  const L = sum(rows, lf), M = sum(rows, mf);
  const diffs = rows.map((r) => (mf(r) - lf(r)) / mf(r)).sort((a, b) => a - b);
  const med = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0;
  return { label, n: rows.length, lidl: +L.toFixed(2), morrisons: +M.toFixed(2), diff: +(M - L).toFixed(2), pct: +((100 * (M - L)) / M).toFixed(1), medianItemPct: +(100 * med).toFixed(1),
    lidlCheaper: rows.filter((r) => lf(r) < mf(r) * 0.98).length, morrisonsCheaper: rows.filter((r) => mf(r) < lf(r) * 0.98).length };
};
const near = uniq.filter((r) => r.sizeNear);
const std = near.filter((r) => r.mStd != null);
const sections = Object.entries(Object.groupBy(near, (r) => r.section)).map(([s, rows]) => report(rows, s)).sort((a, b) => b.n - a.n);
const out = {
  createdAt: new Date().toISOString(),
  lidlProducts: lidl.length, paired: uniq.length, skipped: skipped.length,
  headline: report(near, 'Similar pack sizes, cheapest Morrisons equivalent (incl. Savers), Lidl regular prices'),
  standardOnly: report(std, 'Same, but Morrisons Savers excluded', (r) => r.lidl.regular, (r) => r.mStd),
  ownBrandOnly: report(near.filter((r) => r.ownBrand !== 'morrisons-branded'), 'Only where the Morrisons match is Morrisons own-label'),
  withLidlPlus: report(near, 'Same as headline, Lidl Plus app prices', (r) => r.lidl.plus),
  allSizes: report(uniq, 'Including pairs where pack sizes differ a lot'),
  sections,
  rows: uniq.sort((a, b) => (b.mSame - b.lidl.regular) / b.mSame - (a.mSame - a.lidl.regular) / a.mSame),
  skippedReasons: Object.fromEntries(Object.entries(Object.groupBy(skipped, (s) => s.why)).map(([k, v]) => [k, v.length])),
};
writeFileSync('analysis/lidl-vs-morrisons.json', JSON.stringify(out, null, 1));
for (const k of ['headline', 'standardOnly', 'ownBrandOnly', 'withLidlPlus', 'allSizes']) console.log(JSON.stringify(out[k]));
console.log('sections', JSON.stringify(sections));
console.log('skipped', JSON.stringify(out.skippedReasons), 'of', lidl.length);
