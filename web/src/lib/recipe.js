// Hilfen rund um Rezepte (Varianten, Zutaten pro Schritt).

/** Wendet die persönliche Anpassung auf ein Rezept an (ohne das Original zu verändern). */
export function applyVariant(recipe, useVariant) {
  const v = recipe?.personal?.variant;
  if (!useVariant || !v) return recipe;
  return {
    ...recipe,
    servings: v.servings || recipe.servings,
    ingredients: v.ingredients || recipe.ingredients,
    steps: v.steps || recipe.steps,
    variantNotes: v.notes || '',
  };
}

const stem = (w) => w.toLowerCase().replace(/[^a-zäöüß]/g, '').replace(/(en|n|e|s|er)$/, '');

/** Findet Zutaten, die im Schritttext vorkommen. */
export function ingredientsForStep(step, groups) {
  const text = ` ${String(step?.text || '').toLowerCase()} `;
  const words = new Set(text.split(/[^a-zäöüß]+/).filter((w) => w.length > 2).map(stem));
  const out = [];
  for (const g of groups || []) {
    for (const i of g.items || []) {
      const nameWords = String(i.name).toLowerCase().split(/[^a-zäöüß]+/).filter((w) => w.length > 2);
      if (!nameWords.length) continue;
      const hit = nameWords.some((w) => words.has(stem(w)) || text.includes(w));
      if (hit) out.push(i);
    }
  }
  return out;
}

export const emptyRecipe = () => ({
  title: '', description: '', servings: 4, servings_unit: '', prep_time: '', cook_time: '', rest_time: '',
  difficulty: '', category: '', tags: [], ingredients: [{ name: '', items: [{ amount: '', unit: '', name: '', note: '' }] }],
  steps: [{ text: '' }], nutrition: null, notes: '', source_url: '', source_note: '', images: [], thermomix: false,
});

export const CATEGORIES = ['Frühstück', 'Vorspeise', 'Suppe', 'Salat', 'Hauptgericht', 'Beilage', 'Dessert', 'Kuchen & Gebäck', 'Brot', 'Snack', 'Getränk', 'Sauce & Dip'];
