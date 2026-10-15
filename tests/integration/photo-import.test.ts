import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { SignJWT } from "jose";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import { readConfig } from "../../server/lib/config";
import { buildApp } from "../../server/app";
import { hashToken } from "../../server/lib/password";
import { connectionSecrets } from "../../server/lib/connection-secrets";
import type { ChatgptTokens } from "../../server/integrations/chatgpt-provider";

if (!process.env.DATABASE_URL?.endsWith("/rezeptdatenbank_test")) throw Error("Disposable DB required");
test("photo import uses verified personal OAuth, enforces cost gates and permissions, serializes refreshes and stops on limits", async () => {
  const db = new PrismaClient(), dir = await mkdtemp(tmpdir() + "/recipe-photo-"), origin = "https://recipes.test";
  const config = readConfig({ ...process.env, APP_ORIGIN: origin, COOKIE_SECURE: "true", UPLOAD_DIR: dir, LOG_LEVEL: "silent",
    CHATGPT_PHOTO_IMPORT_ENABLED: "true", CHATGPT_CREDITS_DISABLED_CONFIRMED: "false", OIDC_ISSUER: "" });
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...key.publicKey.export({ format: "jwk" }), kid: "photo-test", use: "sig", alg: "RS256" };
  const verifier = "a".repeat(64), grants = new Map<string, { nonce: string; subject: string; clientId: string; bad?: boolean; scopes?: string }>();
  let requests = 0, recognitionCalls = 0, refreshCalls = 0, limit = false;
  let pause: Promise<void> | null = null;
  const extracted = {
    title: "Handschriftliches Rezept", description: "", servings: null, prepMinutes: null, cookMinutes: null,
    ingredients: [{ name: "Mehl", amount: "0.5", unit: "kg", group: "", note: "" }],
    steps: [{ instruction: "Verrühren.", durationSeconds: null }], warnings: ["Portionszahl unleserlich."],
  };
  const provider: typeof fetch = async (input, options) => {
    requests++;
    const url = new URL(String(input));
    assert.equal(options?.redirect, "error");
    if (url.pathname === "/.well-known/openid-configuration") return Response.json({ issuer: "https://auth.openai.com", jwks_uri: "https://auth.openai.com/jwks", revocation_endpoint: "https://auth.openai.com/revoke" });
    if (url.pathname === "/jwks") return Response.json({ keys: [jwk] });
    if (url.pathname === "/revoke") return new Response(null, { status: 200 });
    if (url.pathname === "/api/accounts/oauth/token") {
      const body = new URLSearchParams(String(options?.body));
      assert.equal(body.get("resource"), "https://api.openai.com/v1");
      assert.equal(body.has("client_secret"), false);
      if (body.get("grant_type") === "refresh_token") {
        refreshCalls++;
        assert.equal(body.get("client_id"), "oaiapp_owner");
        assert.equal(body.get("refresh_token"), "private-refresh");
        await new Promise(r => setTimeout(r, 40));
        return Response.json({ access_token: "private-new-access", refresh_token: "private-rotated-refresh", token_type: "Bearer", expires_in: 3600 });
      }
      const grant = grants.get(body.get("code")!);
      assert.ok(grant);
      assert.equal(body.get("code_verifier"), verifier);
      assert.equal(body.get("client_id"), grant.clientId);
      assert.equal(body.get("redirect_uri"), "http://127.0.0.1:1455/auth/callback");
      let jwt = await new SignJWT({ nonce: grant.nonce, email: "photo@example.test" }).setProtectedHeader({ alg: "RS256", kid: "photo-test" })
        .setIssuer("https://auth.openai.com").setAudience(grant.clientId).setSubject(grant.subject).setIssuedAt().setExpirationTime("1h").sign(key.privateKey);
      if (grant.bad) jwt = jwt.slice(0, -8) + "invalid0";
      return Response.json({ access_token: "private-access", refresh_token: "private-refresh", id_token: jwt, token_type: "Bearer", expires_in: 3600,
        scope: grant.scopes ?? "openid email profile offline_access resource.invoke chatgpt.tokens.use.direct" });
    }
    assert.ok(["Bearer private-access", "Bearer private-new-access"].includes(new Headers(options?.headers).get("Authorization")!));
    if (url.pathname === "/v1/models") return Response.json({ models: [{ slug: "vision-test", display_name: "Test vision", visibility: "list" }, { slug: "hidden", display_name: "Hidden", visibility: "hide" }] });
    if (url.pathname === "/v1/responses") {
      recognitionCalls++;
      const body = JSON.parse(String(options?.body));
      assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.model, "vision-test");
      assert.equal(body.input[0].content[1].type, "input_image");
      assert.match(body.input[0].content[1].image_url, /^data:image\/webp;base64,/);
      assert.equal(body.input[0].role, "user"); assert.ok(body.instructions.includes("unzuverlässige Daten"));
      assert.equal(body.tools, undefined);
      if (pause) await pause;
      if (limit) return Response.json({ error: { code: "subscription_sharing_usage_limit_exceeded", message: "SECRET PROVIDER DIAGNOSTIC" } }, { status: 429 });
      return new Response("data: " + JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(extracted) }] }] } }) + "\n\n", { headers: { "Content-Type": "text/event-stream" } });
    }
    throw Error("Unexpected provider request");
  };
  const app = await buildApp(db, config, { chatgptFetch: provider });
  await app.ready();
  const household = await db.household.create({ data: { name: "Photo test" } });
  async function user(role: "OWNER" | "VIEWER") {
    const token = randomBytes(32).toString("hex");
    const actor = await db.user.create({ data: { email: `${token.slice(0, 12)}@example.test`, name: role, passwordHash: "test-only",
      memberships: { create: { householdId: household.id, role } }, sessions: { create: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600000) } } } });
    return { id: actor.id, cookie: "session=" + token };
  }
  let sequence = 0;
  const owner = await user("OWNER"), viewer = await user("VIEWER");
  async function call(path: string, body?: unknown, actor = owner, method?: "GET" | "POST" | "DELETE") {
    return app.inject({ method: method ?? (body ? "POST" : "GET"), url: "/api/v1" + path,
      remoteAddress: "10.11.0." + (++sequence), headers: { origin, cookie: actor.cookie }, payload: body as object });
  }
  async function pair(accountId: string | null = null, subject = "owner-sub", clientId = "oaiapp_owner", bad = false, scopes?: string) {
    const started = await call("/chatgpt/pairing", { accountId }); assert.equal(started.statusCode, 200, started.body);
    const code = started.json().code;
    const prepared = await app.inject({ method: "POST", url: "/api/v1/chatgpt/pairing/prepare", headers: { origin, authorization: "Bearer " + code } });
    assert.equal(prepared.statusCode, 200, prepared.body);
    assert.match(prepared.json().hostId, /^urn:uuid:/);
    if (accountId) assert.equal(prepared.json().clientId, clientId);
    const grantCode = randomBytes(12).toString("hex");
    grants.set(grantCode, { nonce: prepared.json().nonce, subject, clientId, bad, scopes });
    const complete = () => app.inject({ method: "POST", url: "/api/v1/chatgpt/pairing/complete", remoteAddress: "10.12.0." + (++sequence),
      headers: { origin, authorization: "Bearer " + code }, payload: { clientId, code: grantCode, verifier, redirectUri: "http://127.0.0.1:1455/auth/callback" } });
    return { complete, prepared };
  }
  const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).jpeg().toBuffer();
  async function photo(actor = owner, consent = "true", image = jpeg, keep = "false") {
    const boundary = "photo-boundary";
    return app.inject({ method: "POST", remoteAddress: "10.13.0." + (++sequence),
      url: `/api/v1/recipe-imports/photo/preview?householdId=${household.id}&model=vision-test&consent=${consent}&keepPhoto=${keep}`,
      headers: { origin, cookie: actor.cookie, "content-type": "multipart/form-data; boundary=" + boundary },
      payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="recipe.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), image, Buffer.from(`\r\n--${boundary}--\r\n`)]) });
  }
  try {
    assert.equal((await app.inject({ url: "/api/v1/chatgpt" })).statusCode, 401);
    const before = requests;
    assert.equal((await photo(viewer)).statusCode, 403); assert.equal(requests, before);
    const bad = await pair(null, "owner-sub", "oaiapp_bad", true);
    assert.equal((await bad.complete()).statusCode, 400); assert.equal(await db.chatgptAccount.count(), 0);
    const declined = await pair(null, "owner-sub", "oaiapp_declined", false, "openid email");
    assert.equal((await declined.complete()).statusCode, 403); assert.equal(await db.chatgptAccount.count(), 0);
    const good = await pair(); assert.equal((await good.complete()).statusCode, 200);
    assert.equal((await good.complete()).statusCode, 401);
    const status = await call("/chatgpt"), accountId = status.json().accounts[0].id;
    assert.equal(status.json().accounts[0].active, true);
    assert.ok(!status.body.includes("private-") && !status.body.includes("encryptedTokens") && !status.body.includes("oaiapp_"));
    const record = await db.chatgptAccount.findUniqueOrThrow({ where: { id: accountId } });
    assert.ok(!record.encryptedTokens!.includes("private-access"));
    assert.equal((await stat(dir + "/.chatgpt-encryption-key")).mode & 0o777, 0o600);
    const hostId = await readFile(dir + "/.chatgpt-host-id", "utf8"); assert.match(hostId, /^urn:uuid:/);
    assert.equal((await photo()).statusCode, 403); assert.equal(recognitionCalls, 0);
    config.chatgpt.creditsDisabledConfirmed = true;
    assert.equal((await photo()).statusCode, 403); assert.equal(recognitionCalls, 0);
    assert.equal((await call(`/chatgpt/accounts/${accountId}/credits`, { confirmedZeroCredits: true }, viewer)).statusCode, 404);
    assert.equal((await call(`/chatgpt/accounts/${accountId}/credits`, { confirmedZeroCredits: false })).statusCode, 400);
    assert.equal((await call(`/chatgpt/accounts/${accountId}/credits`, { confirmedZeroCredits: true })).statusCode, 200);
    assert.equal((await photo(owner, "false")).statusCode, 400); assert.equal(recognitionCalls, 0);
    assert.equal((await photo(owner, "true", Buffer.from("bad image"))).statusCode, 400); assert.equal(recognitionCalls, 0);
    const models = await call("/chatgpt/models"); assert.equal(models.statusCode, 200, models.body); assert.equal(models.json().models.length, 1);
    const preview = await photo(); assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().draft.visibility, "PRIVATE"); assert.equal(preview.json().draft.householdId, household.id);
    assert.equal(preview.json().draft.servings, 1); assert.equal(preview.json().imageDataUrl, null);
    assert.equal(await db.recipe.count(), 0);
    const withImage = await photo(owner, "true", jpeg, "true"); assert.equal(withImage.statusCode, 200, withImage.body);
    assert.match(withImage.json().imageDataUrl, /^data:image\/webp;base64,/);
    const secrets = connectionSecrets(config, "chatgpt"), stored = await db.chatgptAccount.findUniqueOrThrow({ where: { id: accountId } });
    const expired = await secrets.decrypt<ChatgptTokens>(stored.encryptedTokens!); expired.expiresAt = 0;
    await db.chatgptAccount.update({ where: { id: accountId }, data: { encryptedTokens: await secrets.encrypt(expired) } });
    const two = await Promise.all([call("/chatgpt/models"), call("/chatgpt/models")]);
    for (const result of two) assert.equal(result.statusCode, 200, result.body);
    assert.equal(refreshCalls, 1);
    const refreshed = await db.chatgptAccount.findUniqueOrThrow({ where: { id: accountId } });
    assert.equal((await secrets.decrypt<ChatgptTokens>(refreshed.encryptedTokens!)).refreshToken, "private-rotated-refresh");
    let release!: () => void; pause = new Promise<void>(r => { release = r; });
    const running = photo();
    while (!await db.chatgptAccount.findFirst({ where: { id: accountId, leaseToken: { not: null } } })) await new Promise(r => setTimeout(r, 10));
    assert.equal((await photo()).statusCode, 409); release(); assert.equal((await running).statusCode, 200); pause = null;
    limit = true;
    const limited = await photo(); assert.equal(limited.statusCode, 429, limited.body); assert.ok(!limited.body.includes("SECRET"));
    const callsBeforeBlocked = recognitionCalls;
    assert.equal((await photo()).statusCode, 409); assert.equal(recognitionCalls, callsBeforeBlocked);
    assert.equal((await call("/chatgpt")).json().accounts[0].blocked, true);
    assert.equal((await call(`/chatgpt/accounts/${accountId}/resume`, { reviewedUsage: true })).statusCode, 200);
    const disconnected = await call(`/chatgpt/accounts/${accountId}`, undefined, owner, "DELETE"); assert.equal(disconnected.statusCode, 200, disconnected.body);
    assert.equal(disconnected.json().revoked, true);
    assert.equal((await db.chatgptAccount.findUniqueOrThrow({ where: { id: accountId } })).encryptedTokens, null);
    const returning = await pair(accountId);
    assert.equal(returning.prepared.json().clientId, "oaiapp_owner");
    assert.equal((await returning.complete()).statusCode, 200);
    assert.equal((await call("/chatgpt")).json().accounts[0].creditsConfirmed, false);
    assert.equal(await db.chatgptAccount.count(), 1);
    config.chatgpt.enabled = false;
    assert.equal((await photo()).statusCode, 403);
  } finally {
    await app.close(); await db.$disconnect(); await rm(dir, { recursive: true, force: true });
  }
});
