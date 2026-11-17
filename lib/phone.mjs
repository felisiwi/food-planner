// Drives the Morrisons More app on an Android phone over USB (adb) to read a product's aisle from
// Price & Product Finder. Needs: adb, the phone unlocked, USB debugging allowed, the app open on
// Price & Product Finder with the right store selected.
//
// Safety rules baked in (see docs/blocked-requests.md for why):
//  - Before EVERY action, confirm the Morrisons app is in front and the phone is unlocked; otherwise throw.
//  - Only reads the screen as text (uiautomator dump). No screenshots, so nothing else on the phone is captured.
//  - Never taps "Add to shopping list": it only taps the search box, Search, a chosen result row, and Back.
//  - Changes no phone settings.

import { execFileSync } from 'node:child_process';
import { rowMatches, sameProduct, parseSheet } from './aisles.mjs';

const PKG = 'com.morrisons.matchandmore.app';
const NAV = new Set(['back', 'Change store', 'Search products', 'Home', 'My Offers', 'Fivers', 'Partners', 'More']);

export class PhoneNotReady extends Error {}

const adb = (...a) => execFileSync('adb', a, { encoding: 'utf8', timeout: 40000, maxBuffer: 32 * 1024 * 1024 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const unxml = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function ensureSafe(why) {
  let w;
  try { w = adb('shell', 'dumpsys', 'window'); }
  catch { throw new PhoneNotReady('No phone found over USB. Plug it in, unlock it, and allow USB debugging.'); }
  const focus = /mCurrentFocus=.*/.exec(w)?.[0] || '';
  if (!focus.includes(PKG) || !w.includes('isKeyguardShowing=false')) {
    throw new PhoneNotReady(`Morrisons More isn't in front, or the phone is locked (${why}). Unlock it and open Price & Product Finder.`);
  }
}

// `uiautomator dump` fails now and then while the screen is mid-animation (exit 255, no message).
// Waiting a second and asking again nearly always works, so try a few times before giving up.
function dumpToFile(tries = 4) {
  for (let i = 1; ; i++) {
    try { return adb('shell', 'uiautomator', 'dump', '/sdcard/mm.xml'); }
    catch (e) {
      if (i >= tries) throw new PhoneNotReady(`The phone wouldn't give up its screen text after ${tries} tries. Keep the screen on, leave Morrisons More open, and run the command again.`);
      execFileSync('sleep', ['1']);
    }
  }
}

function dump() {
  dumpToFile();
  const xml = adb('exec-out', 'cat', '/sdcard/mm.xml');
  adb('shell', 'rm', '/sdcard/mm.xml');
  const attr = (n, k) => unxml((new RegExp(`\\b${k}="([^"]*)"`).exec(n) || [, ''])[1]);
  return [...xml.matchAll(/<node[^>]*?>/g)].map(([n]) => {
    const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(n);
    return {
      label: attr(n, 'text') || attr(n, 'content-desc'),
      cls: attr(n, 'class').split('.').pop(),
      click: attr(n, 'clickable') === 'true',
      b: b ? b.slice(1).map(Number) : null,
    };
  });
}

const centre = (nd) => [(nd.b[0] + nd.b[2]) >> 1, (nd.b[1] + nd.b[3]) >> 1];
const tap = (nd) => { const [x, y] = centre(nd); adb('shell', 'input', 'tap', String(x), String(y)); };
const find = (nodes, pred) => nodes.find((n) => n.b && pred(n));
const sheetOpen = (nodes) => !!find(nodes, (n) => n.label === 'Add to shopping list');
const resultRows = (nodes) => nodes.filter((n) => n.click && n.cls === 'Button' && n.label && !NAV.has(n.label) && n.b && n.b[1] > 480 && n.b[1] < 2540);

// Pop-up text in screen order: everything between the drag handle and the "Add to shopping list" button.
function sheetTexts(nodes) {
  const start = nodes.findIndex((n) => n.label.startsWith('Activate to adjust the size'));
  const end = nodes.findIndex((n) => n.label === 'Add to shopping list');
  return nodes.slice(start + 1, end).filter((n) => n.cls === 'TextView' && n.label).map((n) => n.label);
}

async function closeSheet() {
  adb('shell', 'input', 'keyevent', '4');
  await sleep(1500);
  ensureSafe('after closing the pop-up');
  if (sheetOpen(dump())) throw new PhoneNotReady('The product pop-up would not close. Close it by hand and run again.');
}

function checkFinder(nodes, store) {
  const hasBox = find(nodes, (n) => n.cls === 'EditText');
  const storeRow = find(nodes, (n) => n.click && n.label.endsWith('Change store'));
  if (!hasBox || !storeRow) throw new PhoneNotReady('Open Price & Product Finder in the app first (the screen with the search box and "Change store").');
  if (!storeRow.label.toLowerCase().includes(store.toLowerCase())) {
    throw new PhoneNotReady(`The app's store is "${storeRow.label.replace(/\s*Change store$/, '')}", not "${store}". Change it in the app and run again.`);
  }
}

// What to type: letters, digits, spaces and hyphens only (adb's text input chokes on & ( ) ' etc.).
const typable = (s) => s.replace(/[^A-Za-z0-9 -]+/g, ' ').replace(/\s+/g, ' ').trim();
// Second try without the size ("... 400g"): the app's search copes better with short names.
const SIZE_TAIL = /\s+\d+(?:\.\d+)?\s?(?:kg|g|ml|l|ltr|litre|pk|pack)\b.*$/i;
export const queriesFor = (name) => [...new Set([typable(name), typable(name.replace(SIZE_TAIL, ''))].filter(Boolean))];

async function search(query) {
  ensureSafe(`before searching "${query}"`);
  const box = find(dump(), (n) => n.cls === 'EditText');
  if (!box) throw new PhoneNotReady('Lost the search box. Is Price & Product Finder still open?');
  tap(box); await sleep(600);
  adb('shell', 'input', 'keyevent', '123', ...Array(60).fill('67')); // jump to end, delete up to 60 characters
  adb('shell', 'input', 'text', query.replace(/ /g, '%s')); await sleep(600);
  ensureSafe('after typing');
  const btn = find(dump(), (n) => n.label === 'Search products');
  if (!btn) throw new PhoneNotReady('Lost the Search button.');
  tap(btn); await sleep(4000);
  ensureSafe('after searching');
}

// Find one product by its app name and read its aisle.
//   { status: 'found', title, location, description }
//   { status: 'not-found', rows: [every result row's text, unfiltered] }   (so a human/Claude can pick a substitute)
// Throws PhoneNotReady if the phone/app isn't in a safe state.
// One search by default: every extra search is another thing typed into the phone. `thorough` adds the
// second, shorter query (without the size) for names the app's search struggles with.
export async function lookup(appName, { store = 'Stamford Hill', thorough = false } = {}) {
  ensureSafe('at start');
  let nodes = dump();
  if (sheetOpen(nodes)) { await closeSheet(); nodes = dump(); }
  checkFinder(nodes, store);

  let seen = [];
  for (const q of thorough ? queriesFor(appName) : queriesFor(appName).slice(0, 1)) {
    await search(q);
    let rows = resultRows(dump());
    if (!rows.length) { await sleep(3000); rows = resultRows(dump()); }
    seen = rows.map((r) => r.label);
    const labels = rows.filter((r) => rowMatches(r.label, appName)).sort((a, b) => a.label.length - b.label.length).slice(0, 3).map((r) => r.label);
    for (const label of labels) {
      const row = find(dump(), (n) => n.click && n.label === label);
      if (!row) continue;
      tap(row); await sleep(2500); ensureSafe('after tapping a result');
      let n2 = dump();
      if (!sheetOpen(n2)) { // the on-screen keyboard can swallow the first tap
        const again = find(n2, (n) => n.click && n.label === label);
        if (again) { tap(again); await sleep(2500); ensureSafe('after tapping again'); n2 = dump(); }
      }
      if (!sheetOpen(n2)) continue;
      const sheet = parseSheet(sheetTexts(n2));
      await closeSheet();
      if (sheet && sameProduct(sheet.title, appName)) return { status: 'found', ...sheet };
    }
  }
  return { status: 'not-found', rows: seen };
}
