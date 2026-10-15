import test from "node:test";
import assert from "node:assert/strict";
import { photoPreview } from "../server/services/recipe-photo-import";
import { readRecipeStream, ChatgptProviderError } from "../server/integrations/chatgpt-provider";

export const extracted = {
  title: "Omas Pfannkuchen", description: "Handschriftliche Vorlage", servings: null,
  prepMinutes: null, cookMinutes: null,
  ingredients: [{ name: "Mehl", amount: "250", unit: "g", group: "", note: "" },
    { name: "Milch", amount: null, unit: "ml", group: "", note: "Menge unleserlich" }],
  steps: [{ instruction: "Alles verrühren und ausbacken.", durationSeconds: null }],
  warnings: ["Milchmenge unleserlich."],
};
test("photo preview binds household and private visibility, flags unknowns and rejects invented fields", () => {
  const preview = photoPreview(JSON.stringify(extracted), "household");
  assert.equal(preview.draft.visibility, "PRIVATE");
  assert.equal(preview.draft.householdId, "household");
  assert.equal(preview.draft.servings, 1);
  assert.equal(preview.draft.prepMinutes, 0);
  assert.equal(preview.draft.ingredients[1].amount, null);
  assert.equal(preview.draft.vegan, false);
  assert.equal(preview.imageDataUrl, null);
  assert.ok(preview.warnings.some(s => s.includes("Platzhalter")));
  assert.throws(() => photoPreview(JSON.stringify({ ...extracted, householdId: "other", sourceUrl: "https://evil.test" }), "household"));
  assert.throws(() => photoPreview(JSON.stringify({ ...extracted, ingredients: [{ ...extracted.ingredients[0], amount: "1/2" }] }), "household"));
  assert.throws(() => photoPreview("{}", "household"));
});
function stream(parts: string[]) {
  return new Response(new ReadableStream({ start(controller) {
    for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
    controller.close();
  } }));
}
const completed = (text: string) => ({ type: "response.completed", response: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }] } });
test("SSE consumes split CRLF and UTF-8 safely and accepts only completed response text", async () => {
  const raw = "data: " + JSON.stringify(completed(JSON.stringify(extracted))) + "\r\n\r\n";
  // Byte splits cover multi-byte handwriting characters as well as delimiters.
  const bytes = new TextEncoder().encode(raw);
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }));
  assert.equal(await readRecipeStream(response), JSON.stringify(extracted));
  await assert.rejects(readRecipeStream(stream(['data: {"type":"response.output_text.delta","delta":"{}"}\n\n'])), /unterbrochen/);
  await assert.rejects(readRecipeStream(stream(['data: {"type":"response.incomplete"}\n\n'])), /unvollständig/);
  await assert.rejects(readRecipeStream(stream(['data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n'])), (e: unknown) => e instanceof ChatgptProviderError && e.blockAccount && e.statusCode === 429);
});
test("standalone local helper uses dynamic client registration, host identity, PKCE and no token in authorization URL", async () => {
  const { authorizationUrl } = await import("../public/tools/chatgpt-connect.mjs");
  const args = { hostId: "urn:uuid:test", nonce: "nonce", clientId: null };
  const first = new URL(authorizationUrl(args, "http://127.0.0.1:1455/auth/callback", "state", "verifier"));
  assert.equal(first.origin, "https://auth.openai.com");
  assert.equal(first.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(first.searchParams.get("ext_agent_host_id"), args.hostId);
  assert.equal(first.searchParams.get("code_challenge_method"), "S256");
  assert.equal(first.searchParams.get("agent_name_hint"), "Rezeptdatenbank");
  assert.equal(first.searchParams.has("id_token_hint"), false);
  const returning = new URL(authorizationUrl({ ...args, clientId: "oaiapp_existing" }, "http://127.0.0.1:54321/auth/callback", "fresh-state", "fresh-verifier"));
  assert.equal(returning.searchParams.get("client_id"), "oaiapp_existing");
  assert.equal(returning.searchParams.has("agent_name_hint"), false);
});
test("local helper rejects a wrong state and forwards one PKCE-bound code over HTTPS without exposing credentials", async () => {
  const { connect } = await import("../public/tools/chatgpt-connect.mjs");
  const realFetch = globalThis.fetch, lines: string[] = [], pairingCode = "a".repeat(64);
  let authorize: URL | undefined, completed = 0, callbackChecks: Promise<void> | undefined;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname === "127.0.0.1") return realFetch(input, options);
    assert.equal(url.origin, "https://helper-recipes.test");
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("Authorization"), "Bearer " + pairingCode);
    assert.equal(headers.get("Origin"), url.origin);
    if (url.pathname.endsWith("/prepare")) return Response.json({ hostId: "urn:uuid:00000000-0000-4000-8000-000000000000", nonce: "test-nonce", clientId: null });
    assert.ok(url.pathname.endsWith("/complete"));
    const data = JSON.parse(String(options?.body));
    assert.ok(authorize);
    assert.equal(data.clientId, "oaiapp_helper"); assert.equal(data.code, "short-lived-code");
    assert.equal(data.redirectUri, authorize.searchParams.get("redirect_uri"));
    const { createHash } = await import("node:crypto");
    assert.equal(createHash("sha256").update(data.verifier).digest("base64url"), authorize.searchParams.get("code_challenge"));
    assert.equal(data.access_token, undefined); assert.equal(data.refresh_token, undefined);
    completed++;
    return Response.json({ ok: true });
  };
  try {
    await connect("https://helper-recipes.test", pairingCode, line => {
      lines.push(line);
      if (!line.startsWith("https://auth.openai.com/")) return;
      authorize = new URL(line);
      callbackChecks = (async () => {
        const callback = new URL(authorize!.searchParams.get("redirect_uri")!);
        callback.search = new URLSearchParams({ state: "wrong", code: "spoofed", client_id: "oaiapp_attacker" }).toString();
        assert.equal((await realFetch(callback)).status, 400); assert.equal(completed, 0);
        callback.search = new URLSearchParams({ state: authorize!.searchParams.get("state")!, code: "short-lived-code", client_id: "oaiapp_helper" }).toString();
        const accepted = await realFetch(callback);
        assert.equal(accepted.status, 200); assert.match(await accepted.text(), /verbunden/);
      })();
    });
    await callbackChecks;
    assert.equal(completed, 1);
    assert.ok(!lines.join(" ").includes(pairingCode));
  } finally { globalThis.fetch = realFetch; }
});
