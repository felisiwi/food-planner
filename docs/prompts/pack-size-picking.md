# Task: pack-size-aware product picking in Food Planner

You're working in the repo `felisiwi/food-planner` (locally `~/GitHub/food-planner`). It's a personal
shopping planner comparing Morrisons Stamford Hill and Lidl Amhurst Park. The phone app lives in
`app/` (React 18 + Base UI `@base-ui/react` 1.9.0, built with Vite into one HTML file by
`node build-app.mjs --vite`). Read `README.md` first. Treat it and these notes as a starting point
and verify claims against the code rather than assuming they're accurate.

## Where things are

- `app/src/App.jsx`: the app. `Planner` builds `rows`: one per needed ingredient, with `opts`
  (options per store), `chosen` (the picked option per store, by index from the synced `picks` doc),
  `cost`, `unit` (price per kg/l/each) and `best` (cheaper store). `ShopList` renders the tick-off
  list with a Swap link; `CompareRow` shows both stores side by side.
- `app/src/data.js`: `morrisonsFor(term)`, `lidlFor(term)`, `perUnit(p)` (price per kg/l/each,
  derived from the pack size in the name when the shop gives none), `orderOptions(opts, mode)`.
- Ingredients come from Claude via `ingredientsFor()` in `app/src/claude.js`, with
  `{item, amount, unit, meals, staple}`. `unit` is one of g, kg, ml, l, tin, pack, item, bunch, tsp, tbsp.
- Product objects have `name`, `price` (pack price, £), optional `unitPrice` + `unitLabel`
  (already in pounds; `perUnit` normalises), `offer`, `image`, `category`, `source`.

## What to build

1. **Pack size per product.** Add `packSize(p)` in `data.js` returning `{qty, u}` in kg, l or each,
   parsed from the name ("500g", "1.5kg", "2 x 400g", "6 pack", "12's") or else derived as
   `price / unitPrice` when a unit price exists. Return `null` when unknown. Unit-test it on real
   names from the embedded data.
2. **Amount needed per ingredient** in the same units: g/kg/ml/l convert directly; for tins assume
   400g each; for item/pack/bunch use the count against "each"; tsp/tbsp count as "you probably
   have it" (no size matching).
3. **Default pick: cheapest similar size.** For each store, among real matches, pick the cheapest
   pack whose size is between 0.5× and 2× the amount needed (allow buying 2-3 small packs if that's
   cheaper and still sensible; show "2 × 400g"). If the amount or pack size is unknown, fall back to
   the cheapest pack. This replaces the current "Pick by price per kg" switch.
4. **Easy choosing on every item** (Shop and Compare): three one-tap choices, "Similar size"
   (default), "Cheapest per kg" and "Cheapest pack", plus ‹ › buttons to step through all options
   with "3 of 9". Use Base UI `ToggleGroup` (or `Tabs`) for the three choices. Each option shows size,
   pack price and price per kg. Store the choice per item and store in the existing synced `picks`
   doc (keep old index-based entries working).
5. **Flag big packs clearly.** When the chosen pack is more than 2× the amount needed, show a
   warning chip, e.g. "1.5kg: 3× what you need (500g)", plus the similar-size alternative and the
   difference in spend, e.g. "Similar size: 500g £0.53 (17p less now)". It should be impossible to
   miss on a phone.
6. **Totals and comparison stay honest.** Header totals are what you'd actually pay for the chosen
   packs. "Which shop is cheaper" keeps comparing per kg/l when both have the same unit (within 2%
   counts as the same).

## Constraints

- Don't run `fetch.mjs`, `compare.mjs` or anything else that contacts Morrisons or Lidl. Work from
  the data already embedded by `build-app.mjs`. Both sites rate-limit; the fetchers are deliberately
  slow, and nothing here needs new data.
- Keep the app working outside Claude (capabilities resolve to null): the example list and browser
  storage must still work.
- Match the existing style: tokens in `app/src/styles.css`, light and dark themes, phone-first,
  16px side gutters, no horizontal scroll.
- On a hard bug, find the root cause and report it with evidence before applying a fix.
- Ask before anything long-running.

## Done when

- `node build-app.mjs --vite` builds cleanly and `app.html` opens without console errors.
- A Playwright check at 390×844 shows, for the example lasagna list: similar-size picks by default;
  switching flour to "Cheapest per kg" picks the 1.5kg bag and shows the big-pack warning with the
  500g alternative; ‹ › steps through options; totals update.
- `packSize` tests pass on at least 15 real product names, including multipacks and loose items.
- Commit with a clear message and push to `main`. Report what changed, screenshots of Shop and
  Compare, and anything you couldn't verify.
