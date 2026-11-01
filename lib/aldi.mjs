// Aldi UK: products from the first page of each food category on aldi.co.uk,
// collected with Claude's web fetcher (Aldi's robots.txt allows it; scripted
// requests are refused). See aldi.mjs at the repo root for how they're gathered.

import { relevant } from './match.mjs';

const TREATS = /chocolate|sweets|crisps|biscuits|cakes|desserts|ice-cream|sweet-treats/;
const wantsTreat = (term) => /chocolate|sweet|crisp|biscuit|cake|dessert|ice cream/i.test(term);

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-&…,.])([a-z])/g, (m, a, c) => a + c.toUpperCase()).replace(/\bUht\b/g, 'UHT');

// Aldi names come as "BRAND Title", sometimes "Title, BRAND" or "Title BRAND Title".
// -> "Cucina Chopped Tomatoes in a Rich Tomato Juice (400g)"
const CAPS = "[A-Z][A-Z0-9 &'.,…!\\-]*[A-Z0-9!…]";
export function displayName(name, size) {
  let n = String(name).trim();
  const dup = n.match(new RegExp(`^(.+?) (${CAPS}) \\1$`));
  if (dup) n = `${dup[2]} ${dup[1]}`;
  const tail = n.match(new RegExp(`^(.*[a-z].*),\\s*(${CAPS})$`));
  if (tail) n = `${tail[2]} ${tail[1]}`;
  const lead = n.match(new RegExp(`^(${CAPS})\\s+(?=[A-Z][a-z]|\\d)`));
  if (lead && lead[1].replace(/[^A-Z]/g, '').length >= 2) n = titleCase(lead[1]) + ' ' + n.slice(lead[0].length);
  const sz = String(size || '').trim()
    .replace(/^(\d+)\s*each$/i, (_, c) => (c === '1' ? '' : `${c} pack`))
    .replace(/\s+(kg|g|ml|cl|l)$/i, (_, u) => u.toLowerCase());
  return sz && !n.toLowerCase().replace(/\s/g, '').includes(sz.toLowerCase().replace(/\s/g, '')) ? `${n} (${sz})` : n;
}

// Pack size in kg or litres, or null.
function sizeQty(size) {
  const m = String(size || '').match(/(?:(\d+)\s*x\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l|ltr|litre)\b/i);
  if (!m) return null;
  const n = Number(m[1] || 1) * Number(m[2].replace(',', '.'));
  const u = m[3].toLowerCase();
  return { qty: u === 'g' || u === 'ml' ? n / 1000 : u === 'cl' ? n / 100 : n, u: /g$/.test(u) ? 'kg' : 'l' };
}

// The unit-price text on Aldi's pages is sometimes labelled "/100 G" when the
// number is really per kg, so the per-kg price is worked out from pack size and
// price wherever the size is known, and the label is only used as a fallback.
export function toProduct(raw) {
  const price = Number(raw.price);
  const q = sizeQty(raw.size);
  let unitPrice = null, unitLabel = '';
  if (q && q.qty > 0 && price > 0) {
    unitPrice = +(price / q.qty).toFixed(2);
    unitLabel = q.u === 'kg' ? 'per kg' : 'per litre';
  } else {
    const m = String(raw.unitText || '').match(/£\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+)?\s*(kg|g|l|ml|each|ea)/i);
    if (m && /each|ea/i.test(m[3])) { unitPrice = Number(m[1]); unitLabel = 'per each'; }
  }
  const was = Number(raw.was) || null;
  return {
    name: displayName(raw.name, raw.size),
    price,
    unitPrice,
    unitLabel,
    offer: was && was > price ? `Was ${'£' + was.toFixed(2)}` : null,
    available: true,
    image: /^https:\/\//.test(raw.image || '') ? raw.image : null,
    url: /^https:\/\/www\.aldi\.co\.uk\//.test(raw.url || '') ? raw.url : null,
    category: [raw.category],
    term: raw.term || null,
    source: 'online',
  };
}

export function match(products, term, n = 12) {
  return products
    .filter((p) => p.price > 0)
    .filter((p) => (wantsTreat(term) || !TREATS.test(p.category.join(' '))) && relevant(term, p.name))
    .slice(0, n);
}
