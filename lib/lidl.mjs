// Lidl UK: there is no online grocery shop, so the site only lists part of the
// range (weekly offers, specials, some staples). Search results also include
// loosely related items ("milk" → milk frother), so we only accept a result
// when every word of the search term appears in the product name and it is food.
// Anything not found online is filled from prices/lidl.csv or entered on the page.

export const id = 'lidl';
export const label = 'Lidl';
export const searchUrl = (term) => `https://www.lidl.co.uk/q/search?q=${encodeURIComponent(term)}`;

const STOP = new Set(['x', 'and', 'with', 'of', 'the', 'a', 'in', 'lidl', 'g', 'kg', 'ml', 'l', 'pack']);
const norm = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(ies)$/, 'y').replace(/(es|s)$/, '');
const words = (s) => s.split(/\s+/).map(norm).filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w));

export function relevant(term, product) {
  const want = words(term);
  const have = new Set(words(product.name));
  return want.length > 0 && want.every((w) => have.has(w)) && /food/i.test(product.categoryPath || '');
}

const decode = (s) =>
  s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function extract(html, n = 4, term = '') {
  const parts = html.split('data-gridbox-impression="').slice(1);
  const out = [];
  for (const part of parts) {
    const raw = part.slice(0, part.indexOf('"'));
    let j;
    try {
      j = JSON.parse(decodeURIComponent(decode(raw)));
    } catch {
      continue;
    }
    const tile = part.slice(0, 6000);
    const img = tile.match(/src="(https:\/\/imgproxy-retcat\.assets\.schwarz\/[^"]+)"/)?.[1] || null;
    const text = decode(tile.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
    const regular = text.match(/Regular price £(\d+\.\d{2})/)?.[1];
    const lidlPlus = /With Lidl Plus/i.test(text);
    const unit = text.match(/£(\d+\.\d{2})\/(kg|l|100 ?g|100 ?ml)/i);
    const p = {
      name: j.name,
      brand: j.brand,
      categoryPath: j.wonCategoryPrimary || j.category || '',
      category: (j.wonCategoryPrimary || '').split('/').slice(2, 4),
      // The headline price is the Lidl Plus price when there is one.
      price: Number(j.price),
      regularPrice: regular ? Number(regular) : null,
      offer: lidlPlus ? 'Lidl Plus price' : null,
      unitPrice: unit ? Number(unit[1]) : null,
      unitLabel: unit ? `per ${unit[2].toLowerCase()}` : '',
      available: /Available in store/i.test(text),
      image: img,
      source: 'online',
    };
    if (!term || relevant(term, p)) out.push(p);
    if (out.length >= n) break;
  }
  return out;
}
