import test from "node:test";
import assert from "node:assert/strict";
import { parseTandoor, decodeTandoor } from "../server/services/tandoor-parser";
import { readZip, zipBudget } from "../server/lib/safe-zip";
import { testZip, tandoorFixture } from "./helpers/zip";
test("official nested Default layout preserves structured amounts, groups and minute timers, with isolated record failures", async () => {
  const recipe = testZip({
    "recipe.json": JSON.stringify(tandoorFixture),
    "image.png": "fake image",
  });
  const archive = testZip({
    "42.zip": recipe,
    "43.zip": testZip({ "recipe.json": "broken" }),
  });
  const result = await parseTandoor(archive, "household");
  assert.equal(result.length, 2);
  assert.equal(result[0].draft?.ingredients[0].amount, "500");
  assert.equal(result[0].draft?.ingredients[0].group, "Pfanne");
  assert.equal(result[0].draft?.steps[0].durationSeconds, 180);
  assert.deepEqual(result[0].draft?.steps[0].ingredientIndexes, [0]);
  assert.equal(result[0].draft?.nutrition?.basis, "UNKNOWN");
  assert.equal(result[1].draft, null);
  assert.ok(result[1].error);
  const repeated = await parseTandoor(
    testZip({ "different-id.zip": recipe }),
    "another-household",
  );
  assert.equal(result[0].contentHash, repeated[0].contentHash);
  assert.throws(() =>
    decodeTandoor({ ...tandoorFixture, servings: 0 }, "household"),
  );
});
test("ZIP reader rejects traversal, duplicate names, excessive expansion and actual size mismatches", async () => {
  await assert.rejects(readZip(testZip({ "../escape": "x" }), zipBudget()));
  await assert.rejects(
    readZip(testZip({ "image.webp": "x".repeat(100000) }, true), zipBudget()),
    /Entpackgrenze/,
  );
  const falseSize = testZip({ "recipe.json": "{}" });
  const index = falseSize.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  falseSize.writeUInt32LE(1, index + 24);
  await assert.rejects(readZip(falseSize, zipBudget()));
  await assert.rejects(
    parseTandoor(
      testZip({
        "42.zip": testZip({ "recipe.json": "x".repeat(1000000) }, true),
      }),
      "hh",
    ),
  );
});
