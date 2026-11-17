# food-planner

Plan a shop before walking to the supermarket: a priced list with photos, grouped by
section, plus a Morrisons vs Lidl comparison in total and item by item.

Stores: **Morrisons Stamford Hill** and **Lidl Amhurst Park** (N16).

## Run it (Node 18+)

```sh
node fetch.mjs        # look up every line of list.txt at Morrisons and Lidl
node build.mjs        # write list.html
open list.html        # or get it onto your phone
```

`node fetch.mjs --store lidl` fetches one store only.

## The page

- **Header:** each shop's total, how many items are priced there, the like-for-like
  saving on items priced at both, and the cheapest split between the two.
- **Compare:** every item side by side, the cheaper one highlighted with the saving.
  **Swap** picks another match, **+ Add price** records a Lidl price from a shelf or receipt.
- **Shop Morrisons / Shop Lidl:** a tick-off list grouped by section. "Only items that are
  cheaper here" shows just your half of the split.

Prices you add on the page stay on that device. **Copy prices I added as CSV** gives you lines
to paste into `prices/lidl.csv`, so they're kept in the repo and used on every build.

## list.txt

One item per line, `2 x` for quantities, `#` for comments. Specific terms match better.

## The phone app (app/, React + Base UI)

Plan meals, get the ingredients from Claude, tick what you have at home, and shop from a
list split between the two shops. Built as one HTML file with the latest prices inside:

```sh
cd app && npm install && cd ..
node build-app.mjs --vite   # writes app.html (and app.artifact.html for claude.ai)
```

**Pack sizes.** Each product's size is read from its name ("500g", "2 x 400g", "12's") or worked out from
price / unit price, and compared with the amount the recipe needs (tins count as 400g). Every item has three
one-tap choices: *Similar size* (default: cheapest pack, or 2-3 small packs, that is 0.85x to 2x what you need),
*Cheapest per kg* and *Cheapest pack*, plus ‹ › to step through every option. A pack more than 2x what you need
gets a warning with the similar-size alternative. Totals are what you'd pay for the packs shown; "which shop is
cheaper" still compares per kg or litre. Picks are saved by product name in the synced `picks` doc.
Tests for the size parser and picker: `cd app && npm test`.

When opened in Claude, the page asks Claude for ingredients and keeps your plan, pantry,
ticks and added prices in its shared storage, so phone and laptop stay in sync. Ingredients
with no Morrisons price yet are queued for the laptop to look up.

## Where prices come from

| | Morrisons | Lidl |
|---|---|---|
| Online | groceries.morrisons.com, one search per item | lidl.co.uk whole published range (~500-700 products), fetched in ~11 pages once a day |
| Gaps | rare | `prices/lidl.csv` and prices you add on the page |
| Notes | national online prices, mostly match in-store | headline price may be the Lidl Plus price (tagged) |

Lidl search results include loosely related items ("milk" → milk frother), so a result only
counts if every word of your term is in the product name and it's a food item.

## Lidl prices from your receipts

Lidl's website only lists part of its range, so the best Lidl prices are the ones on your
Lidl Plus receipts. `lidl-receipts.mjs` reads them with the unofficial
[ilidl](https://pypi.org/project/ilidl/) tool (Lidl UK only).

One-time setup:

```sh
python3 -m venv .venv && .venv/bin/pip install ilidl   # needs Python 3.12+
# log in at https://www.lidl.co.uk in Chrome or Firefox yourself, then:
.venv/bin/ilidl login --browser chrome                 # or firefox
.venv/bin/ilidl doctor
```

Then, after any Lidl shop:

```sh
node lidl-receipts.mjs && node build.mjs
```

Receipts are personal, so they stay in `data/`, which git ignores. Receipt names are often
shortened, so loose matches show "Check it's the right item" on the page.

## Lidl vs Morrisons, product by product

```sh
node fetch.mjs --store lidl   # Lidl's whole online range
node compare.mjs              # ~15-20 min the first time, cached for 7 days after
open compare.html
```

Takes everyday food Lidl lists online plus your receipt items, finds the cheapest matching
Morrisons product for each, and compares per kg or litre where both shops give it.

## Aisles at your store (from the Morrisons More app)

Morrisons' website doesn't say where anything is in a shop; the **Morrisons More** Android app does
(Price & Product Finder, per store). `aisles.mjs` reads that off your phone over USB and saves it into
`store-map/stamford-hill.json`, the map the Shop list already uses.

```sh
node aisles.mjs list.txt              # known products come from the map; the phone is only used for the rest
node aisles.mjs list.txt --no-phone   # never touch the phone, just show what it knows
node aisles.mjs list.txt --refresh    # look everything up again (hand-set places are never overwritten)
```

`list.txt` here is not the shopping list above: one product per line, **the app's name first**, then
optional website names that mean the same product (the app and website often spell names differently):

```
Morrisons Chickpeas In Water 400g | Morrisons Chickpeas In Water (400g)
```

For the phone steps: plug in the phone, unlock it, allow USB debugging, open the app on **Price &
Product Finder** and pick your store. The command checks before every step that the app is in front and
the phone is unlocked, reads the screen as text only (no screenshots), never taps "Add to shopping
list", and saves after every product, so an interruption loses nothing. Answers are reused for 28 days
(`--max-age`). Needs `adb` (`brew install --cask android-platform-tools`).

- **Not found** at your store: it prints every search result so you can pick a substitute; it never
  swaps one in silently. It remembers the miss (`notFound` in the map file, 28 days) so a rerun doesn't
  type the same search into the phone again; `--retry-not-found` searches those again. Each product is
  searched once per run; `--thorough` adds a second, shorter search without the size.
- Produce (loose veg, fruit) doesn't need the phone: it's all in the fresh produce section.
- **Walk order:** numbered aisles are provisionally ordered by number (marked `walkOrderSource` in the
  file); the Shop list replaces that with the order you really walk once you've ticked 3 trips. Fresh
  produce is set first (before Aisle 1, per Felix). Aisle-end units have no order yet. TODO(felix): confirm
  where they sit.
- **Inside an aisle:** the app says "near the start / halfway / near the end". That's saved as `pos`
  (0 / 0.5 / 1) and the Shop list sorts each aisle start to end and shows it in the chip
  ("Aisle 2 · right · near the start"). TODO(felix): confirm at the shelves that the app's wording is right.
- Notes on what the app exposes and what was blocked: `docs/blocked-requests.md`.

## Being polite

Both sites limit automated traffic. `fetch.mjs` stays well inside that: one request every
6 seconds per store, an honest user agent, a 24-hour cache per item, and it stops at the first
non-200 response without retrying. Don't lower the delay or disguise the requests.

## Next

1. Aisle locations for Morrisons Stamford Hill
2. Lidl prices from Lidl Plus receipts
3. Meals → ingredient lists, daily refresh, Supabase, price history
