// Where is each product in the shop? Reads a list, answers from store-map/stamford-hill.json when it
// already knows (and the answer is recent), asks your phone (Morrisons More app) only for the rest,
// saves what it learns, and prints the list in walking order.
//
// Usage: node aisles.mjs list.txt [--refresh] [--max-age 28] [--no-phone] [--map store-map/stamford-hill.json] [--store "Stamford Hill"]
//   list.txt   one product per line, the app's name first, then optional website names:
//                Morrisons Chickpeas In Water 400g | Morrisons Chickpeas In Water (400g)
//   --refresh  look everything up again (hand-set places are still never overwritten)
//   --no-phone never touch the phone; just report what it knows and what it would need to look up
//
// Phone steps need: phone plugged in + unlocked, Morrisons More open on Price & Product Finder, store selected.
// See lib/phone.mjs for the safety rules.

import { readFile, writeFile } from 'node:fs/promises';
import { parseAisleList, planLookups, applyPlace, recordNotFound, walkingOrder, MAX_AGE_DAYS } from './lib/aisles.mjs';
import { resolvePlace, zoneHeading } from './lib/storemap.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const LIST = args.find((a) => a.endsWith('.txt'));
if (!LIST) { console.error('Usage: node aisles.mjs list.txt [--refresh] [--max-age 28] [--no-phone]'); process.exit(1); }
const MAP_FILE = opt('--map', 'store-map/stamford-hill.json');
const STORE = opt('--store', 'Stamford Hill');
const maxAgeDays = Number(opt('--max-age', MAX_AGE_DAYS));
const today = new Date().toISOString().slice(0, 10);

const items = parseAisleList(await readFile(LIST, 'utf8'));
let map = { store: '', updated: '', zones: [], products: {}, needsCheck: [], ...JSON.parse(await readFile(MAP_FILE, 'utf8')) };
const save = () => writeFile(MAP_FILE, JSON.stringify(map, null, 2) + '\n');

const { cached, searched, todo } = planLookups(items, map, today, { refresh: flag('--refresh'), maxAgeDays, retryNotFound: flag('--retry-not-found') });
console.log(`${items.length} products: ${cached.length} already known, ${searched.length} searched before and not there, ${todo.length} to look up${flag('--no-phone') && todo.length ? ' (--no-phone: skipping)' : ''}.`);

let looked = 0, notFound = [], stoppedBecause = null;
if (todo.length && !flag('--no-phone')) {
  const { lookup, PhoneNotReady } = await import('./lib/phone.mjs'); // only load phone code when needed
  for (const it of todo) {
    try {
      const r = await lookup(it.names[0], { store: STORE, thorough: flag('--thorough') });
      looked++;
      if (r.status === 'found') {
        map = applyPlace(map, it.names, { location: r.location, description: r.description, checked: today });
        await save(); // after every product: an interruption loses nothing
        console.log(`  found     ${it.names[0]}  ->  ${r.location}`);
      } else {
        notFound.push({ name: it.names[0], rows: r.rows });
        map = recordNotFound(map, it.names[0], r.rows, today); // remembered, so it isn't searched again
        await save();
        console.log(`  NOT FOUND ${it.names[0]}`);
      }
    } catch (e) {
      if (e instanceof PhoneNotReady) { stoppedBecause = e.message; break; }
      throw e;
    }
  }
}

// ---- Print the list in walking order ----
console.log('\nWalking order (zones with no order set yet come after the ordered ones):');
for (const g of walkingOrder(items, map)) {
  console.log(`\n${zoneHeading(g.zone)}`);
  for (const it of g.rows) {
    const p = resolvePlace(it.names[0], null, {}, map);
    console.log(`  - ${it.names[0]}`);
    const detail = [p.side && `${p.side} side`, p.note].filter(Boolean).join(' · ');
    if (detail) console.log(`      ${detail}`);
  }
}

const missing = [
  ...notFound,
  ...searched.map((it) => ({ name: it.names[0], rows: (it.names.map((n) => map.notFound?.[n]).find((e) => e) || {}).rows || [], earlier: true })),
];
if (missing.length) {
  console.log('\nNot found in the app at this store (every search result shown, so you can pick a substitute):');
  for (const n of missing) { console.log(`  ${n.name}${n.earlier ? '  (searched before; --retry-not-found to search again)' : ''}`); for (const r of n.rows) console.log(`      ${r}`); }
}
console.log(`\ncached: ${cached.length} · phone lookups: ${looked} · not found: ${notFound.length} · still unplaced: ${items.filter((it) => !resolvePlace(it.names[0], null, {}, map).zone).length}`);
if (stoppedBecause) { console.log(`\nStopped: ${stoppedBecause}\nWhat was found so far is saved; run the same command again to continue.`); process.exit(2); }
