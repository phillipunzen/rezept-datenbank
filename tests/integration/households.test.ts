import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PrismaClient, type HouseholdRole } from "@prisma/client";
import { buildApp } from "../../server/app";
import { readConfig } from "../../server/lib/config";
import { hashToken, hashPassword } from "../../server/lib/password";
import type { HouseholdDetail } from "../../shared/households";
if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("/rezeptdatenbank_test")
)
  throw new Error("Nur in der separaten Testdatenbank ausführen.");
test("households and invitations protect roles, last owners, one-time tokens and registration", async () => {
  const db = new PrismaClient();
  const config = readConfig({
    ...process.env,
    APP_ORIGIN: "http://sharing.test",
    LOG_LEVEL: "silent",
    REGISTRATION_ENABLED: "false",
  });
  const app = await buildApp(db, config);
  const passwordHash = await hashPassword("sharing-test-password-long");
  async function account(
    role: HouseholdRole,
    householdId?: string,
    isAdmin = false,
  ) {
    const token = randomBytes(32).toString("hex");
    const user = await db.user.create({
      data: {
        name: role,
        email: `${randomBytes(8).toString("hex")}@example.test`,
        passwordHash,
        isAdmin,
        memberships: {
          create: {
            role,
            ...(householdId
              ? { household: { connect: { id: householdId } } }
              : { household: { create: { name: "Testküche" } } }),
          },
        },
      },
      include: { memberships: true },
    });
    await db.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 180000),
      },
    });
    return {
      id: user.id,
      email: user.email,
      householdId: user.memberships[0].householdId,
      cookie: `session=${token}`,
    };
  }
  type Actor = Awaited<ReturnType<typeof account>>;
  const owner = await account("OWNER");
  const admin = await account("ADMIN", owner.householdId);
  const viewer = await account("VIEWER", owner.householdId);
  const outsider = await account("OWNER", undefined, true);
  const request = (
    actor: Actor | null,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url,
      payload,
      headers: {
        origin: config.origin,
        ...(actor ? { cookie: actor.cookie } : {}),
      },
    });
  async function detail(actor = owner) {
    const result = await request(
      actor,
      "GET",
      `/api/v1/households/${owner.householdId}`,
    );
    assert.equal(result.statusCode, 200, result.body);
    return result.json().household as HouseholdDetail;
  }
  async function invite(email: string, role = "EDITOR", actor = owner) {
    const result = await request(
      actor,
      "POST",
      `/api/v1/households/${owner.householdId}/invitations`,
      { email, role, revision: (await detail(actor)).revision },
    );
    assert.equal(result.statusCode, 201, result.body);
    const invitation = result.json().invitation;
    return {
      ...invitation,
      token: new URL(invitation.link).hash.slice("#invite=".length),
    } as { id: string; token: string; link: string };
  }
  try {
    assert.equal(
      (await request(null, "POST", "/api/v1/households", { name: "No" }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await request(
          outsider,
          "GET",
          `/api/v1/households/${owner.householdId}`,
        )
      ).statusCode,
      404,
      "Global admin does not bypass membership",
    );
    assert.equal(
      (await request(owner, "POST", "/api/v1/households", { name: "  " }))
        .statusCode,
      400,
    );
    const created = await request(viewer, "POST", "/api/v1/households", {
      name: "Meine Küche",
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().household.role, "OWNER");
    const viewerDetail = await detail(viewer);
    assert.equal(viewerDetail.canManage, false);
    assert.equal(viewerDetail.members[0].email, undefined);
    assert.deepEqual(viewerDetail.invitations, []);
    const base = `/api/v1/households/${owner.householdId}`;
    assert.equal(
      (
        await request(viewer, "PATCH", base, {
          name: "No",
          revision: viewerDetail.revision,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await request(admin, "PATCH", `${base}/members/${owner.id}`, {
          role: "VIEWER",
          revision: viewerDetail.revision,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await request(admin, "PATCH", `${base}/members/${admin.id}`, {
          role: "OWNER",
          revision: viewerDetail.revision,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await request(owner, "POST", `${base}/leave`, {
          revision: viewerDetail.revision,
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await request(owner, "PATCH", `${base}/members/${owner.id}`, {
          role: "ADMIN",
          revision: viewerDetail.revision,
        })
      ).statusCode,
      409,
    );
    const renamed = await request(admin, "PATCH", base, {
      name: "Gemeinsame Küche",
      revision: viewerDetail.revision,
    });
    assert.equal(renamed.statusCode, 200);
    assert.equal(
      (
        await request(owner, "PATCH", base, {
          name: "Alt",
          revision: viewerDetail.revision,
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await request(admin, "POST", `${base}/invitations`, {
          email: "x@example.test",
          role: "ADMIN",
          revision: (await detail()).revision,
        })
      ).statusCode,
      403,
    );
    const newEmail = `${randomBytes(8).toString("hex")}@example.test`;
    const invitation = await invite(newEmail);
    const stored = await db.householdInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    assert.equal(stored.tokenHash, hashToken(invitation.token));
    assert.notEqual(stored.tokenHash, invitation.token);
    assert.ok(!JSON.stringify(await detail()).includes(invitation.token));
    const preview = await request(
      null,
      "POST",
      "/api/v1/household-invitations/preview",
      { token: invitation.token },
    );
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.json().email, newEmail);
    assert.equal(
      (
        await request(
          outsider,
          "POST",
          "/api/v1/household-invitations/accept",
          { token: invitation.token },
        )
      ).statusCode,
      403,
    );
    const registered = await request(
      null,
      "POST",
      "/api/v1/household-invitations/register",
      {
        token: invitation.token,
        email: newEmail,
        name: "Gast",
        password: "new-invited-account-password",
      },
    );
    assert.equal(registered.statusCode, 201, registered.body);
    assert.equal(registered.json().user.isAdmin, false);
    assert.equal(
      await db.householdMember.count({
        where: { userId: registered.json().user.id },
      }),
      1,
      "Invite-only registration joins just the invited household",
    );
    assert.match(String(registered.headers["set-cookie"]), /HttpOnly/);
    assert.equal(
      (
        await request(null, "POST", "/api/v1/household-invitations/preview", {
          token: invitation.token,
        })
      ).statusCode,
      410,
    );
    assert.equal(
      (
        await request(null, "POST", "/api/v1/auth/register", {
          email: "blocked@example.test",
          name: "No",
          password: "long-blocked-password",
        })
      ).statusCode,
      403,
    );
    const existing = await invite(outsider.email, "VIEWER");
    const accepted = await request(
      outsider,
      "POST",
      "/api/v1/household-invitations/accept",
      { token: existing.token },
    );
    assert.equal(accepted.statusCode, 200);
    assert.equal((await detail(outsider)).role, "VIEWER");
    assert.equal(
      (
        await request(
          outsider,
          "POST",
          "/api/v1/household-invitations/accept",
          { token: existing.token },
        )
      ).statusCode,
      410,
    );
    const revoked = await invite(
      `${randomBytes(8).toString("hex")}@example.test`,
      "ADMIN",
    );
    assert.equal(
      (
        await request(
          admin,
          "DELETE",
          `${base}/invitations/${revoked.id}?revision=${(await detail()).revision}`,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await request(
          owner,
          "DELETE",
          `${base}/invitations/${revoked.id}?revision=${(await detail()).revision}`,
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await request(null, "POST", "/api/v1/household-invitations/preview", {
          token: revoked.token,
        })
      ).statusCode,
      410,
    );
    const expired = await invite(
      `${randomBytes(8).toString("hex")}@example.test`,
    );
    await db.householdInvitation.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(0) },
    });
    assert.equal(
      (
        await request(null, "POST", "/api/v1/household-invitations/preview", {
          token: expired.token,
        })
      ).statusCode,
      410,
    );
    const adminInvite = await invite(
      `${randomBytes(8).toString("hex")}@example.test`,
      "EDITOR",
      admin,
    );
    assert.equal(
      (
        await request(owner, "PATCH", `${base}/members/${admin.id}`, {
          role: "VIEWER",
          revision: (await detail()).revision,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await request(null, "POST", "/api/v1/household-invitations/preview", {
          token: adminInvite.token,
        })
      ).statusCode,
      410,
      "Demotion revokes pending invitations issued by that member",
    );
    const raceEmail = `${randomBytes(8).toString("hex")}@example.test`;
    const raceInvite = await invite(raceEmail);
    const race = await Promise.all(
      [1, 2].map(() =>
        request(null, "POST", "/api/v1/household-invitations/register", {
          token: raceInvite.token,
          email: raceEmail,
          name: "Race",
          password: "race-invited-password-long",
        }),
      ),
    );
    assert.deepEqual(race.map((r) => r.statusCode).sort(), [201, 410]);
    assert.equal(await db.user.count({ where: { email: raceEmail } }), 1);
    assert.equal(
      (
        await request(owner, "PATCH", `${base}/members/${admin.id}`, {
          role: "OWNER",
          revision: (await detail()).revision,
        })
      ).statusCode,
      200,
    );
    const revision = (await detail()).revision;
    const ownerRace = await Promise.all(
      [owner, admin].map((actor) =>
        request(actor, "PATCH", `${base}/members/${actor.id}`, {
          role: "VIEWER",
          revision,
        }),
      ),
    );
    assert.deepEqual(ownerRace.map((r) => r.statusCode).sort(), [200, 409]);
    assert.equal(
      await db.householdMember.count({
        where: { householdId: owner.householdId, role: "OWNER" },
      }),
      1,
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});
