// Turning a list of meals into shopping ingredients: the prompt, and cleaning
// up the answer. Shared by the app (inside Claude), the web API and the Mac worker.

export function ingredientsPrompt(meals) {
  return `You plan a UK supermarket shop (Morrisons and Lidl).
Meals to cook, with servings where given:
${meals}

List every ingredient needed, merged across meals and scaled to the servings (assume 2 servings if none given).
Reply with only a JSON object with two keys:
"meals": one entry per meal: {"name": short meal name, lowercase, "servings": number of portions}
"items": one entry per ingredient:
- "item": a short generic supermarket search term in UK English, lowercase, no brands or sizes (e.g. "chopped tomatoes", "brown onions", "vegetarian mince", "mature cheddar")
- "amount": a number (the total across all meals), and "unit": one of "g", "kg", "ml", "l", "tin", "pack", "item", "bunch", "tsp", "tbsp"
- "meals": the meal names it's for, exactly as in "meals"
- "perMeal": the amount for each of those meals in the same unit, e.g. {"veggie lasagna": 800}
- "staple": true for store-cupboard things most kitchens already have (oil, salt, pepper, dried herbs and spices, sugar, vinegar), else false
Example: {"meals":[{"name":"veggie lasagna","servings":8}],"items":[{"item":"chopped tomatoes","amount":3,"unit":"tin","meals":["veggie lasagna"],"perMeal":{"veggie lasagna":3},"staple":false}]}`;
}

function parse(raw) {
  if (typeof raw !== 'string') return raw;
  const m = raw.match(/[\[{][\s\S]*[\]}]/);
  if (!m) throw { code: 'invalid_json' };
  try { return JSON.parse(m[0]); } catch { throw { code: 'invalid_json' }; }
}

// Accepts the parsed array, or raw text that contains one.
export function cleanIngredients(list) {
  list = parse(list);
  if (list && !Array.isArray(list) && Array.isArray(list.items)) list = list.items;
  if (!Array.isArray(list)) throw { code: 'invalid_json' };
  return list
    .filter((x) => x && typeof x.item === 'string' && x.item.trim())
    .map((x) => {
      const perMeal = x.perMeal && typeof x.perMeal === 'object'
        ? Object.fromEntries(Object.entries(x.perMeal).map(([k, v]) => [String(k).toLowerCase(), Number(v)]).filter(([, v]) => v > 0))
        : null;
      return {
        item: x.item.trim().toLowerCase(),
        amount: Number(x.amount) || null,
        unit: typeof x.unit === 'string' ? x.unit : '',
        meals: Array.isArray(x.meals) ? x.meals.map((m) => String(m).toLowerCase()) : [],
        ...(perMeal && Object.keys(perMeal).length ? { perMeal } : {}),
        staple: !!x.staple,
      };
    });
}

// The whole answer: { dishes: [{name, servings}], items }. Older answers were a
// bare list of items; their dishes are worked out from the items' meal names.
export function cleanPlan(raw) {
  const v = parse(raw);
  const items = cleanIngredients(v);
  let dishes = Array.isArray(v?.meals)
    ? v.meals.filter((m) => m && m.name).map((m) => ({ name: String(m.name).toLowerCase(), servings: Number(m.servings) > 0 ? Number(m.servings) : null }))
    : [];
  if (!dishes.length) dishes = [...new Set(items.flatMap((i) => i.meals))].map((name) => ({ name, servings: null }));
  return { dishes, items };
}
