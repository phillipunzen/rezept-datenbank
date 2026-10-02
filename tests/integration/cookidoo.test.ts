import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { buildApp } from "../../server/app";
import { readConfig } from "../../server/lib/config";
import { hashPassword, hashToken } from "../../server/lib/password";
import { cookidooSync } from "../../server/services/cookidoo-sync";
import type {
  CookidooProvider,
  RemoteShoppingItem,
  CookidooToken,
} from "../../server/integrations/cookidoo-provider";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
if (
  !process.env.DATABASE_URL ||
  new URL(process.env.DATABASE_URL).pathname !== "/rezeptdatenbank_test"
)
  throw Error("Disposable test DB required");
test("Cookidoo consent, encrypted sessions, two-way changes, reviewed conflicts and uncertain writes", async () => {
  const db = new PrismaClient(),
    dir = await mkdtemp(join(tmpdir(), "recipe-cookidoo-"));
  const config = readConfig({
    ...process.env,
    APP_ORIGIN: "http://cookidoo.test",
    LOG_LEVEL: "silent",
    UPLOAD_DIR: dir,
    COOKIDOO_ENABLED: "true",
    COOKIDOO_ALLOW_HTTP: "true",
  });
  let rows: RemoteShoppingItem[] = [
    {
      key: "ingredient:milk",
      id: "milk",
      kind: "ingredient",
      name: "Milch",
      description: "200 ml",
      preparation: "",
      checked: false,
    },
  ];
  let beforeRead: (() => Promise<void>) | null = null,
    readCalls = 0;
  let sequence = 0,
    createCalls = 0,
    loginCalls = 0,
    applyCalls = 0,
    failCreate: "before" | "after" | null = null,
    conflictNext = false,
    afterApply: (() => Promise<void>) | null = null;
  const tokens: CookidooToken = {
    access_token: "secret-access",
    refresh_token: "secret-refresh",
    expires_at: Date.now() / 1000 + 3600,
  };
  const provider: CookidooProvider = {
    async call(request) {
      const response = () => ({
        ok: true,
        tokens: { ...tokens },
        items: structuredClone(rows),
        created: [] as RemoteShoppingItem[],
      });
      if (request.operation === "login") {
        loginCalls++;
        return response();
      }
      if (request.operation === "read") {
        readCalls++;
        const hook = beforeRead;
        beforeRead = null;
        if (hook) await hook();
        return response();
      }
      applyCalls++;
      const action = request.action!,
        current = rows.find((r) => r.key === action.remoteKey);
      if (conflictNext) {
        conflictNext = false;
        return { ok: false, code: "CONFLICT", tokens };
      }
      if (
        action.expected &&
        JSON.stringify(current) !== JSON.stringify(action.expected)
      )
        return { ok: false, code: "CONFLICT", tokens };
      let created: RemoteShoppingItem[] = [];
      if (action.type === "create") {
        createCalls++;
        if (failCreate === "before") {
          failCreate = null;
          return { ok: false, code: "UNAVAILABLE", tokens };
        }
        const id = "extra" + ++sequence;
        const item: RemoteShoppingItem = {
          key: "additional:" + id,
          kind: "additional",
          id,
          name: action.name!,
          description: "",
          preparation: "",
          checked: action.checked!,
        };
        rows.push(item);
        created = [structuredClone(item)];
        if (failCreate === "after") {
          failCreate = null;
          return { ok: false, code: "UNAVAILABLE", tokens };
        }
      } else if (action.type === "delete")
        rows = rows.filter((r) => r !== current);
      else {
        assert.ok(current);
        if (current.kind === "ingredient")
          assert.equal(action.name, current.name);
        current.name = action.name!;
        current.checked = action.checked!;
      }
      const hook = afterApply;
      afterApply = null;
      if (hook) await hook();
      return { ...response(), created };
    },
  };
  const app = await buildApp(db, config, { cookidooProvider: provider }),
    service = cookidooSync(db, config, provider);
  let actorSequence = 0;
  async function account(
    role: "OWNER" | "EDITOR" | "VIEWER",
    householdId?: string,
  ) {
    const token = randomBytes(32).toString("hex");
    const user = await db.user.create({
      data: {
        name: role,
        email: randomBytes(8).toString("hex") + "@cookidoo.test",
        passwordHash: await hashPassword("test-password-long"),
        memberships: {
          create: {
            role,
            household: householdId
              ? { connect: { id: householdId } }
              : { create: { name: "Cookidoo test" } },
          },
        },
      },
      include: { memberships: true },
    });
    await db.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    return {
      ip: "127.0.0." + ++actorSequence,
      id: user.id,
      householdId: user.memberships[0].householdId,
      headers: { cookie: `session=${token}`, origin: config.origin },
    };
  }
  const owner = await account("OWNER"),
    viewer = await account("VIEWER", owner.householdId),
    other = await account("EDITOR", owner.householdId),
    outsider = await account("OWNER");
  async function req(
    actor: typeof owner,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    payload?: object,
    status = 200,
  ) {
    const response = await app.inject({
      method,
      url: "/api/v1" + path,
      headers: actor.headers,
      remoteAddress: actor.ip,
      payload,
    });
    assert.equal(response.statusCode, status, response.body);
    return response.json();
  }
  const list = await db.shoppingList.create({
    data: {
      householdId: owner.householdId,
      creatorId: owner.id,
      name: "Market",
    },
  });
  const add = (name: string, amount: string | null = null, unit = "") =>
    db.shoppingListItem.create({
      data: {
        listId: list.id,
        name,
        amount,
        unit,
        note: "",
        mergeKey: name + "|" + unit,
      },
    });
  const flour = await add("Mehl", "100", "g");
  const body = {
    householdId: owner.householdId,
    listId: list.id,
    email: "cookidoo@example.test",
    password: "never-store-this-password",
    market: "de",
    confirmedSharing: true,
    confirmedHttp: true,
  };
  try {
    await req(viewer, "POST", "/cookidoo/connect", body, 403);
    await req(outsider, "POST", "/cookidoo/connect", body, 404);
    assert.equal(loginCalls, 0);
    const bad = { ...body };
    delete (bad as Partial<typeof body>).confirmedSharing;
    await req(owner, "POST", "/cookidoo/connect", bad, 400);
    const httpsOnly = await buildApp(
      db,
      { ...config, cookidooAllowHttp: false },
      { cookidooProvider: provider },
    );
    const blocked = await httpsOnly.inject({
      method: "POST",
      url: "/api/v1/cookidoo/connect",
      headers: owner.headers,
      payload: body,
    });
    assert.equal(blocked.statusCode, 400);
    await httpsOnly.close();
    assert.equal(loginCalls, 0);
    let connection = (await req(owner, "POST", "/cookidoo/connect", body))
      .connection;
    assert.equal(connection.status, "PENDING");
    assert.equal(connection.report.remoteCount, 1);
    assert.equal(connection.report.localCount, 1);
    const stored = await db.cookidooConnection.findUniqueOrThrow({
      where: { userId: owner.id },
    });
    assert.ok(!stored.encryptedTokens.includes(tokens.access_token));
    assert.ok(!JSON.stringify(stored).includes(body.password));
    assert.equal(
      (await stat(join(dir, ".cookidoo-encryption-key"))).mode & 0o777,
      0o600,
    );
    assert.equal(
      (await readFile(join(dir, ".cookidoo-encryption-key"), "utf8")).length,
      64,
    );
    assert.equal((await req(other, "GET", "/cookidoo")).connection, null);
    await req(other, "POST", "/cookidoo/connect", body, 409);
    await req(owner, "POST", "/cookidoo/sync", {}, 409);
    assert.equal(applyCalls, 0);
    await req(owner, "PATCH", "/cookidoo", {
      paused: false,
      revision: connection.revision,
      confirmedBidirectional: true,
    });
    await service.process(connection.id);
    assert.equal(createCalls, 1);
    assert.equal(
      await db.shoppingListItem.count({ where: { listId: list.id } }),
      2,
    );
    assert.equal(
      await db.cookidooItemLink.count({
        where: { connectionId: connection.id },
      }),
      2,
    );
    let flourRemote = rows.find((r) => r.name === "100 g Mehl")!;
    assert.ok(flourRemote);
    await db.shoppingListItem.update({
      where: { id: flour.id },
      data: { checked: true },
    });
    flourRemote.name = "200 g Mehl";
    await service.process(connection.id);
    let local = await db.shoppingListItem.findUniqueOrThrow({
      where: { id: flour.id },
    });
    assert.equal(local.amount?.toString(), "200");
    assert.equal(local.checked, true);
    assert.equal(flourRemote.checked, true);
    // Both sides changed to the same value: checkpoint baselines, then a single-side change remains safe.
    await db.shoppingListItem.update({
      where: { id: flour.id },
      data: { amount: "300" },
    });
    flourRemote.name = "300 g Mehl";
    await service.process(connection.id);
    flourRemote.name = "400 g Mehl";
    await service.process(connection.id);
    assert.equal(
      (
        await db.shoppingListItem.findUniqueOrThrow({ where: { id: flour.id } })
      ).amount?.toString(),
      "400",
    );
    await db.shoppingListItem.update({
      where: { id: flour.id },
      data: { amount: "500" },
    });
    flourRemote.name = "600 g Mehl";
    await service.process(connection.id);
    connection = (await req(owner, "GET", "/cookidoo")).connection;
    assert.equal(connection.status, "CONFLICT");
    let conflict = connection.report.conflicts[0];
    assert.equal(conflict.reason, "BOTH_CHANGED");
    await req(owner, "POST", "/cookidoo/resolve", {
      conflictId: conflict.id,
      choice: "REMOTE",
      revision: connection.revision,
    });
    await db.shoppingListItem.update({
      where: { id: flour.id },
      data: { amount: "550" },
    });
    await service.next();
    connection = (await req(owner, "GET", "/cookidoo")).connection;
    assert.equal(connection.report.conflicts[0].reason, "RESOLUTION_STALE");
    assert.equal(
      (
        await db.shoppingListItem.findUniqueOrThrow({ where: { id: flour.id } })
      ).amount?.toString(),
      "550",
    );
    await req(owner, "POST", "/cookidoo/resolve", {
      conflictId: conflict.id,
      choice: "REMOTE",
      revision: connection.revision,
    });
    await service.next();
    assert.equal(
      (
        await db.shoppingListItem.findUniqueOrThrow({ where: { id: flour.id } })
      ).amount?.toString(),
      "600",
    );
    const milk = await db.shoppingListItem.findFirstOrThrow({
      where: { listId: list.id, name: "Milch" },
    });
    await db.shoppingListItem.update({
      where: { id: milk.id },
      data: { checked: true },
    });
    await service.process(connection.id);
    assert.equal(rows[0].checked, true);
    await db.shoppingListItem.update({
      where: { id: milk.id },
      data: { name: "Hafermilch" },
    });
    await service.process(connection.id);
    connection = (await req(owner, "GET", "/cookidoo")).connection;
    conflict = connection.report.conflicts[0];
    assert.equal(conflict.reason, "INGREDIENT_READONLY");
    assert.equal(conflict.allowLocal, false);
    await req(
      owner,
      "POST",
      "/cookidoo/resolve",
      {
        conflictId: conflict.id,
        choice: "LOCAL",
        revision: connection.revision,
      },
      409,
    );
    await req(owner, "POST", "/cookidoo/resolve", {
      conflictId: conflict.id,
      choice: "UNLINK",
      revision: connection.revision,
    });
    await service.next();
    assert.equal(
      (await db.shoppingListItem.findUniqueOrThrow({ where: { id: milk.id } }))
        .name,
      "Hafermilch",
    );
    assert.equal(rows[0].name, "Milch");
    // Deletions in both directions affect only additional items, never whole recipe ingredient groups.
    rows = rows.filter((r) => r.key !== flourRemote.key);
    await service.process(connection.id);
    assert.equal(
      await db.shoppingListItem.findUnique({ where: { id: flour.id } }),
      null,
    );
    const bread = await add("Brot");
    await service.process(connection.id);
    assert.ok(rows.some((r) => r.name === "Brot"));
    await db.shoppingListItem.delete({ where: { id: bread.id } });
    await service.process(connection.id);
    assert.ok(!rows.some((r) => r.name === "Brot"));
    const eggs = await add("Eier", "2", "");
    await service.process(connection.id);
    assert.ok(rows.some((r) => r.name === "[2] Eier"));
    assert.equal((await service.get(owner.id))?.status, "ACTIVE");
    // A known precondition rejection cannot have written and must not leave an uncertain intent.
    await db.shoppingListItem.update({
      where: { id: eggs.id },
      data: { checked: true },
    });
    conflictNext = true;
    await service.process(connection.id);
    assert.equal(
      (
        await db.cookidooConnection.findUniqueOrThrow({
          where: { id: connection.id },
        })
      ).pendingJson,
      null,
    );
    await service.process(connection.id);
    assert.ok(rows.find((r) => r.name === "[2] Eier")?.checked);
    // Lost creation response: recover exactly one actual new item without another create request.
    // Removing a local row while its first remote creation completes must not create a dangling FK.
    const removed = await add("Kurzlebig");
    afterApply = () =>
      db.shoppingListItem.delete({ where: { id: removed.id } }).then(() => {});
    await service.process(connection.id);
    assert.ok(!rows.some((r) => r.name === "Kurzlebig"));
    assert.equal((await service.get(owner.id))!.status, "ACTIVE");
    const lemon = await add("Zitrone");
    failCreate = "after";
    const before = createCalls;
    await service.process(connection.id);
    connection = (await service.get(owner.id))!;
    assert.equal(connection.status, "UNKNOWN");
    assert.equal(connection.paused, true);
    assert.equal(createCalls, before + 1);
    await service.process(connection.id, true);
    assert.equal(createCalls, before + 1);
    assert.equal(rows.filter((r) => r.name === "Zitrone").length, 1);
    assert.equal(
      await db.cookidooItemLink.count({ where: { localItemId: lemon.id } }),
      1,
    );
    await service.activate(
      owner.id,
      false,
      (await service.get(owner.id))!.revision,
    );
    // A local edit during the remote write remains untouched and becomes a reviewed conflict.
    const lemonRemote = rows.find((r) => r.name === "Zitrone")!;
    await db.shoppingListItem.update({
      where: { id: lemon.id },
      data: { name: "Limette" },
    });
    afterApply = () =>
      db.shoppingListItem
        .update({ where: { id: lemon.id }, data: { name: "Orange" } })
        .then(() => {});
    await service.process(connection.id);
    assert.equal(
      (await db.shoppingListItem.findUniqueOrThrow({ where: { id: lemon.id } }))
        .name,
      "Orange",
    );
    assert.equal(lemonRemote.name, "Limette");
    assert.equal(
      (await service.get(owner.id))!.report!.conflicts[0].reason,
      "BOTH_CHANGED",
    );
    // Two workers cannot claim the same connection while a remote read is in flight.
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>((r) => (release = r)),
      started = new Promise<void>((r) => (entered = r));
    beforeRead = () => {
      entered();
      return held;
    };
    const reads = readCalls;
    const first = service.process(connection.id);
    await started;
    await service.process(connection.id);
    release();
    await first;
    assert.equal(readCalls, reads + 1);
    // Unknown creation before any remote write stays paused and is never blindly retried.
    await add("Unklar");
    failCreate = "before";
    const tries = createCalls;
    await service.process(connection.id);
    assert.equal((await service.get(owner.id))!.status, "UNKNOWN");
    await service.process(connection.id, true);
    assert.equal(createCalls, tries + 1);
    assert.ok(!rows.some((r) => r.name === "Unklar"));
    const writes = applyCalls;
    await db.accountStatus.create({
      data: { userId: owner.id, disabled: true },
    });
    await service.process(connection.id, true);
    assert.equal(applyCalls, writes);
    await db.accountStatus.update({
      where: { userId: owner.id },
      data: { disabled: false },
    });
    await db.householdMember.update({
      where: {
        householdId_userId: {
          householdId: owner.householdId,
          userId: owner.id,
        },
      },
      data: { role: "VIEWER" },
    });
    await service.process(connection.id, true);
    assert.equal(applyCalls, writes);
    await req(owner, "DELETE", "/cookidoo");
    assert.equal(
      await db.cookidooConnection.findUnique({ where: { userId: owner.id } }),
      null,
    );
    assert.ok(rows.length > 0);
    assert.ok(
      (await db.shoppingListItem.count({ where: { listId: list.id } })) > 0,
    );
  } finally {
    await app.close();
    await db.$disconnect();
    await rm(dir, { recursive: true, force: true });
  }
});
