// Pulls your Lidl Plus receipts with the `ilidl` tool and turns every line item
// into a Lidl price you actually paid, saved to data/lidl-receipt-prices.json.
// build.mjs then uses those prices for list items Lidl doesn't list online.
//
// One-time setup (on your Mac):
//   pip install ilidl            # needs Python 3.12+
//   log in at https://www.lidl.co.uk in Firefox or Chrome yourself
//   ilidl login --browser firefox   (or chrome)
//   ilidl doctor                    # checks the setup
//
// Then: node lidl-receipts.mjs [--limit 20]
//
// Receipts are personal, so everything is saved under data/, which git ignores.
// ilidl's JSON format isn't documented yet, so this reads it defensively and
// saves the raw output to data/lidl-receipts/ for checking.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const run = promisify(execFile);
const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 20;
const RAW = 'data/lidl-receipts';
const OUT = 'data/lidl-receipt-prices.json';

async function ilidl(...a) {
  try {
    const { stdout } = await run('ilidl', a, { maxBuffer: 20 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.error('ilidl is not installed. Run: pip install ilidl   (needs Python 3.12+)');
    } else {
      console.error(`ilidl ${a.join(' ')} failed:\n${(e.stderr || e.message).trim()}`);
      console.error('\nIf it mentions login or session, log in at lidl.co.uk in your browser, then run: ilidl login --browser firefox');
    }
    process.exit(1);
  }
}

// Field names vary; try the likely ones.
const pick = (o, keys) => keys.map((k) => o?.[k]).find((v) => v !== undefined && v !== null);
const num = (v) => (v == null ? null : Number(String(v).replace(/[£,\s]/g, '')));
const listOf = (j) => (Array.isArray(j) ? j : pick(j, ['receipts', 'items', 'tickets', 'data', 'results']) || []);

const list = listOf(await ilidl('receipts', '--json', '--limit', String(LIMIT)));
if (!list.length) {
  console.log('No receipts found.');
  process.exit(0);
}
await mkdir(RAW, { recursive: true });

const book = existsSync(OUT) ? JSON.parse(await readFile(OUT, 'utf8')) : { items: {} };
let lines = 0;
for (const r of list) {
  const id = pick(r, ['id', 'receiptId', 'ticketId', 'barcode']);
  if (!id) continue;
  const raw = existsSync(`${RAW}/${id}.json`)
    ? JSON.parse(await readFile(`${RAW}/${id}.json`, 'utf8'))
    : await ilidl('receipt', String(id), '--json');
  await writeFile(`${RAW}/${id}.json`, JSON.stringify(raw, null, 2));
  const date = String(pick(raw, ['date', 'purchaseDate', 'createdAt', 'dateTime']) ?? pick(r, ['date', 'purchaseDate', 'createdAt']) ?? '').slice(0, 10);
  const store = pick(raw, ['store', 'storeName', 'location']);
  const items = pick(raw, ['items', 'lines', 'itemsLine', 'products']) || [];
  for (const it of items) {
    const name = String(pick(it, ['name', 'description', 'title']) || '').trim();
    const qty = num(pick(it, ['quantity', 'qty'])) || 1;
    const total = num(pick(it, ['price', 'amount', 'originalAmount', 'total']));
    const unit = num(pick(it, ['unitPrice', 'currentUnitPrice'])) ?? (total != null ? total / qty : null);
    const discount = (pick(it, ['discounts']) || []).reduce((s, d) => s + Math.abs(num(d.amount) || 0), 0);
    if (!name || !(unit > 0)) continue;
    const weighed = !Number.isInteger(qty);
    const key = name.toLowerCase();
    const prev = book.items[key];
    if (!prev || (date && date >= prev.date)) {
      book.items[key] = {
        name,
        price: Math.round((weighed ? unit : unit - discount / qty) * 100) / 100,
        perKg: weighed,
        date,
        store: typeof store === 'string' ? store : store?.name || '',
      };
    }
    lines++;
  }
}
book.updatedAt = Date.now();
await writeFile(OUT, JSON.stringify(book, null, 2));
console.log(`Read ${list.length} receipts, ${lines} lines → ${Object.keys(book.items).length} Lidl prices in ${OUT}.`);
console.log('Now run: node build.mjs');
