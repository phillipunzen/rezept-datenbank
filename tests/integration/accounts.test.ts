import test from "node:test";
import assert from "node:assert/strict";
import {
  randomBytes,
  generateKeyPairSync,
  sign,
  createHash,
} from "node:crypto";
import { SMTPServer } from "smtp-server";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../../server/app";
import { readConfig } from "../../server/lib/config";
import {
  hashPassword,
  hashToken,
  verifyPassword,
} from "../../server/lib/password";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp from "sharp";
if (!process.env.DATABASE_URL?.endsWith("/rezeptdatenbank_test"))
  throw Error("Disposable DB required");
test("SMTP resets are single-use, revoke sessions; admin guards, avatar, audit and OIDC are isolated", async () => {
  const messages: string[] = [];
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS", "AUTH"],
    onData(stream, _session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => {
        messages.push(Buffer.concat(chunks).toString());
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => smtp.listen(0, "127.0.0.1", resolve));
  const port = (smtp.server.address() as { port: number }).port,
    uploadDir = await mkdtemp(tmpdir() + "/recipe-accounts-");
  const db = new PrismaClient(),
    config = readConfig({
      ...process.env,
      APP_ORIGIN: "http://accounts.test",
      LOG_LEVEL: "silent",
      UPLOAD_DIR: uploadDir,
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(port),
      SMTP_FROM: "recipes@example.test",
      SMTP_REQUIRE_TLS: "false",
      OIDC_ISSUER: "https://provider.test/application/o/rezeptdatenbank/",
      OIDC_LABEL: "Mit Authentik anmelden",
      OIDC_CLIENT_ID: "recipe-client",
      OIDC_CLIENT_SECRET: "test-secret",
      OIDC_REGISTRATION_ENABLED: "true",
    });
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 }),
    jwk = {
      ...keys.publicKey.export({ format: "jwk" }),
      kid: "test-key",
      use: "sig",
      alg: "RS256",
    };
  const grants = new Map<
    string,
    {
      nonce: string;
      challenge: string;
      email: string;
      subject: string;
      verified: boolean;
    }
  >();
  const app = await buildApp(db, config, {
    oidcFetch: async (url, options) => {
      const path = new URL(String(url)).pathname;
      if (
        path === "/application/o/rezeptdatenbank/.well-known/openid-configuration"
      )
        return Response.json({
          issuer: config.oidc!.issuer,
          authorization_endpoint: "https://provider.test/application/o/authorize/",
          token_endpoint: "https://provider.test/application/o/token/",
          jwks_uri: "https://provider.test/application/o/rezeptdatenbank/jwks/",
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
        });
      if (path === "/application/o/rezeptdatenbank/jwks/")
        return Response.json({ keys: [jwk] });
      if (path === "/application/o/token/") {
        const body = new URLSearchParams(String(options.body)),
          code = body.get("code")!,
          grant = grants.get(code);
        assert.ok(grant);
        assert.equal(body.get("client_id"), "recipe-client");
        assert.equal(body.get("client_secret"), "test-secret");
        grants.delete(code);
        assert.equal(
          createHash("sha256")
            .update(body.get("code_verifier")!)
            .digest("base64url"),
          grant.challenge,
        );
        const header = Buffer.from(
            JSON.stringify({ alg: "RS256", kid: "test-key" }),
          ).toString("base64url"),
          payload = Buffer.from(
            JSON.stringify({
              iss: config.oidc!.issuer,
              aud: "recipe-client",
              sub: grant.subject,
              nonce: grant.nonce,
              email: grant.email,
              email_verified: grant.verified,
              name: "SSO User",
              iat: Math.floor(Date.now() / 1000),
              exp: Math.floor(Date.now() / 1000) + 300,
            }),
          ).toString("base64url");
        const signed = header + "." + payload;
        const signature = sign(
          "RSA-SHA256",
          Buffer.from(signed),
          keys.privateKey,
        ).toString("base64url");
        return Response.json({
          access_token: "test-access",
          token_type: "Bearer",
          expires_in: 300,
          id_token: signed + "." + signature,
        });
      }
      throw Error("Unexpected provider URL");
    },
  });
  const password = "account-test-password-long";
  async function account(isAdmin: boolean) {
    const token = randomBytes(32).toString("hex"),
      user = await db.user.create({
        data: {
          email: randomBytes(8).toString("hex") + "@accounts.test",
          name: "Account",
          isAdmin,
          passwordHash: await hashPassword(password),
        },
      });
    await db.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    return {
      user,
      headers: { cookie: "session=" + token, origin: config.origin },
    };
  }
  const first = await account(true),
    second = await account(false);
  await db.bootstrapLock.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
  const inject = (
    method: "POST" | "GET" | "PATCH" | "DELETE",
    path: string,
    payload?: object,
    headers = first.headers,
  ) => app.inject({ method, url: "/api/v1" + path, payload, headers });
  try {
    const reset = await inject("POST", "/auth/reset/request", {
      email: second.user.email,
    });
    assert.equal(reset.statusCode, 200, reset.body);
    assert.equal(messages.length, 1);
    const decoded = messages[0].replace(/=\r?\n/g, "").replace(/=3D/g, "=");
    const token = decoded.match(/#reset=([a-f0-9]{64})/)![1];
    assert.ok(
      !JSON.stringify(await db.passwordReset.findMany()).includes(token),
    );
    const confirm = await inject("POST", "/auth/reset/confirm", {
      token,
      password: "new-reset-password-long",
    });
    assert.equal(confirm.statusCode, 200, confirm.body);
    assert.equal(
      await db.session.count({ where: { userId: second.user.id } }),
      0,
    );
    assert.ok(
      await verifyPassword(
        "new-reset-password-long",
        (await db.user.findUniqueOrThrow({ where: { id: second.user.id } }))
          .passwordHash,
      ),
    );
    assert.equal(
      (
        await inject("POST", "/auth/reset/confirm", {
          token,
          password: "another-password-long",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await inject("PATCH", "/admin/users/" + first.user.id, {
          disabled: true,
          isAdmin: true,
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await inject("PATCH", "/admin/users/" + second.user.id, {
          disabled: false,
          isAdmin: true,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await inject("PATCH", "/admin/users/" + second.user.id, {
          disabled: true,
          isAdmin: true,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await inject("POST", "/auth/login", {
          email: second.user.email,
          password: "new-reset-password-long",
        })
      ).statusCode,
      401,
    );
    assert.ok(
      (await inject("GET", "/admin/activity"))
        .json()
        .events.some(
          (event: { action: string }) =>
            event.action === "ADMIN ACCOUNT UPDATE",
        ),
    );
    const image = await sharp({
      create: { width: 5, height: 5, channels: 3, background: "#456" },
    })
      .png()
      .toBuffer();
    const boundary = "accountimage";
    const multipart = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="avatar.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      image,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const uploaded = await app.inject({
      method: "POST",
      url: "/api/v1/auth/avatar",
      headers: {
        ...first.headers,
        "content-type": "multipart/form-data; boundary=" + boundary,
      },
      payload: multipart,
    });
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    assert.equal(
      (await inject("GET", "/auth/avatar")).headers["content-type"],
      "image/webp",
    );
    assert.equal(
      (await app.inject({ url: "/api/v1/auth/avatar" })).statusCode,
      401,
    );
    await inject("DELETE", "/auth/avatar");
    assert.equal((await readdir(uploadDir)).length, 0);
    async function flow(
      email: string,
      subject: string,
      link = false,
      verified = true,
      headers = first.headers,
    ) {
      const start = await inject("POST", "/auth/oidc/start", { link }, headers);
      assert.equal(start.statusCode, 200, start.body);
      const url = new URL(start.json().url),
        state = url.searchParams.get("state")!,
        code = randomBytes(8).toString("hex");
      grants.set(code, {
        nonce: url.searchParams.get("nonce")!,
        challenge: url.searchParams.get("code_challenge")!,
        email,
        subject,
        verified,
      });
      assert.equal(url.pathname, "/application/o/authorize/");
      assert.equal(url.searchParams.get("scope"), "openid email profile");
      assert.equal(
        url.searchParams.get("redirect_uri"),
        config.origin + "/api/v1/auth/oidc/callback",
      );
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      const cookie = String(start.headers["set-cookie"]).split(";")[0];
      const callback = await app.inject({
        url: `/api/v1/auth/oidc/callback?state=${state}&code=${code}`,
        headers: { ...headers, cookie: headers.cookie + "; " + cookie },
      });
      return { callback, state, code, cookie };
    }
    const created = await flow("new-sso@accounts.test", "subject-1");
    assert.equal(
      created.callback.headers.location,
      config.origin + "/#oidc=success",
      created.callback.body,
    );
    assert.equal(
      await db.oidcIdentity.count({ where: { subject: "subject-1" } }),
      1,
    );
    const collision = await flow(first.user.email, "subject-collision");
    assert.equal(
      collision.callback.headers.location,
      config.origin + "/#authError=oidc",
    );
    assert.equal(
      await db.oidcIdentity.count({ where: { subject: "subject-collision" } }),
      0,
    );
    // Authentik 2025.10+ returns email_verified=false by default. Explicit
    // linking still identifies an existing account through its active session.
    config.oidc!.registrationEnabled = false;
    const linked = await flow(first.user.email, "subject-linked", true, false);
    assert.equal(
      linked.callback.headers.location,
      config.origin + "/#oidc=success",
    );
    assert.equal(
      (
        await db.oidcIdentity.findFirstOrThrow({
          where: { subject: "subject-linked" },
        })
      ).userId,
      first.user.id,
    );
    const replay = await app.inject({
      url: `/api/v1/auth/oidc/callback?state=${linked.state}&code=${linked.code}`,
      headers: { cookie: linked.cookie },
    });
    assert.equal(replay.headers.location, config.origin + "/#authError=oidc");
    const returning = await flow(first.user.email, "subject-linked", false, false);
    assert.equal(
      returning.callback.headers.location,
      config.origin + "/#oidc=success",
    );
    const closedRegistration = await flow("closed@accounts.test", "subject-closed");
    assert.equal(
      closedRegistration.callback.headers.location,
      config.origin + "/#authError=oidc",
    );
    assert.equal(
      await db.oidcIdentity.count({ where: { subject: "subject-closed" } }),
      0,
    );
    config.oidc!.registrationEnabled = true;
    const unverified = await flow(
      "unverified@accounts.test",
      "subject-unverified",
      false,
      false,
    );
    assert.equal(
      unverified.callback.headers.location,
      config.origin + "/#authError=oidc",
    );
    const record = await db.auditEvent.findFirstOrThrow({
      where: { actorId: first.user.id },
    });
    assert.ok(!record.action.includes(token));
  } finally {
    await app.close();
    await db.$disconnect();
    await new Promise<void>((resolve) => smtp.close(resolve));
    await rm(uploadDir, { recursive: true, force: true });
  }
});
