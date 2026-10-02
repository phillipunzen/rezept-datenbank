import test from "node:test";
import assert from "node:assert/strict";
import {
  planCookidooSync,
  localState,
  remoteState,
  remoteLabel,
  type SyncLocal,
  type SyncPair,
} from "../shared/cookidoo-sync";
import type { RemoteShoppingItem } from "../server/integrations/cookidoo-provider";
const local: SyncLocal = {
  id: "local",
  name: "Kartoffeln",
  amount: "500",
  unit: "g",
  note: "",
  checked: false,
};
const remote: RemoteShoppingItem = {
  key: "additional:remote",
  id: "remote",
  kind: "additional",
  name: "500 g Kartoffeln",
  description: "",
  preparation: "",
  checked: false,
};
const pair: SyncPair = {
  id: "pair",
  localId: local.id,
  remoteKey: remote.key,
  local: localState(local),
  remote,
};
test("bidirectional merge preserves concurrent disjoint changes and reports conflicting text or deletion", () => {
  assert.deepEqual(
    planCookidooSync([local], [remote], []).units.map((u) => u.kind),
    ["LINK"],
  );
  const result = planCookidooSync(
    [{ ...local, checked: true }],
    [{ ...remote, name: "750 g Kartoffeln" }],
    [pair],
  );
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(result.units[0].desired, {
    fields: { name: "Kartoffeln", amount: "750", unit: "g", note: "" },
    checked: true,
  });
  assert.equal(
    planCookidooSync(
      [{ ...local, amount: "600" }],
      [{ ...remote, name: "700 g Kartoffeln" }],
      [pair],
    ).conflicts[0].reason,
    "BOTH_CHANGED",
  );
  assert.equal(
    planCookidooSync([], [{ ...remote, name: "700 g Kartoffeln" }], [pair])
      .conflicts[0].reason,
    "DELETE_CHANGED",
  );
  assert.equal(
    planCookidooSync([], [remote], [pair]).units[0].kind,
    "DELETE_REMOTE",
  );
  assert.equal(
    planCookidooSync([local], [], [pair]).units[0].kind,
    "DELETE_LOCAL",
  );
  assert.equal(
    planCookidooSync([{ ...local, checked: true }], [], [pair]).conflicts[0]
      .reason,
    "DELETE_CHANGED",
  );
});
test("recipe ingredients only allow checkmarks; ambiguity, review staleness and unlinking are explicit", () => {
  const ingredient: RemoteShoppingItem = {
    ...remote,
    key: "ingredient:remote",
    kind: "ingredient",
    name: "Kartoffeln",
    description: "0.5 kg",
  };
  const mapping = { ...pair, remoteKey: ingredient.key, remote: ingredient };
  assert.deepEqual(remoteState(ingredient), localState(local));
  assert.equal(
    planCookidooSync([{ ...local, checked: true }], [ingredient], [mapping])
      .conflicts.length,
    0,
  );
  assert.equal(
    planCookidooSync([{ ...local, amount: "600" }], [ingredient], [mapping])
      .conflicts[0].reason,
    "INGREDIENT_READONLY",
  );
  assert.equal(
    planCookidooSync([], [ingredient], [mapping]).conflicts[0].allowLocal,
    false,
  );
  const edited = { ...local, amount: "600" };
  const reviewed = {
    pairId: "pair",
    choice: "LOCAL" as const,
    local: localState(edited),
    remote,
  };
  assert.equal(
    planCookidooSync([edited], [remote], [pair], [reviewed]).units[0].desired
      ?.fields.amount,
    "600",
  );
  assert.equal(
    planCookidooSync(
      [edited],
      [{ ...remote, checked: true }],
      [pair],
      [reviewed],
    ).conflicts[0].reason,
    "RESOLUTION_STALE",
  );
  assert.equal(
    planCookidooSync(
      [local],
      [remote],
      [pair],
      [{ ...reviewed, local: localState(local), choice: "UNLINK" }],
    ).units[0].kind,
    "UNLINK",
  );
  assert.equal(
    planCookidooSync(
      [local, { ...local, id: "duplicate" }],
      [remote],
      [],
    ).units.filter((u) => u.kind === "LINK").length,
    0,
  );
  assert.equal(
    remoteLabel(
      remoteState({ ...remote, name: "1 kg Kartoffeln · festkochend" }),
    ),
    "1000 g Kartoffeln · festkochend",
  );
  assert.deepEqual(
    planCookidooSync([local], [remote], [], [], [local.id], [remote.key]),
    { units: [], conflicts: [] },
  );
});

test("sync comparisons ignore JSON property ordering and labels preserve unknown units", () => {
  const f = { name: "Basilikum", amount: null, unit: "Bund", note: "" };
  const item: SyncLocal = { id: "a", ...f, checked: false };
  const state = localState(item);
  const remote: RemoteShoppingItem = {
    key: "additional:a",
    id: "a",
    kind: "additional",
    name: remoteLabel(state),
    description: "",
    preparation: "",
    checked: false,
  };
  assert.deepEqual(remoteState(remote), state);
  const reordered = JSON.parse(
    JSON.stringify(state, [
      "checked",
      "fields",
      "unit",
      "amount",
      "note",
      "name",
    ]),
  );
  const pair: SyncPair = {
    id: "p",
    localId: "a",
    remoteKey: remote.key,
    local: reordered,
    remote: JSON.parse(
      JSON.stringify(remote, [
        "name",
        "id",
        "key",
        "kind",
        "checked",
        "description",
        "preparation",
      ]),
    ),
  };
  assert.equal(planCookidooSync([item], [remote], [pair]).conflicts.length, 0);
});
