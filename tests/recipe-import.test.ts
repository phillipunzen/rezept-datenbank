import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  extractRecipe,
  importRecipeUrl,
  parseIngredient,
} from "../server/services/recipe-import";
import {
  importUrl,
  publicAddress,
  fetchPublic,
  type RemoteFetcher,
} from "../server/lib/safe-fetch";

const markup = (data: unknown) =>
  `<html><script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script></html>`;
const source = "https://recipes.example.test/risotto";
const recipe = {
  "@type": ["Thing", "Recipe"],
  name: "Pilzrisotto &amp; Kräuter",
  description: "<p>Cremig</p><script>alert(1)</script>",
  recipeYield: "4 Portionen",
  prepTime: "PT10M",
  cookTime: "PT25M",
  suitableForDiet: "https://schema.org/VegetarianDiet",
  recipeIngredient: [
    "500 g Pilze",
    "1½ EL Olivenöl",
    "200g Reis",
    "Salz nach Geschmack",
    "2–3 Knoblauchzehen",
  ],
  recipeInstructions: [
    {
      "@type": "HowToSection",
      name: "Vorbereiten",
      itemListElement: [
        { "@type": "HowToStep", text: "<p>Pilze schneiden.</p>" },
        { "@type": "HowToStep", text: "Reis kochen." },
      ],
    },
  ],
  image: { "@type": "ImageObject", contentUrl: "/images/risotto.png" },
};
test("JSON-LD graphs, linked steps, HTML, ingredients and original source map to an editable recipe", () => {
  const data = extractRecipe(
    markup({ "@graph": [recipe] }),
    source,
    "household",
  );
  assert.equal(data.draft.title, "Pilzrisotto & Kräuter");
  assert.equal(data.draft.description, "Cremig");
  assert.equal(data.draft.sourceUrl, source);
  assert.equal(data.draft.prepMinutes, 10);
  assert.equal(data.draft.cookMinutes, 25);
  assert.equal(data.draft.servings, 4);
  assert.equal(data.draft.vegetarian, true);
  assert.deepEqual(
    data.draft.ingredients.slice(0, 3).map((i) => [i.amount, i.unit, i.name]),
    [
      ["500", "g", "Pilze"],
      ["1.5", "EL", "Olivenöl"],
      ["200", "g", "Reis"],
    ],
  );
  assert.equal(data.draft.ingredients[4].name, "2–3 Knoblauchzehen");
  assert.equal(data.draft.ingredients[4].amount, null);
  assert.equal(
    data.draft.steps[0].instruction,
    "Vorbereiten: Pilze schneiden.",
  );
  assert.deepEqual(data.imageUrls, [
    "https://recipes.example.test/images/risotto.png",
  ]);
  assert.ok(data.warnings.length);
  const linked = extractRecipe(
    markup({
      "@graph": [
        { ...recipe, recipeInstructions: [{ "@id": "#step" }] },
        { "@id": "#step", "@type": "HowToStep", text: "Zwiebeln schneiden." },
      ],
    }),
    source,
    "household",
  );
  assert.equal(linked.draft.steps[0].instruction, "Zwiebeln schneiden.");
});
test("Microdata and malformed JSON-LD fallback, fractions and ambiguous packaging", () => {
  const html = `<script type="application/ld+json">broken</script><div itemscope itemtype="https://schema.org/Recipe">
    <h1 itemprop="name">Brot</h1><span itemprop="recipeIngredient">0,5 kg Mehl</span>
    <p itemprop="recipeInstructions">Kneten.<br>Backen.</p><img itemprop="image" src="/brot.jpg"></div>`;
  const data = extractRecipe(html, source, "household");
  assert.equal(data.draft.title, "Brot");
  assert.equal(data.draft.ingredients[0].amount, "0.5");
  assert.equal(data.draft.ingredients[0].unit, "kg");
  assert.deepEqual(
    data.draft.steps.map((s) => s.instruction),
    ["Kneten.", "Backen."],
  );
  assert.equal(parseIngredient("½ TL Salz").amount, "0.5");
  assert.equal(parseIngredient("1 1/3 cups Mehl").amount, "1.3333");
  assert.equal(parseIngredient("2 x 400 g Tomaten").amount, null);
  assert.equal(
    parseIngredient({
      "@type": "PropertyValue",
      name: "Mehl",
      value: "3/4",
      unitCode: "GRM",
    }).unit,
    "g",
  );
  assert.equal(parseIngredient({ name: "Salz" }).amount, null);
  assert.throws(
    () => extractRecipe("<h1>Kein Rezept</h1>", source, "h"),
    /keine lesbaren Rezeptdaten/,
  );
});
test("import fetches the recipe image, strips metadata, and degrades safely if an image is missing", async () => {
  const png = await sharp({
    create: { width: 20, height: 15, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  const fetcher: RemoteFetcher = async (url) =>
    url === source
      ? { body: Buffer.from(markup(recipe)), url, contentType: "text/html" }
      : { body: png, url, contentType: "image/png" };
  const preview = await importRecipeUrl(source, "h", fetcher);
  assert.ok(preview.imageDataUrl?.startsWith("data:image/webp;base64,"));
  const image = await sharp(
    Buffer.from(preview.imageDataUrl!.split(",")[1], "base64"),
  ).metadata();
  assert.equal(image.format, "webp");
  assert.equal(image.width, 20);
  assert.equal(image.exif, undefined);
  const blockedImage = await importRecipeUrl(source, "h", async (url) => ({
    body: Buffer.from(markup({ ...recipe, image: "http://127.0.0.1/private" })),
    url,
    contentType: "text/html",
  }));
  assert.equal(blockedImage.imageDataUrl, null);
  assert.equal(blockedImage.draft.title, preview.draft.title);
  assert.ok(
    blockedImage.warnings.some((message) => message.includes("Rezeptbild")),
  );
});
test("SSRF protection rejects private, special-use and encoded addresses and disallowed URLs", async () => {
  for (const address of [
    "0.0.0.0",
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.10.70",
    "169.254.169.254",
    "100.64.0.1",
    "192.0.2.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "2002:7f00:1::",
  ]) {
    assert.equal(publicAddress(address), false, address);
  }
  assert.equal(publicAddress("93.184.216.34"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
  for (const url of [
    "file:///etc/passwd",
    "http://localhost/x",
    "http://127.1/x",
    "http://2130706433/x",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://user:pass@example.com",
    "https://example.com:3000/",
  ]) {
    assert.throws(() => importUrl(url));
  }
  await assert.rejects(
    fetchPublic("http://127.0.0.1/private", 1024, AbortSignal.timeout(1000)),
  );
});
