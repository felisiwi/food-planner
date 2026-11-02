// Price data embedded at build time, and matching a shopping item to products.
import { rank, relevant } from '../../lib/match.mjs';
import { match as lidlMatch } from '../../lib/lidl.mjs';
import { match as aldiMatch } from '../../lib/aldi.mjs';

export const DATA = window.__FP_DATA__ || { morrisons: {}, lidl: [], aldi: [], receipts: [], updatedAt: Date.now(), example: [] };

// The website loads its data after this module has run, so DATA is filled in place.
export function setData(d) {
  Object.assign(DATA, d);
  everyMorrisons = null;
}

// Every Morrisons product we've seen, for items with no search of their own yet.
let everyMorrisons = null;
function allMorrisons() {
  if (everyMorrisons) return everyMorrisons;
  const seen = new Map();
  for (const list of Object.values(DATA.morrisons || {})) for (const p of list) if (!seen.has(p.name)) seen.set(p.name, p);
  return (everyMorrisons = [...seen.values()]);
}

export function morrisonsFor(term) {
  const own = DATA.morrisons?.[term.toLowerCase()];
  if (own?.length) return rank(term, own).filter((p) => p.match);
  return rank(term, allMorrisons().filter((p) => relevant(term, p.name)));
}

const stem = (w) => w.toLowerCase().replace(/[^a-z]/g, '');
function fromReceipts(term) {
  const words = term.split(/\s+/).map(stem).filter((w) => w.length >= 3);
  return (DATA.receipts || [])
    .map((r) => {
      if (relevant(term, r.name)) return { ...r, match: true };
      const have = r.name.split(/\s+/).map(stem);
      const loose = words.length && words.every((w) => have.some((h) => h.length >= 3 && (w.startsWith(h) || h.startsWith(w))));
      return loose ? { ...r, match: false } : null;
    })
    .filter(Boolean)
    .map((r) => ({ name: r.name + (r.perKg ? ' (per kg)' : ''), price: r.price, date: r.date, source: 'receipt', match: r.match, category: [],
      unitPrice: r.perKg ? r.price : null, unitLabel: r.perKg ? 'per kg' : '' }));
}

// "plant revolution meat free mince" is a Morrisons brand; at other shops look
// for "meat free mince" instead, and label what comes back as a similar product.
function orSimilar(term, find) {
  const found = find(term);
  if (found.length) return found;
  const w = term.split(/\s+/);
  // Only drop two or more leading words (a brand name), never a single describing
  // word: "vegetable stock cubes" must not become chicken stock cubes.
  for (let n = Math.min(3, w.length - 2); n >= 2; n--) {
    const shorter = w.slice(-n).join(' ');
    const alt = find(shorter);
    if (alt.length) return alt.map((p) => ({ ...p, similar: shorter }));
  }
  return [];
}

export function lidlFor(term) {
  return orSimilar(term, (t) => rank(t, [...fromReceipts(t), ...lidlMatch(DATA.lidl || [], t, 12)]));
}

export function aldiFor(term) {
  // Products looked up for this exact item come first; if the name doesn't
  // obviously match (e.g. "tinned fish" -> tuna), they're labelled as similar.
  const looked = (DATA.aldi || []).filter((p) => p.term === term).map((p) => (relevant(term, p.name) ? p : { ...p, similar: 'looked up for this item' }));
  const found = orSimilar(term, (t) => rank(t, aldiMatch(DATA.aldi || [], t, 12)));
  const seen = new Set(looked.map((p) => p.name));
  return [...rank(term, looked).map((p) => ({ ...p, match: true })), ...found.filter((p) => !seen.has(p.name))];
}

// Items Aldi's site lists but shows no price for right now ("currently not available").
export const aldiNoPrice = (term) => DATA.aldiNoPrice?.[term] || null;

export const gbp = (n) => '£' + Number(n).toFixed(2);

// Price per kg, per litre or each, whichever the shop gives, in comparable units.
export function perUnit(p) {
  if (!p) return null;
  if (!p.unitPrice || !p.unitLabel) {
    // No unit price given: work it out from a pack size in the name ("1kg", "500 g", "2 x 400g").
    const m = String(p.name).match(/(?:(\d+)\s*x\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|ltr|litre)\b/i);
    if (!m || !p.price) return null;
    const n = Number(m[1] || 1) * Number(m[2].replace(',', '.'));
    const qty = /^(g|ml)$/i.test(m[3]) ? n / 1000 : n;
    return qty > 0 ? { v: p.price / qty, u: /^(kg|g)$/i.test(m[3]) ? 'kg' : 'l', derived: true } : null;
  }
  const l = String(p.unitLabel).toLowerCase().replace(/\s/g, '');
  if (/per100g/.test(l)) return { v: p.unitPrice * 10, u: 'kg' };
  if (/per100ml/.test(l)) return { v: p.unitPrice * 10, u: 'l' };
  if (/perkg/.test(l)) return { v: p.unitPrice, u: 'kg' };
  if (/per(l|litre|ltr)$/.test(l)) return { v: p.unitPrice, u: 'l' };
  if (/pereach|perunit|peritem/.test(l)) return { v: p.unitPrice, u: 'each' };
  return null;
}
export const unitText = (u) => (u ? `${gbp(u.v)}/${u.u}` : '');

// Order a shop's options: by price per kg/l when that's the mode and the
// option has one (others after), otherwise by pack price. "Added by you" stays first.
// `prefer` ('kg' | 'l' | 'each') says which unit to rank by when the amount needed is known.
export function orderOptions(opts, mode, prefer) {
  const mine = opts.filter((o) => o.source === 'you');
  const rest = opts.filter((o) => o.source !== 'you');
  if (mode === 'unit') {
    const counts = {};
    for (const o of rest) { const u = perUnit(o)?.u; if (u) counts[u] = (counts[u] || 0) + 1; }
    // Prefer weight or volume over "each" so shops compare like for like.
    const main = (prefer && counts[prefer] ? prefer : null) || ['kg', 'l'].filter((u) => counts[u]).sort((a, b) => counts[b] - counts[a])[0] || (counts.each ? 'each' : null);
    rest.sort((a, b) => {
      const ua = perUnit(a), ub = perUnit(b);
      const ka = ua && ua.u === main ? 0 : 1, kb = ub && ub.u === main ? 0 : 1;
      return (a.match === false) - (b.match === false) || ka - kb || (ka === 0 ? ua.v - ub.v : a.price - b.price);
    });
  } else rest.sort((a, b) => (a.match === false) - (b.match === false) || a.price - b.price);
  return [...mine, ...rest];
}

// ---------------------------------------------------------------------------
// Pack sizes, amount needed, and picking a pack that fits.
// Sizes are always in kg, l or "each" so a pack can be compared with what a recipe needs.
// ---------------------------------------------------------------------------

// "500g", "1.5kg", "2 x 400g", "4x115g", "75cl". The leading lookbehind stops "1.5kg" matching as "5kg".
const SIZE = /(?<![\d.,])(?:(\d+)\s*x\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l|ltr|litres?)\b/i;
const FACTOR = { kg: ['kg', 1], g: ['kg', 0.001], ml: ['l', 0.001], cl: ['l', 0.01], l: ['l', 1], ltr: ['l', 1], litre: ['l', 1], litres: ['l', 1] };

// "6 pack", "pack of 6", "12's", "24s", "Each". Only used when the name gives no weight or volume.
function nameCount(name) {
  const n = String(name);
  const m = n.match(/(?<![\d.])(\d+)\s*(?:pack|pk|pcs|pieces)\b/i) || n.match(/\bpack of (\d+)\b/i) || n.match(/(?<![\d.])(\d+)\s*'?s\b/i);
  if (m) return Number(m[1]);
  return /\beach\b/i.test(n) ? 1 : null;
}

// Size of one pack as { qty, u: 'kg' | 'l' | 'each', from }, or null when we can't tell.
// Order of trust: weight/volume written in the name, then price / unit price, then a count in the name.
// (The name wins because shops sometimes list a drained weight or a wrong unit price.)
// Loose-by-weight items from receipts come back with loose: true: you buy whatever amount you need.
export function packSize(p) {
  if (!p) return null;
  const lab = p.unitPrice && p.unitLabel ? perUnit(p) : null;
  if (p.source === 'receipt' && lab?.u === 'kg' && Math.abs(p.price - lab.v) < 0.005) return { qty: 1, u: 'kg', from: 'loose', loose: true };

  const m = String(p.name).match(SIZE);
  if (m) {
    const [u, f] = FACTOR[m[3].toLowerCase()];
    const qty = Number(m[1] || 1) * Number(m[2].replace(',', '.')) * f;
    return qty > 0 ? { qty: +qty.toFixed(4), u, from: 'name' } : null;
  }
  if (lab && lab.u !== 'each' && p.price > 0) {
    const qty = p.price / lab.v;
    return qty > 0 && qty <= 50 ? { qty: +qty.toFixed(4), u: lab.u, from: 'unit price' } : null;
  }
  const count = nameCount(p.name);
  if (count) return { qty: count, u: 'each', from: 'name' };
  if (lab?.u === 'each' && p.price > 0) {
    const qty = p.price / lab.v;
    return qty >= 0.9 && Math.abs(qty - Math.round(qty)) < 0.15 ? { qty: Math.round(qty), u: 'each', from: 'unit price' } : null;
  }
  return null;
}

export function sizeText(s) {
  if (!s) return '';
  const r = (x) => +x.toFixed(2);
  if (s.u === 'kg') return Math.round(s.qty * 1000) < 1000 ? `${Math.round(s.qty * 1000)}g` : `${r(s.qty)}kg`;
  if (s.u === 'l') return Math.round(s.qty * 1000) < 1000 ? `${Math.round(s.qty * 1000)}ml` : `${r(s.qty)}l`;
  return s.qty === 1 ? '1 each' : `${r(s.qty)} pack`;
}

// What an ingredient line needs, in the same units: { qty, u } or null when unknown.
// A tin is assumed to be 400g (or 400ml, hence `alt`). tsp/tbsp return null: see probablyHave().
export const TIN_KG = 0.4;
export function needAmount(it) {
  const a = Number(it?.amount);
  if (!a || a <= 0) return null;
  switch (it.unit) {
    case 'g': return { qty: a / 1000, u: 'kg' };
    case 'kg': return { qty: a, u: 'kg' };
    case 'ml': return { qty: a / 1000, u: 'l' };
    case 'l': return { qty: a, u: 'l' };
    case 'tin': return { qty: a * TIN_KG, u: 'kg', alt: 'l' };
    case 'item': case 'pack': case 'bunch': return { qty: a, u: 'each' };
    default: return null;
  }
}
export const probablyHave = (it) => it?.unit === 'tsp' || it?.unit === 'tbsp';
const same = (need, s) => !!need && !!s && (s.u === need.u || s.u === need.alt);

// A pack (or 2-3 packs) is "similar" when it is 0.85x to 2x the amount needed: never much less than the recipe
// needs (a 1-pint bottle is not a litre), and up to twice as much. The brief said 0.5x for the floor; real data
// (whole milk, 1l: the 567ml bottle is cheapest and inside 0.5x) showed that under-buys.
const WINDOW = [0.85, 2];
const MAX_PACKS = 3; // buy up to 3 small packs rather than one big one
const EPS = 1e-9;

// Cheapest way to buy roughly the amount needed, as { opt, count }.
function similarPick(pool, need, fallbackCount) {
  const cheapest = () => ({ opt: [...pool].sort((a, b) => a.price - b.price)[0], count: fallbackCount });
  if (!need) return cheapest();
  const cands = [];
  for (const opt of pool) {
    const s = packSize(opt);
    if (!same(need, s)) continue;
    if (s.loose) { cands.push({ opt, count: 1, ratio: 1, cost: opt.price * (need.u === 'kg' ? need.qty : 1) }); continue; }
    for (let count = 1; count <= MAX_PACKS; count++) cands.push({ opt, count, ratio: (count * s.qty) / need.qty, cost: opt.price * count });
  }
  if (!cands.length) return cheapest(); // sizes unknown: fall back to the cheapest pack
  const dist = (c) => Math.abs(Math.log(c.ratio));
  const inside = cands.filter((c) => c.ratio >= WINDOW[0] - EPS && c.ratio <= WINDOW[1] + EPS);
  // Nothing in the window (e.g. only huge packs exist): take whatever is closest to the amount needed.
  return inside.length
    ? inside.sort((a, b) => Math.round(a.cost * 100) - Math.round(b.cost * 100) || a.count - b.count || dist(a) - dist(b))[0]
    : cands.sort((a, b) => dist(a) - dist(b) || a.cost - b.cost)[0];
}

// A saved pick is { mode: 'similar' | 'unit' | 'pack' } or { mode: 'manual', name }.
// Old saves were a number: the position in the list (ordered by pack price, or by price per kg
// if "pick by price per kg" was on). Position 0 was the default, so it means "no choice made".
export function normalisePick(pick, opts, legacyUnit) {
  if (typeof pick === 'number') {
    if (pick <= 0 || !opts.length) return { mode: 'similar' };
    return { mode: 'manual', name: orderOptions(opts, legacyUnit ? 'unit' : 'pack')[pick % opts.length]?.name };
  }
  return pick && pick.mode ? pick : { mode: 'similar' };
}

// Choose a pack for one ingredient at one shop and describe it:
// { opt, count, mode, total, cost, ratio, big, alt, need, order }
// `big` means the packs bought are more than 2x what's needed; `alt` is the similar-size pack to suggest instead.
export function choosePack(allOpts, it, pick, legacyUnit = false) {
  const seen = new Set(); // the data lists some products twice; a pick is saved by name, so keep one of each
  const opts = allOpts.filter((o) => !seen.has(o.name) && seen.add(o.name));
  if (!opts.length) return null;
  const need = needAmount(it);
  const fallbackCount = ['tin', 'pack'].includes(it.unit) && it.amount > 1 ? Math.round(it.amount) : 1;
  const real = opts.filter((o) => o.match !== false);
  const pool = real.length ? real : opts;
  const mine = opts.find((o) => o.source === 'you');
  const p = normalisePick(pick, opts, legacyUnit);

  // How many of a pack to buy to cover the need (a little slack, at most 6).
  const cover = (o) => {
    const s = packSize(o);
    if (!same(need, s)) return fallbackCount;
    return s.loose ? 1 : Math.min(6, Math.max(1, Math.ceil(need.qty / s.qty - (1 - WINDOW[0]))));
  };
  const describe = (opt, count) => {
    const s = packSize(opt);
    const loose = !!s?.loose;
    const total = !s ? null : loose && need ? { qty: need.qty, u: need.u } : { qty: s.qty * count, u: s.u };
    const cost = loose && need?.u === 'kg' ? opt.price * need.qty : opt.price * count;
    const ratio = total && same(need, total) ? total.qty / need.qty : null;
    return { opt, count, size: s, total, cost, ratio, big: !loose && ratio != null && ratio > WINDOW[1] + EPS };
  };

  let mode = p.mode;
  let found = mode === 'manual' ? opts.find((o) => o.name === p.name) : null;
  if (mode === 'manual' && !found) mode = 'similar'; // that product is no longer in the data
  let pickd;
  if (found) pickd = { opt: found, count: cover(found) };
  else if (mine) pickd = { opt: mine, count: fallbackCount }; // a price you typed in beats everything
  else if (mode === 'unit') { const o = orderOptions(pool, 'unit', need?.u)[0]; pickd = { opt: o, count: cover(o) }; }
  else if (mode === 'pack') { const o = [...pool].sort((a, b) => a.price - b.price)[0]; pickd = { opt: o, count: cover(o) }; }
  else pickd = similarPick(pool, need, fallbackCount);

  const out = describe(pickd.opt, pickd.count);
  let alt = null;
  if (out.big) {
    const sp = similarPick(pool, need, fallbackCount);
    const a = describe(sp.opt, sp.count);
    if (a.ratio != null && a.ratio < out.ratio - 0.01) alt = a;
  }
  return { ...out, mode, alt, need, order: orderOptions(opts, 'pack') };
}


// ---- What a meal costs per portion ----

// How much of an item one meal uses, in the item's own unit.
export function shareFor(it, dish, dishCount) {
  const a = Number(it.amount) || 0;
  if (!a) return 0;
  const name = dish.toLowerCase();
  if (it.perMeal && it.perMeal[name] > 0) return it.perMeal[name];
  const meals = (it.meals || []).map((m) => m.toLowerCase());
  if (!meals.length) return dishCount === 1 ? a : 0;
  if (!meals.includes(name)) return dishCount === 1 ? a : 0;
  return a / meals.length;
}

const SPOON = { tsp: 0.005, tbsp: 0.015 }; // kg or litres, near enough for oil, spices and purée

// The cost of the amount a meal actually uses (not the whole pack), from the
// option's price per kg/litre/each. Falls back to the packs' price when the
// units can't be lined up. Returns { cost, approx } or null.
export function usedCost(opt, sel, it, qty) {
  if (!opt || !(qty > 0)) return null;
  const u = perUnit(opt);
  const spoon = SPOON[it.unit];
  const need = spoon ? { qty: qty * spoon, u: u?.u === 'l' ? 'l' : 'kg' } : needAmount({ ...it, amount: qty });
  if (u && need && (u.u === need.u || u.u === need.alt)) return { cost: u.v * need.qty, approx: false };
  // Same unit via the pack size: share of the pack(s).
  const size = sel?.size || packSize(opt);
  if (size && need && size.u === need.u && size.qty > 0) return { cost: (opt.price * need.qty) / size.qty, approx: false };
  return sel ? { cost: sel.cost * Math.min(1, qty / (Number(it.amount) || qty)), approx: true } : null;
}

// Meal names and servings for a plan. Newer plans say so; older ones are read
// from the item lists and "for 8" in the text you typed.
export function dishesFor(plan, items) {
  if (plan?.dishes?.length) return plan.dishes;
  const names = [...new Set(items.flatMap((i) => (i.meals || []).map((m) => m.toLowerCase())))];
  const text = String(plan?.meals || '').toLowerCase();
  const servingsIn = (name) => {
    const near = text.match(new RegExp(name.split(/\s+/).pop().replace(/[^a-z]/g, '') + '[^,\\n]*?\\bfor\\s+(\\d+)'));
    return near ? Number(near[1]) : null;
  };
  if (!names.length) return text ? [{ name: 'your meals', servings: Number(text.match(/\bfor\s+(\d+)/)?.[1]) || null }] : [];
  return names.map((name) => ({ name, servings: servingsIn(name) || (names.length === 1 ? Number(text.match(/\bfor\s+(\d+)/)?.[1]) || null : null) }));
}


// The same pick with a different number of packs (the − / + control in the shop list).
export function withCount(sel, n) {
  if (!sel || n == null || n === sel.count || sel.size?.loose) return sel;
  const count = Math.max(0, Math.round(n));
  const total = sel.size ? { qty: sel.size.qty * count, u: sel.size.u } : null;
  const ratio = total && sel.need && total.u === sel.need.u && sel.need.qty > 0 ? total.qty / sel.need.qty : null;
  return { ...sel, count, total, cost: sel.opt.price * count, ratio, big: ratio != null && ratio > 2.0001, alt: null, manual: true };
}
