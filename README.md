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

## Where prices come from

| | Morrisons | Lidl |
|---|---|---|
| Online | groceries.morrisons.com, the full range | lidl.co.uk, only part of the range (offers, specials, some staples) |
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
pip install ilidl              # needs Python 3.12+
# log in at https://www.lidl.co.uk in Firefox or Chrome yourself, then:
ilidl login --browser firefox  # or chrome
ilidl doctor
```

Then, after any Lidl shop:

```sh
node lidl-receipts.mjs && node build.mjs
```

Receipts are personal, so they stay in `data/`, which git ignores. Receipt names are often
shortened, so loose matches show "Check it's the right item" on the page.

## Being polite

Both sites limit automated traffic. `fetch.mjs` stays well inside that: one request every
6 seconds per store, an honest user agent, a 24-hour cache per item, and it stops at the first
non-200 response without retrying. Don't lower the delay or disguise the requests.

## Next

1. Aisle locations for Morrisons Stamford Hill
2. Lidl prices from Lidl Plus receipts
3. Meals → ingredient lists, daily refresh, Supabase, price history
