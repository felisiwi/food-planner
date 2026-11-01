// Builds the Food Planner phone app (app/, React + Base UI) into one HTML file
// with the latest price data embedded: app.html, plus app.artifact.html for
// publishing as a claude.ai page.
//
// Usage: node build-app.mjs   (runs the Vite build if app/dist is missing or --vite is passed)

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parseList } from './lib/list.mjs';

const read = async (f, fallback) => (existsSync(f) ? JSON.parse(await readFile(f, 'utf8')) : fallback);

if (process.argv.includes('--vite') || !existsSync('app/dist/index.html')) {
  execSync('npm run build', { cwd: 'app', stdio: 'inherit' });
}

const results = await read('data/results.json', {});
const compare = await read('data/compare-morrisons.json', {});
const receipts = await read('data/lidl-receipt-prices.json', { items: {} });

// Morrisons: every search we've done, keyed by search term.
const morrisons = {};
for (const [term, v] of Object.entries(compare)) if (v.products?.length) morrisons[term.toLowerCase()] = v.products;
for (const [term, v] of Object.entries(results.stores?.morrisons || {})) if (v.products?.length) morrisons[term.toLowerCase()] = v.products;

// Lidl: the whole online range (food only) and receipt prices.
const lidl = (results.ranges?.lidl?.products || []).filter((p) => p.isFood && p.price > 0);

// Example list for first use: list.txt.
const example = existsSync('list.txt')
  ? parseList(await readFile('list.txt', 'utf8')).map(({ qty, term }) => ({ item: term, amount: qty > 1 ? qty : null, unit: qty > 1 ? (/tomato|bean|chickpea|lentil/.test(term) ? 'tin' : 'pack') : '', meals: ['veggie lasagna'], staple: false }))
  : [];

const data = {
  updatedAt: results.updatedAt || Date.now(),
  morrisons,
  lidl,
  receipts: Object.values(receipts.items || {}),
  example,
};

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
  .replace(/<body>\s*/i, '')
  .replace(/<\/body>\s*<\/html>\s*$/i, '');
await writeFile('app.artifact.html', fragment);

console.log(
  `Wrote app.html (${Math.round(html.length / 1024)} KB): ${Object.keys(morrisons).length} Morrisons searches, ` +
    `${lidl.length} Lidl products, ${data.receipts.length} receipt prices.`,
);
