import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  safeTokenEqual,
  hashToken,
} from "../server/lib/password";
import { readConfig } from "../server/lib/config";
test("password hashing uses random salts and validates without storing plaintext", async () => {
  const password = "ein-langes-Testpasswort";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.ok(!first.includes(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("falsch", first), false);
  assert.equal(await verifyPassword(password, "corrupt"), false);
  assert.equal(
    await verifyPassword(
      password,
      "scrypt-v1:" + "a".repeat(32) + ":" + "x".repeat(128),
    ),
    false,
  );
});
test("session/setup tokens are hashed and checked by full value", () => {
  assert.equal(hashToken("session").length, 64);
  assert.equal(safeTokenEqual("a", "a"), true);
  assert.equal(safeTokenEqual("a", "ab"), false);
});
test("external MariaDB configuration is mandatory and secure cookies follow HTTPS", () => {
  const base = {
    DATABASE_URL: "mysql://user:pass@external-db:3306/recipes",
    INITIAL_SETUP_TOKEN: "x".repeat(64),
    APP_ORIGIN: "https://recipes.example.com",
  };
  const config = readConfig(base);
  assert.equal(config.origin, base.APP_ORIGIN);
  assert.equal(config.secureCookie, true);
  assert.equal(config.registrationEnabled, false);
  assert.throws(() => readConfig({ ...base, DATABASE_URL: "sqlite:data.db" }));
  assert.throws(() => readConfig({ ...base, INITIAL_SETUP_TOKEN: "short" }));
  assert.throws(() => readConfig({ ...base, REGISTRATION_ENABLED: "yes" }));
  assert.throws(() => readConfig({ ...base, COOKIE_SECURE: "false" }));
});

test("OIDC email verification can be explicitly disabled with a validated boolean", () => {
  const env = {
    DATABASE_URL: "mysql://user:pass@external-db:3306/recipes",
    INITIAL_SETUP_TOKEN: "x".repeat(64),
    OIDC_ISSUER: "https://auth.example.test/application/o/recipes/",
    OIDC_CLIENT_ID: "recipes",
  };
  assert.equal(readConfig(env).oidc!.requireEmailVerified, true);
  assert.equal(readConfig({ ...env, OIDC_REQUIRE_EMAIL_VERIFIED: "false" }).oidc!.requireEmailVerified, false);
  assert.throws(() => readConfig({ ...env, OIDC_REQUIRE_EMAIL_VERIFIED: "no" }));
});
