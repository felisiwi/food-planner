// Lidl UK: there is no online grocery shop, so the site only lists part of the
// range (mostly specials and seasonal items, few basics). The product data is
// embedded in the page as Nuxt's serialised state (<script id="__NUXT_DATA__">),
// a flat array where objects refer to other entries by index.
//
// Search results include loosely related items ("milk" → milk frother), so a
// result only counts if it's food and every word of the search term is in its name.
// Anything not found online comes from prices/lidl.csv or prices added on the page.

import { relevant } from './match.mjs';

export const id = 'lidl';
export const label = 'Lidl';
export const searchUrl = (term) => `https://www.lidl.co.uk/q/search?q=${encodeURIComponent(term)}`;

const WRAPPERS = /^(ShallowReactive|Reactive|Ref|ShallowRef|EmptyRef|EmptyShallowRef)$/;

function nuxtProducts(html) {
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No product data in page (layout may have changed)');
  const arr = JSON.parse(m[1]);
  const memo = new Map();
  const resolve = (i, depth = 0) => {
    if (depth > 60) return null;
    if (memo.has(i)) return memo.get(i);
    const v = arr[i];
    let out;
    if (Array.isArray(v)) {
      out = typeof v[0] === 'string' && WRAPPERS.test(v[0]) ? resolve(v[1], depth + 1) : v.map((x) => (typeof x === 'number' ? resolve(x, depth + 1) : x));
    } else if (v && typeof v === 'object') {
      out = {};
      memo.set(i, out);
      for (const [k, x] of Object.entries(v)) out[k] = typeof x === 'number' ? resolve(x, depth + 1) : x;
    } else out = v;
    memo.set(i, out);
    return out;
  };
  const seen = new Set();
  const products = [];
  arr.forEach((v, i) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'fullTitle' in v && 'itemId' in v) {
      const p = resolve(i);
      if (p && !seen.has(p.itemId)) {
        seen.add(p.itemId);
        products.push(p);
      }
    }
  });
  return products;
}

function toProduct(p) {
  const lp = (p.lidlPlus || [])[0]?.price;
  const base = p.price || {};
  const price = Number(lp?.price ?? base.price);
  const regular = (lp?.basePrice?.text || '').match(/Regular price £(\d+\.\d{2})/)?.[1];
  const sizeText = lp?.packaging?.text || base.packaging?.text || p.keyfacts?.supplementalDescription || '';
  const unit = (lp?.packaging?.text || base.basePrice?.text || '').match(/£(\d+\.\d{2})\/(kg|l|100 ?g|100 ?ml|each)/i);
  const badges = (p.stockAvailability?.badgeInfo?.badges || []).map((b) => b.text);
  const cat = p.keyfacts?.wonCategoryPrimary || '';
  return {
    name: [p.fullTitle, sizeText.split('|')[0].trim()].filter(Boolean).join(' '),
    price,
    regularPrice: regular ? Number(regular) : null,
    offer: lp ? `Lidl Plus price${regular ? ` (regular £${regular})` : ''}` : null,
    unitPrice: unit ? Number(unit[1]) : null,
    unitLabel: unit ? `per ${unit[2].toLowerCase()}` : '',
    available: badges.some((t) => /available in store now/i.test(t)),
    inStore: badges.some((t) => /available in store now/i.test(t)),
    stockNote: badges.join(' · ') || null,
    image: p.image || p.imageList?.[0] || null,
    category: cat.split('/').slice(2, 4),
    isFood: p.category === 'Food' || /food/i.test(cat),
    source: 'online',
  };
}

// Lidl's online range leans on seasonal sweets, so "milk" turns up "Milk Reindeers".
// Skip sweets and snacks unless the list item is itself one.
const TREATS = /candy|snack|chocolate|sweet|biscuit|cookie|pastr/i;
const wantsTreat = (term) => /chocolate|sweet|snack|biscuit|cookie|crisp|candy|cake|wafer/i.test(term);

// Returns every relevant food product with a price (callers pick the cheapest).
export function extract(html, n = 10, term = '') {
  return nuxtProducts(html)
    .map(toProduct)
    .filter((p) => p.isFood && p.price > 0)
    .filter((p) => !term || ((wantsTreat(term) || !TREATS.test(p.category.join(' '))) && relevant(term, p.name)))
    .slice(0, n);
}
