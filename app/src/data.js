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
    .map((r) => ({ name: r.name + (r.perKg ? ' (per kg)' : ''), price: r.price, date: r.date, source: 'receipt', match: r.match, category: [] }));
}

export function lidlFor(term) {
  return rank(term, [...fromReceipts(term), ...lidlMatch(DATA.lidl || [], term, 12)]);
}

export const gbp = (n) => '£' + Number(n).toFixed(2);
