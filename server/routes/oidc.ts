import * as oidc from "openid-client";
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import type { Config } from "../lib/config";
import { authService } from "../services/auth";
import { hashPassword, hashToken } from "../lib/password";
import { RecipeError } from "../lib/errors";
export async function oidcRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  config: Config,
  customFetch?: oidc.CustomFetch,
) {
  if (!config.oidc) return;
  const settings = config.oidc,
    auth = authService(db, config),
    redirectUri = config.origin + "/api/v1/auth/oidc/callback";
  let discovery: Promise<oidc.Configuration> | undefined;
  const provider = () =>
    (discovery ??= oidc
      .discovery(
        new URL(settings.issuer),
        settings.clientId,
        settings.clientSecret,
        undefined,
        {
          timeout: 6,
          execute: [oidc.enableNonRepudiationChecks],
          ...(customFetch ? { [oidc.customFetch]: customFetch } : {}),
        },
      )
      .catch((e) => {
        discovery = undefined;
        throw e;
      }));
  const cookies = {
    path: "/api/v1/auth/oidc",
    httpOnly: true,
    secure: config.secureCookie,
    sameSite: "lax" as const,
    maxAge: 600,
  };
  app.post<{ Body: { link: boolean } }>(
    "/auth/oidc/start",
    {
      schema: {
        tags: ["OIDC"],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["link"],
          properties: { link: { type: "boolean" } },
        },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const actor = await auth.currentUser(req);
      if (req.body.link && !actor)
        throw new RecipeError(401, "Zum Verknüpfen bitte anmelden.");
      const client = await provider(),
        state = oidc.randomState(),
        nonce = oidc.randomNonce(),
        verifier = oidc.randomPKCECodeVerifier(),
        browser = randomBytes(32).toString("hex");
      await db.oidcAttempt.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      await db.oidcAttempt.create({
        data: {
          stateHash: hashToken(state),
          nonce,
          verifier,
          browserHash: hashToken(browser),
          userId: req.body.link ? actor!.id : null,
          expiresAt: new Date(Date.now() + 600000),
        },
      });
      reply.setCookie("oidc_browser", browser, cookies);
      return {
        url: oidc.buildAuthorizationUrl(client, {
          redirect_uri: redirectUri,
          scope: "openid email profile",
          state,
          nonce,
          code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
          code_challenge_method: "S256",
        }).href,
      };
    },
  );
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/oidc/callback",
    {
      schema: { tags: ["OIDC"] },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      reply.header("Referrer-Policy", "no-referrer");
      reply.clearCookie("oidc_browser", cookies);
      try {
        const state = req.query.state,
          browser = req.cookies.oidc_browser;
        if (!state || state.length > 256 || !browser)
          throw new RecipeError(400, "Anmeldung ungültig.");
        const attempt = await db.oidcAttempt.findUnique({
          where: { stateHash: hashToken(state) },
        });
        if (
          !attempt ||
          attempt.browserHash !== hashToken(browser) ||
          attempt.expiresAt <= new Date()
        )
          throw new RecipeError(400, "Anmeldung abgelaufen.");
        if (
          !(
            await db.oidcAttempt.deleteMany({
              where: {
                stateHash: attempt.stateHash,
                browserHash: attempt.browserHash,
              },
            })
          ).count
        )
          throw new RecipeError(400, "Anmeldung bereits verwendet.");
        const tokens = await oidc.authorizationCodeGrant(
          await provider(),
          new URL(req.url, config.origin),
          {
            expectedState: state,
            expectedNonce: attempt.nonce,
            pkceCodeVerifier: attempt.verifier,
            idTokenExpected: true,
          },
        );
        const claims = tokens.claims();
        if (
          !claims?.sub ||
          claims.sub.length > 255 ||
          claims.iss !== settings.issuer
        )
          throw new RecipeError(400, "Identität ungültig.");
        let target = await db.oidcIdentity.findUnique({
          where: {
            issuer_subject: { issuer: settings.issuer, subject: claims.sub },
          },
          include: { user: { include: { accountStatus: true } } },
        });
        if (attempt.userId) {
          const actor = await auth.currentUser(req);
          if (!actor || actor.id !== attempt.userId)
            throw new RecipeError(403, "Bitte zum Verknüpfen erneut anmelden.");
          if (target && target.userId !== actor.id)
            throw new RecipeError(409, "Identität bereits verbunden.");
          if (!target)
            target = await db.oidcIdentity.create({
              data: {
                issuer: settings.issuer,
                subject: claims.sub,
                userId: actor.id,
              },
              include: { user: { include: { accountStatus: true } } },
            });
        } else if (!target) {
          if (!settings.registrationEnabled)
            throw new RecipeError(403, "OIDC-Registrierung deaktiviert.");
          if (
            claims.email_verified !== true ||
            typeof claims.email !== "string" ||
            !/^\S+@\S+\.\S+$/.test(claims.email) ||
            claims.email.length > 254
          )
            throw new RecipeError(
              400,
              "Bestätigte E-Mail-Adresse erforderlich.",
            );
          const email = claims.email.toLowerCase().trim();
          if (await db.user.findUnique({ where: { email } }))
            throw new RecipeError(
              409,
              "Bestehendes Konto zuerst anmelden und in Einstellungen verknüpfen.",
            );
          const passwordHash = await hashPassword(
            randomBytes(32).toString("hex"),
          );
          target = await db.oidcIdentity.create({
            data: {
              issuer: settings.issuer,
              subject: claims.sub,
              user: {
                create: {
                  email,
                  name:
                    typeof claims.name === "string"
                      ? claims.name.slice(0, 120)
                      : email.split("@")[0],
                  passwordHash,
                  memberships: {
                    create: {
                      role: "OWNER",
                      household: { create: { name: "Zuhause" } },
                    },
                  },
                },
              },
            },
            include: { user: { include: { accountStatus: true } } },
          });
        }
        if (target.user.accountStatus?.disabled)
          throw new RecipeError(403, "Konto gesperrt.");
        await auth.issueSession(target.userId, reply);
        await db.auditEvent.create({
          data: {
            actorId: target.userId,
            action: attempt.userId ? "OIDC LINK" : "OIDC LOGIN",
            status: 200,
          },
        });
        return reply.redirect(config.origin + "/#oidc=success");
      } catch {
        // Provider responses, codes and tokens are intentionally absent from logs/UI.
        return reply.redirect(config.origin + "/#authError=oidc");
      }
    },
  );
  app.get(
    "/auth/oidc/identities",
    { schema: { tags: ["OIDC"] } },
    async (req) => {
      const actor = await auth.currentUser(req);
      if (!actor) throw new RecipeError(401, "Bitte anmelden.");
      return {
        identities: await db.oidcIdentity.findMany({
          where: { userId: actor.id },
          select: { id: true, issuer: true, createdAt: true },
        }),
      };
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/auth/oidc/identities/:id",
    {
      schema: {
        tags: ["OIDC"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", maxLength: 30 } },
        },
      },
    },
    async (req) => {
      const actor = await auth.currentUser(req);
      if (!actor) throw new RecipeError(401, "Bitte anmelden.");
      if (!config.smtp)
        throw new RecipeError(
          409,
          "Vor dem Trennen einen Passwortreset per SMTP ermöglichen.",
        );
      const deleted = await db.oidcIdentity.deleteMany({
        where: { id: req.params.id, userId: actor.id },
      });
      if (!deleted.count)
        throw new RecipeError(404, "Verknüpfung nicht gefunden.");
      return { ok: true };
    },
  );
}
