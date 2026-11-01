// Turning a list of meals into shopping ingredients: the prompt, and cleaning
// up the answer. Shared by the app (inside Claude), the web API and the Mac worker.

export function ingredientsPrompt(meals) {
  return `You plan a UK supermarket shop (Morrisons and Lidl).
Meals to cook, with servings where given:
${meals}

List every ingredient needed, merged across meals and scaled to the servings (assume 2 servings if none given).
For each ingredient return:
- "item": a short generic supermarket search term in UK English, lowercase, no brands or sizes (e.g. "chopped tomatoes", "brown onions", "vegetarian mince", "mature cheddar")
- "amount": a number, and "unit": one of "g", "kg", "ml", "l", "tin", "pack", "item", "bunch", "tsp", "tbsp"
- "meals": the meal names it's for
- "staple": true for store-cupboard things most kitchens already have (oil, salt, pepper, dried herbs and spices, sugar, vinegar), else false
Reply with only a JSON array, e.g. [{"item":"chopped tomatoes","amount":3,"unit":"tin","meals":["veggie lasagna"],"staple":false}]`;
}

// Accepts the parsed array, or raw text that contains one.
export function cleanIngredients(list) {
  if (typeof list === 'string') {
    const m = list.match(/\[[\s\S]*\]/);
    if (!m) throw { code: 'invalid_json' };
    try { list = JSON.parse(m[0]); } catch { throw { code: 'invalid_json' }; }
  }
  if (!Array.isArray(list)) throw { code: 'invalid_json' };
  return list
    .filter((x) => x && typeof x.item === 'string' && x.item.trim())
    .map((x) => ({
      item: x.item.trim().toLowerCase(),
      amount: Number(x.amount) || null,
      unit: typeof x.unit === 'string' ? x.unit : '',
      meals: Array.isArray(x.meals) ? x.meals.map(String) : [],
      staple: !!x.staple,
    }));
}
