// Morrisons: groceries.morrisons.com search pages embed the product data as
// JSON in window.__INITIAL_STATE__. Prices are national online prices.

export const id = 'morrisons';
export const label = 'Morrisons';
export const searchUrl = (term) => `https://groceries.morrisons.com/search?q=${encodeURIComponent(term)}`;

// Morrisons files some products under promo sections first; skip those so items
// group by their real food section.
const PROMO = /events|inspiration|ways to save|offers|market street|^new|christmas|halloween|easter|summer|bbq|price lock|top picks/i;
const section = (path) => (path || []).filter((c) => !PROMO.test(c)).slice(0, 2);

export function extract(html, n = 12) {
  const start = html.indexOf('__INITIAL_STATE__=');
  if (start < 0) throw new Error('No product data in page (layout may have changed)');
  const end = html.indexOf('</script>', start);
  const state = JSON.parse(html.slice(start + 18, end).trim().replace(/;$/, ''));
  const groups = state.data?.search?.catalogue?.data?.productGroups || [];
  const ents = state.data?.products?.productEntities || {};
  return groups
    .flatMap((g) => g.products)
    .slice(0, n)
    .map((pid) => ents[pid])
    .filter(Boolean)
    .map((x) => ({
      name: x.name?.replace(/\s+/g, ' ').trim(),
      price: Number(x.price?.current?.amount),
      unitPrice: x.price?.unit?.current?.amount ? Number(x.price.unit.current.amount) : null,
      unitLabel: (x.price?.unit?.label || '').replace('fop.price.per.', 'per '),
      offer: (x.promotions || []).map((p) => p.description || p.name).filter(Boolean).join(' · ') || null,
      available: x.available !== false,
      image: x.image?.src || null,
      category: section(x.categoryPath),
      source: 'online',
    }));
}
