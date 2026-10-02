import test from "node:test";
import assert from "node:assert/strict";
import { scaleAmount, normalizedName, unitDefinition } from "../shared/recipes";
test("portion scaling uses precise decimals, keeps optional amounts and rounds to four places", () => {
  assert.equal(scaleAmount("500", 4, 6), "750");
  assert.equal(scaleAmount("0.1", 3, 9), "0.3");
  assert.equal(scaleAmount("1", 3, 1), "0.3333");
  assert.equal(scaleAmount("0.0001", 2, 1), "0.0001");
  assert.equal(scaleAmount("0", 4, 6), "0");
  assert.equal(scaleAmount(null, 4, 6), null);
  assert.equal(scaleAmount("10.0000", 4, 4), "10");
  assert.throws(() => scaleAmount("-1", 4, 6));
  assert.throws(() => scaleAmount("1", 0, 6));
  assert.throws(() => scaleAmount("1", 4, 1001));
  assert.throws(() => scaleAmount("NaN", 4, 6));
});
test("normalization and units preserve dimensions instead of guessing weight from pieces", () => {
  assert.equal(normalizedName("  Rote   Zwiebeln "), "rote zwiebeln");
  assert.deepEqual(unitDefinition("kg"), {
    dimension: "MASS",
    baseFactor: "1000",
  });
  assert.deepEqual(unitDefinition("ml"), {
    dimension: "VOLUME",
    baseFactor: "1",
  });
  assert.deepEqual(unitDefinition("Stück"), {
    dimension: "COUNT",
    baseFactor: null,
  });
  assert.deepEqual(unitDefinition("EL"), {
    dimension: "OTHER",
    baseFactor: null,
  });
});
