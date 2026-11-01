// Builds the Food Planner phone app (app/, React + Base UI) into one HTML file
// with the latest price data embedded: app.html, plus app.artifact.html for
// publishing as a claude.ai page.
//
// Usage: node build-app.mjs   (runs the Vite build if app/dist is missing or --vite is passed)

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parseList } from './lib/list.mjs';
import { fixUnit } from './lib/morrisons.mjs';
import { toProduct as aldiProduct } from './lib/aldi.mjs';

const read = async (f, fallback) => (existsSync(f) ? JSON.parse(await readFile(f, 'utf8')) : fallback);

if (process.argv.includes('--vite') || !existsSync('app/dist/index.html')) {
  execSync('npm run build', { cwd: 'app', stdio: 'inherit' });
}

const results = await read('data/results.json', {});
const compare = await read('data/compare-morrisons.json', {});
const receipts = await read('data/lidl-receipt-prices.json', { items: {} });

// Morrisons: every search we've done, keyed by search term.
const morrisons = {};
for (const [term, v] of Object.entries(compare)) if (v.products?.length) morrisons[term.toLowerCase()] = v.products.map(fixUnit);
for (const [term, v] of Object.entries(results.stores?.morrisons || {})) if (v.products?.length) morrisons[term.toLowerCase()] = v.products.map(fixUnit);

// Lidl: the whole online range (food only) and receipt prices.
const lidl = (results.ranges?.lidl?.products || []).filter((p) => p.isFood && p.price > 0);

// Aldi: first page of each food category (data/aldi-range.json, made by aldi.mjs).
const aldiRange = await read('data/aldi-range.json', { products: [] });
const aldiLookups = await read('data/aldi-lookups.json', { products: [], unpriced: {} });
const aldi = [...aldiRange.products, ...aldiLookups.products].map(aldiProduct).filter((p) => p.price > 0);

// Example list for first use: list.txt.
// list.txt only says "2 x"; these are illustrative amounts for a big veggie lasagna (about 8 portions) so the
// example can show pack-size matching. A line left out of this table has no amount (size matching skips it).
const EXAMPLE_NEED = {
  'plant revolution meat free mince': [800, 'g'],
  'lasagne sheets': [500, 'g'],
  'chopped tomatoes': [3, 'tin'],
  passata: [500, 'g'],
  'brown onions': [3, 'item'],
  garlic: [2, 'item'],
  carrots: [500, 'g'],
  celery: [1, 'item'],
  'tomato puree': [3, 'tbsp'],
  butter: [125, 'g'],
  'plain flour': [500, 'g'],
  'whole milk': [1, 'l'],
  'mature cheddar': [300, 'g'],
  mozzarella: [250, 'g'],
};
const example = existsSync('list.txt')
  ? parseList(await readFile('list.txt', 'utf8')).map(({ qty, term }) => {
      const [amount, unit] = EXAMPLE_NEED[term] || [qty > 1 ? qty : null, qty > 1 ? (/tomato|bean|chickpea|lentil/.test(term) ? 'tin' : 'pack') : ''];
      return { item: term, amount, unit, meals: ['veggie lasagna'], staple: false };
    })
  : [];

const data = {
  updatedAt: results.updatedAt || Date.now(),
  morrisons,
  lidl,
  aldi,
  aldiUpdatedAt: aldiRange.fetchedAt || null,
  aldiNoPrice: aldiLookups.unpriced || {},
  receipts: Object.values(receipts.items || {}),
  example,
  exampleDishes: [{ name: 'veggie lasagna', servings: 8 }],
};

// The website loads prices from app/public/data.json; receipt prices stay
// private in Supabase and are fetched with the household key.
await writeFile('app/public/data.json', JSON.stringify({ ...data, receipts: [] }));

const html = (await readFile('app/dist/index.html', 'utf8')).replace(
  '/*__DATA__*/null',
  JSON.stringify(data).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, ''),
);
await writeFile('app.html', html);

// claude.ai adds its own document wrapper when publishing.
const fragment = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<link rel="(manifest|apple-touch-icon)"[^>]*>\s*/gi, '')
  .replace(/<meta name="(apple-mobile-web-app-[a-z-]+|mobile-web-app-capable|theme-color)"[^>]*>\s*/gi, '')
  .replace(/<body>\s*/i, '')
  .replace(/<\/body>\s*<\/html>\s*$/i, '');
await writeFile('app.artifact.html', fragment);

console.log(
  `Wrote app.html and app/public/data.json (${Math.round(html.length / 1024)} KB): ${Object.keys(morrisons).length} Morrisons searches, ` +
    `${lidl.length} Lidl products, ${aldi.length} Aldi products, ${data.receipts.length} receipt prices.`,
);
