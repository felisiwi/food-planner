// Price data embedded at build time, and matching a shopping item to products.
import { rank, relevant } from '../../lib/match.mjs';
import { match as lidlMatch } from '../../lib/lidl.mjs';

export const DATA = window.__FP_DATA__ || { morrisons: {}, lidl: [], receipts: [], updatedAt: Date.now(), example: [] };

// Every Morrisons product we've seen, for items with no search of their own yet.
const allMorrisons = (() => {
  const seen = new Map();
  for (const list of Object.values(DATA.morrisons || {})) for (const p of list) if (!seen.has(p.name)) seen.set(p.name, p);
  return [...seen.values()];
})();

export function morrisonsFor(term) {
  const own = DATA.morrisons?.[term.toLowerCase()];
  if (own?.length) return rank(term, own).filter((p) => p.match);
  return rank(term, allMorrisons.filter((p) => relevant(term, p.name)));
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

export function lidlFor(term) {
  return rank(term, [...fromReceipts(term), ...lidlMatch(DATA.lidl || [], term, 12)]);
}

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
export function orderOptions(opts, mode) {
  const mine = opts.filter((o) => o.source === 'you');
  const rest = opts.filter((o) => o.source !== 'you');
  if (mode === 'unit') {
    const counts = {};
    for (const o of rest) { const u = perUnit(o)?.u; if (u) counts[u] = (counts[u] || 0) + 1; }
    // Prefer weight or volume over "each" so shops compare like for like.
    const main = ['kg', 'l'].filter((u) => counts[u]).sort((a, b) => counts[b] - counts[a])[0] || (counts.each ? 'each' : null);
    rest.sort((a, b) => {
      const ua = perUnit(a), ub = perUnit(b);
      const ka = ua && ua.u === main ? 0 : 1, kb = ub && ub.u === main ? 0 : 1;
      return (a.match === false) - (b.match === false) || ka - kb || (ka === 0 ? ua.v - ub.v : a.price - b.price);
    });
  } else rest.sort((a, b) => (a.match === false) - (b.match === false) || a.price - b.price);
  return [...mine, ...rest];
}
