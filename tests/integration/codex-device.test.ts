import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../../server/app";
import { readConfig } from "../../server/lib/config";
import { hashToken } from "../../server/lib/password";
import type { CodexRuntime, CodexRuntimeFactory } from "../../server/integrations/codex-runtime";

if (!process.env.DATABASE_URL?.endsWith("/rezeptdatenbank_test")) throw Error("Disposable DB required");
test("device sign-in is personal, cancellable, expires, completes automatically and cannot infer with credits or unknown usage", async () => {
  const db = new PrismaClient(), dir = await mkdtemp(tmpdir() + "/recipe-device-test-"), origin = "https://device-recipes.test";
  const config = readConfig({ ...process.env, APP_ORIGIN: origin, COOKIE_SECURE: "true", UPLOAD_DIR: dir, LOG_LEVEL: "silent", OIDC_ISSUER: "",
    CHATGPT_PHOTO_IMPORT_ENABLED: "true", CHATGPT_CREDITS_DISABLED_CONFIRMED: "false" });
  let count = 0, turns = 0, closed = 0, accountMode = "chatgpt", badUrl = false, failedTurn = false;
  const logins: Array<{ resolve: (event: object) => void; loginId: string }> = [];
  let limits: any = { ordinaryUsageAllowed: true, rateLimits: { primary: { usedPercent: 15 }, secondary: null, credits: { hasCredits: false, unlimited: false, balance: "0" } } };
  let pause: Promise<void> | null = null;
  const extracted = { title: "Device-Rezept", description: "", servings: 2, prepMinutes: 5, cookMinutes: 10,
    ingredients: [{ name: "Mehl", amount: "250", unit: "g", group: "", note: "" }], steps: [{ instruction: "Vermischen.", durationSeconds: null }], warnings: [] };
  const factory: CodexRuntimeFactory = async auth => {
    if (auth) assert.match(auth, /private-device-token/);
    const loginId = "native-login-" + (++count);
    let resolveLogin!: (value: object) => void, rejectLogin!: (error: Error) => void;
    let waiting = false, done = false;
    const login = new Promise<object>((resolve, reject) => { resolveLogin = resolve; rejectLogin = reject; });
    const runtime: CodexRuntime = {
      cwd: "/isolated/work",
      async request(method, params: any) {
        if (method === "account/login/start") {
          assert.deepEqual(params, { type: "chatgptDeviceCode" });
          logins.push({ resolve: resolveLogin, loginId });
          return { type: "chatgptDeviceCode", loginId, verificationUrl: badUrl ? "https://evil.test/" : "https://auth.openai.com/codex/device", userCode: "ABCD-1234" } as any;
        }
        if (method === "account/read") return { account: { type: accountMode, email: "device@example.test", planType: "pro" } } as any;
        if (method === "account/rateLimits/read") return limits;
        if (method === "model/list") return { data: [{ model: "vision-test", displayName: "Vision", inputModalities: ["text", "image"] }, { model: "text-only", displayName: "Text", inputModalities: ["text"] }], nextCursor: null } as any;
        if (method === "thread/start") {
          turns++; assert.equal(params.ephemeral, true); assert.equal(params.allowProviderModelFallback, false);
          assert.equal(params.permissions, "recipe_photo"); assert.equal(params.approvalPolicy, "never");
          return { thread: { id: "thread" } } as any;
        }
        if (method === "turn/start") {
          assert.equal(params.input[1].type, "image"); assert.match(params.input[1].url, /^data:image\/webp;base64,/);
          assert.equal(params.permissions, "recipe_photo"); assert.ok(params.outputSchema);
          return { turn: { id: "turn" } } as any;
        }
        if (method === "account/logout") return {} as any;
        throw Error("Unexpected native method " + method);
      },
      async wait(method, accept) {
        if (method === "account/login/completed") { waiting = true; const result = await login; assert.equal(accept(result), true); return result; }
        if (method === "turn/completed") {
          if (pause) await pause;
          const result = { threadId: "thread", turn: { id: "turn", status: failedTurn ? "failed" : "completed", items: [{ type: "agentMessage", phase: "final_answer", text: JSON.stringify(extracted) }] } };
          assert.equal(accept(result), true); return result;
        }
        throw Error("Unexpected native notification");
      },
      async credentials() { return JSON.stringify({ tokens: { access_token: "private-device-token" } }); },
      drain() { return []; },
      async close() { if (!done) { done = true; closed++; if (waiting) rejectLogin(Error("closed")); } },
    };
    return runtime;
  };
  const app = await buildApp(db, config, { codexRuntimeFactory: factory }); await app.ready();
  const household = await db.household.create({ data: { name: "Device" } });
  async function actor() {
    const token = randomBytes(32).toString("hex"), user = await db.user.create({ data: { email: `${token.slice(0, 10)}@example.test`, name: "Device", passwordHash: "test-only",
      memberships: { create: { householdId: household.id, role: "OWNER" } }, sessions: { create: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600000) } } } });
    return { id: user.id, cookie: "session=" + token };
  }
  const owner = await actor(), other = await actor(); let requestId = 0;
  function call(path: string, body?: object, user = owner, method?: "GET" | "POST" | "DELETE") {
    return app.inject({ method: method ?? (body ? "POST" : "GET"), url: "/api/v1" + path, remoteAddress: "10.31.0." + (++requestId), headers: { origin, cookie: user.cookie }, payload: body });
  }
  async function start() { const r = await call("/chatgpt/device/start", { accountId: null }); assert.equal(r.statusCode, 200, r.body); return r.json(); }
  async function settle(id: string, status: string) {
    for (let i = 0; i < 100; i++) {
      const result = await db.chatgptDeviceAttempt.findUniqueOrThrow({ where: { id } });
      if (result.status === status) return result;
      await new Promise(r => setTimeout(r, 10));
    }
    throw Error("Device status did not settle: " + status);
  }
  const image = await sharp({ create: { width: 10, height: 10, channels: 3, background: "white" } }).jpeg().toBuffer();
  async function photo() {
    const b = "device-photo";
    return app.inject({ method: "POST", url: `/api/v1/recipe-imports/photo/preview?householdId=${household.id}&model=vision-test&consent=true&keepPhoto=false`,
      remoteAddress: "10.32.0." + (++requestId), headers: { origin, cookie: owner.cookie, "content-type": "multipart/form-data; boundary=" + b },
      payload: Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="recipe.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), image, Buffer.from(`\r\n--${b}--\r\n`)]) });
  }
  try {
    badUrl = true; assert.equal((await call("/chatgpt/device/start", { accountId: null })).statusCode, 500); badUrl = false;
    const cancelled = await start();
    assert.equal((await call(`/chatgpt/device/${cancelled.id}`, undefined, other)).statusCode, 404);
    assert.equal((await call(`/chatgpt/device/${cancelled.id}`, undefined, owner, "DELETE")).statusCode, 200);
    assert.equal((await call(`/chatgpt/device/${cancelled.id}`)).json().status, "CANCELLED");
    const denied = await start(); const deniedLogin = logins.at(-1)!;
    deniedLogin.resolve({ loginId: deniedLogin.loginId, success: false, error: "PRIVATE DIAGNOSTIC" });
    await settle(denied.id, "FAILED"); assert.equal(await db.chatgptAccount.count(), 0);
    const expired = await start(); const expiredLogin = logins.at(-1)!;
    await db.chatgptDeviceAttempt.update({ where: { id: expired.id }, data: { expiresAt: new Date(0) } });
    assert.equal((await call(`/chatgpt/device/${expired.id}`)).json().status, "EXPIRED");
    expiredLogin.resolve({ loginId: expiredLogin.loginId, success: true }); await settle(expired.id, "FAILED");
    accountMode = "apiKey";
    const invalidMode = await start(), invalidLogin = logins.at(-1)!;
    invalidLogin.resolve({ loginId: invalidLogin.loginId, success: true }); await settle(invalidMode.id, "FAILED");
    assert.equal(await db.chatgptAccount.count(), 0); accountMode = "chatgpt";
    const good = await start(); const goodLogin = logins.at(-1)!;
    goodLogin.resolve({ loginId: goodLogin.loginId, success: true }); const completed = await settle(good.id, "COMPLETE");
    assert.equal((await call(`/chatgpt/device/${good.id}`)).json().userCode, "");
    const id = completed.resultAccountId!;
    const stored = await db.chatgptAccount.findUniqueOrThrow({ where: { id } });
    assert.equal(stored.provider, "device"); assert.equal(stored.creditsConfirmed, false); assert.ok(!stored.encryptedTokens!.includes("private-device-token"));
    const visible = await call("/chatgpt"); assert.ok(!visible.body.includes("private-device-token")); assert.equal(visible.json().accounts[0].provider, "device");
    assert.equal((await photo()).statusCode, 403); config.chatgpt.creditsDisabledConfirmed = true;
    assert.equal((await photo()).statusCode, 403); assert.equal(turns, 0);
    await call(`/chatgpt/accounts/${id}/credits`, { confirmedZeroCredits: true });
    const models = await call("/chatgpt/models"); assert.equal(models.statusCode, 200, models.body); assert.equal(models.json().models.length, 1);
    limits.ordinaryUsageAllowed = null;
    assert.equal((await photo()).statusCode, 403); assert.equal(turns, 0); assert.equal((await photo()).statusCode, 409);
    await call(`/chatgpt/accounts/${id}/resume`, { reviewedUsage: true });
    limits.ordinaryUsageAllowed = true; limits.rateLimits.credits.hasCredits = true; limits.rateLimits.credits.balance = "20";
    assert.equal((await photo()).statusCode, 403); assert.equal(turns, 0);
    await call(`/chatgpt/accounts/${id}/resume`, { reviewedUsage: true });
    limits.rateLimits.credits.hasCredits = false; limits.rateLimits.credits.balance = "0";
    const preview = await photo(); assert.equal(preview.statusCode, 200, preview.body); assert.equal(preview.json().draft.title, "Device-Rezept"); assert.equal(preview.json().draft.visibility, "PRIVATE");
    assert.equal(await db.recipe.count(), 0); assert.equal(turns, 1);
    failedTurn = true; assert.equal((await photo()).statusCode, 500); assert.equal((await call("/chatgpt")).json().accounts[0].blocked, true); failedTurn = false;
    await call(`/chatgpt/accounts/${id}/resume`, { reviewedUsage: true });
    let release!: () => void; pause = new Promise<void>(r => { release = r; }); const beforeTurn = turns, pending = photo();
    while (turns === beforeTurn) await new Promise(r => setTimeout(r, 10));
    const disconnected = await call(`/chatgpt/accounts/${id}`, undefined, owner, "DELETE"); assert.equal(disconnected.statusCode, 200, disconnected.body);
    release(); assert.equal((await pending).statusCode, 200); pause = null;
    assert.equal((await db.chatgptAccount.findUniqueOrThrow({ where: { id } })).encryptedTokens, null);
    assert.ok(closed > 5);
  } finally { await app.close(); await db.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});
