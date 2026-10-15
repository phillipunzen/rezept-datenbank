import test from "node:test";
import assert from "node:assert/strict";
import { createCodexRuntime, includedUsageAllowed } from "../server/integrations/codex-runtime";

test("included usage requires explicit permission, zero extra credit access and a valid quota snapshot", () => {
  const snapshot = { ordinaryUsageAllowed: true, rateLimits: { primary: { usedPercent: 10 }, secondary: null,
    credits: { hasCredits: false, unlimited: false, balance: "0.00" } } };
  assert.equal(includedUsageAllowed(snapshot), true);
  for (const ordinaryUsageAllowed of [undefined, null, false]) assert.equal(includedUsageAllowed({ ...snapshot, ordinaryUsageAllowed }), false);
  for (const credits of [null, { hasCredits: true, unlimited: false, balance: "10" }, { hasCredits: false, unlimited: true }, { hasCredits: false, unlimited: false, balance: "1" }])
    assert.equal(includedUsageAllowed({ ...snapshot, rateLimits: { ...snapshot.rateLimits, credits } }), false);
  assert.equal(includedUsageAllowed({ ...snapshot, rateLimits: { ...snapshot.rateLimits, primary: { usedPercent: 100 } } }), false);
  assert.equal(includedUsageAllowed({ ...snapshot, rateLimits: { ...snapshot.rateLimits, rateLimitReachedType: "usageLimit" } }), false);
  assert.equal(includedUsageAllowed({ ...snapshot, rateLimits: { ...snapshot.rateLimits, spendControlReached: true } }), false);
  assert.equal(includedUsageAllowed({}), false);
  assert.equal(includedUsageAllowed({ ...snapshot, rateLimitsByLimitId: { codex: snapshot.rateLimits, other_model: { ...snapshot.rateLimits, credits: { hasCredits: true, unlimited: false, balance: "10" } } } }), false);
});

test("bundled Codex initializes in a private empty runtime without inheriting this session", { timeout: 20000 }, async () => {
  const runtime = await createCodexRuntime();
  try {
    const account = await runtime.request("account/read", { refreshToken: false });
    assert.equal(account.account, null);
    assert.equal(account.requiresOpenaiAuth, true);
    const config = await runtime.request("config/read", { includeLayers: false });
    assert.equal(config.config.forced_login_method, "chatgpt");
    assert.equal(config.config.features.shell_tool, false);
    assert.equal(config.config.features.plugins, false);
    assert.equal(config.config.features.multi_agent, false);
    assert.equal(config.config.web_search, "disabled");
    assert.equal(config.config.default_permissions, "recipe_photo");
    assert.equal(config.config.permissions.recipe_photo.network.enabled, false);
    assert.equal(config.config.permissions.recipe_photo.filesystem["/"], "deny");
  } finally { await runtime.close(); }
});
