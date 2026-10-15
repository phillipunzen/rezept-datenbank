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
import { connectionSecrets } from "../../server/lib/connection-secrets";
import type { CodexRuntimeFactory } from "../../server/integrations/codex-runtime";

if (!process.env.DATABASE_URL?.endsWith("/rezeptdatenbank_test")) throw Error("Disposable DB required");
test("shared ChatGPT is admin-controlled, private, overrides personal accounts and fails closed on revocation, limits or owner changes", async () => {
  const db = new PrismaClient(), dir = await mkdtemp(tmpdir() + "/recipe-shared-test-"), origin = "https://shared-recipes.test";
  const config = readConfig({ ...process.env, APP_ORIGIN: origin, COOKIE_SECURE: "true", UPLOAD_DIR: dir, LOG_LEVEL: "silent", OIDC_ISSUER: "",
    CHATGPT_PHOTO_IMPORT_ENABLED: "true", CHATGPT_CREDITS_DISABLED_CONFIRMED: "true" });
  const secrets = connectionSecrets(config, "chatgpt");
  let turns = 0, quotaAllowed = true, onLimits: (() => Promise<void>) | null = null;
  const used: string[] = [];
  const factory: CodexRuntimeFactory = async auth => {
    assert.ok(auth);
    used.push(auth);
    return {
      cwd: "/isolated/work", async close() {}, async credentials() { return auth; }, drain() { return []; },
      async request(method) {
        if (method === "account/read") return { account: { type: "chatgpt", email: "admin-ai@example.test", planType: "pro" } } as any;
        if (method === "model/list") return { data: [{ model: "vision-test", displayName: "Vision", inputModalities: ["image"] }], nextCursor: null } as any;
        if (method === "account/rateLimits/read") {
          await onLimits?.();
          return { ordinaryUsageAllowed: quotaAllowed, rateLimits: { primary: { usedPercent: 10 }, credits: { hasCredits: false, unlimited: false, balance: "0" } } } as any;
        }
        if (method === "thread/start") return { thread: { id: "thread" } } as any;
        if (method === "turn/start") { turns++; return { turn: { id: "turn" } } as any; }
        if (method === "account/logout") return {} as any;
        throw Error("Unexpected method " + method);
      },
      async wait() { return { threadId: "thread", turn: { id: "turn", status: "completed", items: [{ type: "agentMessage", phase: "final_answer", text: JSON.stringify({
        title: "Zentrales Rezept", description: "", servings: 2, prepMinutes: 5, cookMinutes: 10,
        ingredients: [{ name: "Mehl", amount: "250", unit: "g", group: "", note: "" }], steps: [{ instruction: "Vermischen.", durationSeconds: null }], warnings: [],
      }) }] } }; },
    };
  };
  const app = await buildApp(db, config, { codexRuntimeFactory: factory }); await app.ready();
  async function actor(admin: boolean, role: "OWNER" | "VIEWER" = "OWNER") {
    const token = randomBytes(32).toString("hex"), household = await db.household.create({ data: { name: "Private kitchen" } });
    const user = await db.user.create({ data: { email: `${token.slice(0, 10)}@example.test`, name: "Actor", passwordHash: "test-only", isAdmin: admin,
      memberships: { create: { householdId: household.id, role } }, sessions: { create: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600000) } } } });
    return { id: user.id, householdId: household.id, cookie: "session=" + token };
  }
  const admin = await actor(true), member = await actor(false), viewer = await actor(false, "VIEWER"), otherAdmin = await actor(true);
  async function account(userId: string, authFile: string, active = true) {
    return db.chatgptAccount.create({ data: { userId, clientId: randomBytes(16).toString("hex"), provider: "device", subject: "private-subject", email: "admin-ai@example.test",
      encryptedTokens: await secrets.encrypt({ authFile }), active, creditsConfirmed: true } });
  }
  const central = await account(admin.id, "central-private-token", false), personal = await account(member.id, "member-private-token"), replacement = await account(otherAdmin.id, "replacement-private-token");
  let requestId = 0;
  function call(user: typeof admin, path: string, body?: object, method?: "GET" | "PUT" | "POST" | "DELETE", originHeader = origin) {
    return app.inject({ method: method ?? (body ? "POST" : "GET"), url: "/api/v1" + path, remoteAddress: "10.61.0." + (++requestId),
      headers: { origin: originHeader, cookie: user.cookie }, payload: body });
  }
  async function share(id: string | null, who = admin) { return call(who, "/chatgpt/shared", { accountId: id }, "PUT"); }
  const image = await sharp({ create: { width: 10, height: 10, channels: 3, background: "white" } }).jpeg().toBuffer();
  function photo(who = member, householdId = who.householdId, consent = "true") {
    const b = "shared-photo";
    return app.inject({ method: "POST", url: `/api/v1/recipe-imports/photo/preview?householdId=${householdId}&model=vision-test&consent=${consent}&keepPhoto=false`,
      remoteAddress: "10.62.0." + (++requestId), headers: { origin, cookie: who.cookie, "content-type": "multipart/form-data; boundary=" + b },
      payload: Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="recipe.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), image, Buffer.from(`\r\n--${b}--\r\n`)]) });
  }
  try {
    assert.equal((await call(member, "/chatgpt")).json().shared.enabled, false);
    assert.equal((await share(central.id, member)).statusCode, 403);
    assert.equal((await share(null, member)).statusCode, 403);
    assert.equal((await share(personal.id)).statusCode, 404);
    assert.equal((await call(admin, "/chatgpt/shared", { accountId: central.id }, "PUT", "https://evil.test")).statusCode, 403);
    assert.equal((await share(central.id)).statusCode, 200);
    const status = await call(member, "/chatgpt");
    assert.equal(status.json().shared.connected, true); assert.equal(status.json().shared.ownAccountId, null); assert.equal(status.json().canManageShared, false);
    for (const privateValue of [central.id, admin.id, "central-private-token"]) assert.ok(!status.body.includes(privateValue));
    // Personal identity belongs to this member; the administrator's identity is never returned.
    await db.chatgptAccount.update({ where: { id: personal.id }, data: { email: "member-ai@example.test" } });
    assert.ok(!(await call(member, "/chatgpt")).body.includes("admin-ai@example.test"));
    assert.equal((await call(member, "/chatgpt/models")).statusCode, 200);
    assert.equal(used.at(-1), "central-private-token");
    const preview = await photo(); assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().draft.householdId, member.householdId); assert.equal(preview.json().draft.visibility, "PRIVATE");
    assert.equal(turns, 1); assert.equal(await db.recipe.count(), 0); assert.equal(used.at(-1), "central-private-token");
    assert.equal((await photo(viewer)).statusCode, 403);
    assert.equal((await photo(member, admin.householdId)).statusCode, 404);
    assert.equal((await photo(member, member.householdId, "false")).statusCode, 400); assert.equal(turns, 1);
    for (const path of ["select", "credits", "resume"]) assert.equal((await call(member, `/chatgpt/accounts/${central.id}/${path}`, path === "credits" ? { confirmedZeroCredits: true } : path === "resume" ? { reviewedUsage: true } : {})).statusCode, 404);
    assert.equal((await call(member, `/chatgpt/accounts/${central.id}`, undefined, "DELETE")).statusCode, 404);
    // Every user's request consumes the same allowance and uses the same lease.
    await db.chatgptAccount.update({ where: { id: central.id }, data: { leaseToken: "a".repeat(64), leaseUntil: new Date(Date.now() + 60000) } });
    assert.equal((await photo()).statusCode, 409); assert.equal(turns, 1);
    await db.chatgptAccount.update({ where: { id: central.id }, data: { leaseToken: null, leaseUntil: null, creditsConfirmed: false } });
    assert.equal((await photo()).statusCode, 403); assert.equal(turns, 1);
    await db.chatgptAccount.update({ where: { id: central.id }, data: { creditsConfirmed: true } });
    config.chatgpt.creditsDisabledConfirmed = false; assert.equal((await photo()).statusCode, 403); config.chatgpt.creditsDisabledConfirmed = true;
    quotaAllowed = false; assert.equal((await photo()).statusCode, 403); assert.equal(turns, 1);
    assert.equal((await call(admin, "/chatgpt")).json().shared.blocked, true);
    assert.equal((await photo()).statusCode, 409); quotaAllowed = true;
    await call(admin, `/chatgpt/accounts/${central.id}/resume`, { reviewedUsage: true });
    onLimits = async () => { await share(null); }; // Revoked after selection but before inference.
    assert.equal((await photo()).statusCode, 409); assert.equal(turns, 1); onLimits = null;
    assert.equal((await share(central.id)).statusCode, 200);
    await db.user.update({ where: { id: admin.id }, data: { isAdmin: false } });
    assert.equal((await photo()).statusCode, 409); assert.equal((await call(member, "/chatgpt")).json().shared.connected, false);
    assert.equal((await share(null)).statusCode, 403); assert.equal(turns, 1);
    await db.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
    await db.accountStatus.create({ data: { userId: admin.id, disabled: true } });
    assert.equal((await photo()).statusCode, 409); assert.equal(turns, 1);
    await db.accountStatus.delete({ where: { userId: admin.id } });
    assert.equal((await share(replacement.id, otherAdmin)).statusCode, 200);
    assert.equal((await photo()).statusCode, 200); assert.equal(used.at(-1), "replacement-private-token");
    await call(otherAdmin, `/chatgpt/accounts/${replacement.id}`, undefined, "DELETE");
    assert.equal((await photo()).statusCode, 409); assert.equal((await call(member, "/chatgpt")).json().shared.enabled, true);
    await db.chatgptAccount.delete({ where: { id: replacement.id } });
    assert.equal((await photo()).statusCode, 409); assert.equal((await call(member, "/chatgpt")).json().shared.enabled, true);
    // An administrator must explicitly restore personal operation.
    assert.equal((await share(null, otherAdmin)).statusCode, 200);
    assert.equal((await photo()).statusCode, 200); assert.equal(used.at(-1), "member-private-token");
  } finally { await app.close(); await db.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});
