import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizedQuantity,
  fixedAmount,
  decimalAmount,
  displayQuantity,
} from "../shared/planning";
import { calendarDate } from "../server/services/planning";
test("shopping normalization preserves decimal scaling, dimensions and unknown quantities", () => {
  const a = normalizedQuantity({
    name: "Kartoffeln",
    amount: "500",
    unit: "g",
    note: "",
  });
  const b = normalizedQuantity({
    name: " kartoffeln ",
    amount: "0.75",
    unit: "kg",
    note: "",
  });
  assert.equal(a.key, b.key);
  assert.equal(
    decimalAmount(fixedAmount(a.amount!) + fixedAmount(b.amount!)),
    "1250",
  );
  assert.equal(displayQuantity("1250", "g", "de"), "1,25 kg");
  assert.equal(
    normalizedQuantity(
      { name: "Milch", amount: "0.1", unit: "l", note: "" },
      4,
      6,
    ).amount,
    "150",
  );
  assert.equal(
    normalizedQuantity({ name: "Salz", amount: null, unit: "g", note: "" })
      .amount,
    null,
  );
  assert.notEqual(
    normalizedQuantity({ name: "Salz", amount: null, unit: "g", note: "" }).key,
    normalizedQuantity({ name: "Salz", amount: "0", unit: "g", note: "" }).key,
  );
  assert.notEqual(
    normalizedQuantity({ name: "Reis", amount: "1", unit: "kg", note: "" }).key,
    normalizedQuantity({ name: "Reis", amount: "1", unit: "l", note: "" }).key,
  );
  assert.equal(
    normalizedQuantity({
      name: "Kartoffeln",
      amount: "1234567890",
      unit: "g",
      note: "",
    }).amount,
    "1234567890",
  );
  assert.equal(decimalAmount(0n), "0");
  assert.throws(() => decimalAmount(100000000000000000000n));
  assert.throws(() => fixedAmount("1e5"));
});
test("calendar dates reject impossible dates and preserve leap days", () => {
  assert.equal(
    calendarDate("2028-02-29").toISOString(),
    "2028-02-29T00:00:00.000Z",
  );
  assert.throws(() => calendarDate("2026-02-29"));
  assert.throws(() => calendarDate("2026-04-31"));
});
