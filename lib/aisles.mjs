// Aisle lookups for the store map. Pure functions (no phone, no disk), so they can be tested in plain Node.
// The phone side is lib/phone.mjs; the command you type is aisles.mjs.
//
// What gets written: store-map/stamford-hill.json, the same map the Shop list reads. A product the phone
// found gets { zone, side, shelf, note, checked, source }. Entries WITHOUT source "morrisons-more-app"
// (your own hand edits) are never overwritten, even with --refresh.

import { resolvePlace, groupByZone } from './storemap.mjs';

export const SOURCE = 'morrisons-more-app';
export const MAX_AGE_DAYS = 28;

// "Morrisons Chickpeas In Water (400g)" (website) and "Morrisons Chickpeas In Water 400g" (app) compare equal.
export function normName(s) {
  return String(s ?? '').toLowerCase().replace(/&amp;/g, '&').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Does a result row's text ("Morrisons Chickpeas In Water 400g Unbeatable 37p £1.54 per kg") start with this name?
// This only finds CANDIDATES; the pop-up's own title decides (sameProduct), so "Kallo ..." can't pass for another Kallo.
export function rowMatches(label, name) {
  const n = normName(label), a = normName(name);
  return !!a && (n === a || n.startsWith(a + ' '));
}

export const sameProduct = (title, name) => !!normName(name) && normName(title) === normName(name);

// The pop-up's text, in order: title, prices..., location label, description. We trust the first and last two.
export function parseSheet(texts) {
  const t = (texts || []).map((x) => String(x).trim()).filter(Boolean);
  if (t.length < 3) return null;
  const description = t[t.length - 1], location = t[t.length - 2];
  if (!/found|aisle/i.test(description)) return null;
  return { title: t[0], location, description };
}

const slug = (s) => normName(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// "Aisle 12" -> a12 (walkOrder = 12, a labelled guess); anything else ("Fresh Produce Section") -> its own unordered zone.
export function zoneFromLocation(location) {
  const loc = String(location).trim();
  const m = /^aisle\s+(\d+)$/i.exec(loc);
  if (m) return { id: `a${+m[1]}`, label: `Aisle ${+m[1]}`, walkOrder: +m[1], walkOrderSource: 'assumed: numbered aisles in number order' };
  return { id: slug(loc), label: loc, walkOrder: null };
}

export function sideFromDescription(d) {
  if (/right-hand side/i.test(d)) return 'right';
  if (/left-hand side/i.test(d)) return 'left';
  return '';
}

// "near the start of aisle 2" -> 0, "halfway down" -> 0.5, "near the end" -> 1, anything else -> null.
export function posFromDescription(d) {
  if (/near the start/i.test(d)) return 0;
  if (/halfway/i.test(d)) return 0.5;
  if (/near the end/i.test(d)) return 1;
  return null;
}

// Return a NEW map with the product (under every name it goes by) placed. The input map is not changed.
export function applyPlace(map, names, { location, description, checked }) {
  const z = zoneFromLocation(location);
  const zones = map.zones.some((x) => x.id === z.id) ? map.zones : [...map.zones, { ...z, signs: [], categories: [] }];
  const products = { ...map.products };
  for (const n of names) {
    if (products[n] && products[n].source !== SOURCE) continue; // never overwrite a hand-set place
    const pos = posFromDescription(description);
    products[n] = { zone: z.id, side: sideFromDescription(description), shelf: '', note: description, ...(pos == null ? {} : { pos }), checked, source: SOURCE };
  }
  return { ...map, updated: checked, zones, products };
}

const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;

export function isFresh(entry, today, maxAgeDays = MAX_AGE_DAYS) {
  return !!entry?.checked && daysBetween(entry.checked, today) <= maxAgeDays;
}

// items: [{ names: [appName, ...websiteAliases] }]. Split into "already known" and "ask the phone".
//   hand-set entry (not ours)  -> known, always
//   our entry, recent          -> known (unless refresh)
//   our entry, old / none      -> ask the phone
// Write down that the app was searched for this product and it wasn't there, with what it showed instead,
// so the next run doesn't type the same search into the phone again.
export function recordNotFound(map, name, rows, checked) {
  return { ...map, notFound: { ...(map.notFound || {}), [name]: { checked, rows, source: SOURCE } } };
}

// cached = answered already; searched = looked for recently and not there (skipped); todo = needs the phone.
export function planLookups(items, map, today, { refresh = false, maxAgeDays = MAX_AGE_DAYS, retryNotFound = false } = {}) {
  const cached = [], searched = [], todo = [];
  for (const it of items) {
    const entry = it.names.map((n) => map.products[n]).find((e) => e?.zone);
    const miss = it.names.map((n) => map.notFound?.[n]).find((e) => e);
    if (entry && entry.source !== SOURCE) cached.push(it);
    else if (entry && !refresh && isFresh(entry, today, maxAgeDays)) cached.push(it);
    else if (!entry && miss && !refresh && !retryNotFound && isFresh(miss, today, maxAgeDays)) searched.push(it);
    else todo.push(it);
  }
  return { cached, searched, todo };
}

// One product per line: "App name | website alias | another alias". '#' starts a comment.
export function parseAisleList(text) {
  return String(text).split('\n')
    .map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)
    .map((l) => ({ names: l.split('|').map((s) => s.trim()).filter(Boolean) }));
}

// Items grouped into zones in walking order (reuses the store map's own ordering; unplaced group last).
export function walkingOrder(items, map) {
  return groupByZone(items, (it) => resolvePlace(it.names[0], null, {}, map), (it) => it.names[0], map, null);
}
