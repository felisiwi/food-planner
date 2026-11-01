// Matching a list item ("vegetable stock cubes") to shop products.

const STOP = new Set(['x', 'and', 'with', 'of', 'the', 'a', 'in', 'g', 'kg', 'ml', 'l', 'pack', 'morrisons', 'lidl']);
const norm = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/ies$/, 'y').replace(/(oes|es|s)$/, (m) => (m === 'oes' ? 'o' : ''));
const words = (s) => String(s || '').split(/[\s\-/,()&]+/).map(norm).filter((w) => w && !STOP.has(w) && !/^\d/.test(w));

// Words that turn an ingredient into a different product ("celery" vs "celery salt").
// A product with one of these only matches if the list item asks for it too.
const FORMS = new Set(
  ['salt', 'granule', 'powder', 'seasoning', 'paste', 'sauce', 'soup', 'crisp', 'flavour', 'flavoured', 'spread', 'oil',
    'cake', 'juice', 'dip', 'pesto', 'ketchup', 'mix', 'snack', 'bar', 'drink', 'smoothie', 'pie', 'pizza', 'ready', 'meal',
    'sandwich', 'wrap', 'chip', 'houmous', 'bake', 'biscuit', 'chocolate', 'sweet',
    'naan', 'bread', 'burger', 'roll', 'kiev', 'nugget', 'sausage', 'pasty', 'quiche', 'tart', 'muffin', 'cookie', 'croissant', 'pudding'].flatMap((w) => [norm(w), norm(w + 's')]),
);

// Different products that contain an item's name ("butter" vs "peanut butter").
const COMPOUNDS = {
  butter: ['peanut butter', 'almond butter', 'cashew butter', 'nut butter', 'cocoa butter', 'butter bean', 'butterbean', 'buttermilk', 'butternut', 'butter chicken'],
  milk: ['coconut milk', 'oat milk', 'almond milk', 'soya milk', 'milk chocolate', 'buttermilk'],
  cream: ['ice cream', 'cream cheese', 'cream of', 'salad cream', 'cream cracker'],
  rice: ['rice cake', 'rice noodle', 'rice pudding', 'rice vinegar'],
  cheese: ['cream cheese', 'cheese sauce', 'cheese and onion', 'cheese & onion'],
  tomato: ['tomato soup', 'tomato ketchup'],
};

// The part of a name before "in ..." or "with ...": "Anchovies in Olive Oil" is
// anchovies, and "Chopped Tomatoes in Tomato Juice" isn't juice.
const head = (name) => String(name || '').split(/\s+(?:in|with)\s+/i)[0];

// A product is a real match when every word of the item appears in its name
// (before any "in ..."/"with ..."), it isn't a different form of it, and it
// isn't a different product that happens to contain the word.
export function relevant(term, name) {
  const want = words(term);
  const t = String(term).toLowerCase();
  const asksInWith = /\b(in|with)\b/.test(t);
  const main = asksInWith ? String(name) : head(name);
  const have = words(main);
  const haveSet = new Set(have);
  if (!want.length || !want.every((w) => haveSet.has(w))) return false;
  const wantSet = new Set(want);
  if (have.some((w) => FORMS.has(w) && !wantSet.has(w))) return false;
  const low = String(name).toLowerCase();
  const has = (str, c) => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(str);
  for (const w of want) for (const c of COMPOUNDS[w] || []) if (has(low, c) && !has(t, c)) return false;
  return true;
}

// Order a shop's candidates for an item: real matches cheapest first (anything a
// shop says isn't in store yet goes after), then whatever else the search returned.
// Morrisons' online stock flag is about delivery, not the shelf, so it doesn't demote.
export function rank(term, products) {
  const score = (p) => (relevant(term, p.name) ? (p.inStore !== false ? 0 : 1) : 2);
  return [...products]
    .map((p, i) => ({ p, i, s: score(p) }))
    .sort((a, b) => a.s - b.s || (a.s < 2 ? a.p.price - b.p.price : a.i - b.i))
    .map(({ p, s }) => ({ ...p, match: s < 2 }));
}
