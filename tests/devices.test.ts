import test from "node:test";
import assert from "node:assert/strict";
import {
  deviceStepError,
  suggestedDeviceSteps,
  deviceSignature,
} from "../shared/devices";
import { emptyRecipe } from "../shared/recipes";
test("device parameters require reviewed valid combinations and never infer heat/speed", () => {
  const recipe = emptyRecipe("hh");
  recipe.steps = [{ instruction: "Hacken", durationSeconds: 5 }];
  const [suggested] = suggestedDeviceSteps(recipe);
  assert.equal(suggested.enabled, false);
  assert.equal(suggested.temperature, null);
  assert.equal(suggested.speed, null);
  assert.equal(suggested.durationSeconds, 5);
  const manual = { ...suggested, enabled: true, speed: 5 };
  assert.equal(deviceStepError(manual), null);
  assert.ok(deviceStepError({ ...manual, speed: 8, temperature: 100 }));
  assert.ok(deviceStepError({ ...manual, durationSeconds: 0.5 }));
  assert.ok(deviceStepError({ ...manual, temperature: 38 }));
  const turbo = {
    ...manual,
    mode: "TURBO" as const,
    speed: null,
    durationSeconds: 0.5,
  };
  assert.equal(deviceStepError(turbo), null);
  assert.ok(deviceStepError({ ...turbo, reverse: true }));
  assert.ok(deviceStepError({ ...turbo, durationSeconds: 1.5 }));
  assert.notEqual(
    deviceSignature(recipe),
    deviceSignature({ ...recipe, servings: 6 }),
  );
  assert.equal(
    deviceSignature(recipe),
    deviceSignature(
      Object.assign({}, recipe, { notes: "personal", title: "Renamed" }),
    ),
  );
});
