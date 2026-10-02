import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../../server/app";
import { hashToken } from "../../server/lib/password";
import { readConfig } from "../../server/lib/config";
const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/rezeptdatenbank_test"))
  throw new Error(
    "Integrationstests brauchen eine getrennte rezeptdatenbank_test-Datenbank.",
  );
test("MariaDB integration: bootstrap, sessions, CSRF, household isolation, profile and password revocation", async () => {
  const db = new PrismaClient();
  const config = readConfig({
    ...process.env,
    APP_ORIGIN: "http://test.local",
    LOG_LEVEL: "silent",
    REGISTRATION_ENABLED: "true",
    COOKIE_SECURE: "false",
  });
  const app = await buildApp(db, config);
  const origin = { origin: config.origin };
  const account = {
    name: "Test Admin",
    email: "admin@example.test",
    password: "first-test-password-long",
    householdName: "Haushalt A",
    setupToken: config.setupToken,
  };
  try {
    assert.equal(
      (await app.inject({ method: "GET", url: "/api/v1/health/ready" }))
        .statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ method: "GET", url: "/api/v1/auth/me" })).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/setup",
          payload: account,
          headers: { origin: "http://evil.local" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/setup",
          payload: { ...account, setupToken: "z".repeat(64) },
          headers: origin,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/setup",
          payload: { ...account, password: "weak" },
          headers: origin,
        })
      ).statusCode,
      400,
    );
    const setup = await app.inject({
      method: "POST",
      url: "/api/v1/auth/setup",
      payload: account,
      headers: origin,
    });
    assert.equal(setup.statusCode, 201, setup.body);
    assert.ok(!setup.body.includes("passwordHash"));
    const cookie = String(setup.headers["set-cookie"]).split(";")[0];
    assert.ok(String(setup.headers["set-cookie"]).includes("HttpOnly"));
    assert.ok(String(setup.headers["set-cookie"]).includes("SameSite=Lax"));
    const sessions = await db.session.findMany({
      where: { userId: setup.json().user.id },
    });
    assert.equal(sessions.length, 1);
    assert.ok(!sessions[0].tokenHash.includes(cookie.split("=")[1]));
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/setup",
          payload: account,
          headers: origin,
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { email: account.email, password: "wrong" },
          headers: origin,
        })
      ).statusCode,
      401,
    );
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: account.email, password: account.password },
      headers: origin,
    });
    assert.equal(login.statusCode, 200);
    const otherSessionCookie = String(login.headers["set-cookie"]).split(
      ";",
    )[0];
    const householdA = (
      await app.inject({
        method: "GET",
        url: "/api/v1/households",
        headers: { cookie },
      })
    ).json();
    assert.equal(householdA.households.length, 1);
    assert.equal(householdA.households[0].household.name, "Haushalt A");
    const register = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        name: "Test B",
        email: "b@example.test",
        password: "second-test-password-long",
        householdName: "Haushalt B",
      },
      headers: origin,
    });
    assert.equal(register.statusCode, 201);
    const cookieB = String(register.headers["set-cookie"]).split(";")[0];
    const householdsB = (
      await app.inject({
        method: "GET",
        url: "/api/v1/households",
        headers: { cookie: cookieB },
      })
    ).json();
    assert.equal(householdsB.households.length, 1);
    assert.equal(householdsB.households[0].household.name, "Haushalt B");
    assert.notEqual(
      householdsB.households[0].household.id,
      householdA.households[0].household.id,
    );
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/v1/auth/profile",
          payload: { name: "Changed", locale: "en" },
          headers: { ...origin, cookie },
        })
      ).statusCode,
      200,
    );
    const profile = (
      await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { cookie },
      })
    ).json();
    assert.equal(profile.user.name, "Changed");
    assert.equal(profile.user.locale, "en");
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/password",
          payload: {
            currentPassword: "wrong",
            newPassword: "third-test-password-long",
          },
          headers: { ...origin, cookie },
        })
      ).statusCode,
      403,
    );
    const changed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password",
      payload: {
        currentPassword: account.password,
        newPassword: "third-test-password-long",
      },
      headers: { ...origin, cookie },
    });
    assert.equal(changed.statusCode, 200);
    const newCookie = String(changed.headers["set-cookie"]).split(";")[0];
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/auth/me",
          headers: { cookie: otherSessionCookie },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/auth/me",
          headers: { cookie },
        })
      ).statusCode,
      401,
    );
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      payload: {},
      headers: { ...origin, cookie: newCookie },
    });
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/auth/me",
          headers: { cookie: newCookie },
        })
      ).statusCode,
      401,
    );
    const disabled = await buildApp(db, {
      ...config,
      registrationEnabled: false,
    });
    try {
      assert.equal(
        (
          await disabled.inject({
            method: "POST",
            url: "/api/v1/auth/register",
            payload: {
              name: "C",
              email: "c@example.test",
              password: "fourth-test-password-long",
            },
            headers: origin,
          })
        ).statusCode,
        403,
      );
    } finally {
      await disabled.close();
    }
    assert.ok(app.swagger().paths?.["/api/v1/auth/login"]);
    await db.session.create({
      data: {
        userId: profile.user.id,
        tokenHash: hashToken("expired"),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/auth/me",
          headers: { cookie: "session=expired" },
        })
      ).statusCode,
      401,
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});
