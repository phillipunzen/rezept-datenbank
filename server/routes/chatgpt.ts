import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "../lib/config";
import { RecipeError } from "../lib/errors";
import { normalizeImage } from "../lib/normalize-image";
import { authService } from "../services/auth";
import { membership } from "../services/household-access";
import { chatgptService } from "../services/chatgpt";
import { photoInstructions, photoPreview } from "../services/recipe-photo-import";
import type { ChatgptFetch } from "../integrations/chatgpt-provider";
import { codexDeviceService } from "../services/codex-device";
import type { CodexRuntimeFactory } from "../integrations/codex-runtime";

const text = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const consent = { type: "boolean", const: true };
export async function chatgptRoutes(app: FastifyInstance, db: PrismaClient, config: Config, customFetch?: ChatgptFetch, runtimeFactory?: CodexRuntimeFactory) {
  const devices = codexDeviceService(db, config, runtimeFactory);
  const service = chatgptService(db, config, customFetch, devices), auth = authService(db, config);
  app.addHook("onClose", () => devices.close());
  async function actor(req: FastifyRequest) {
    const user = await auth.currentUser(req);
    if (!user) throw new RecipeError(401, "Bitte anmelden.");
    return user.id;
  }
  function pairingToken(req: FastifyRequest) {
    const value = req.headers.authorization;
    if (!value?.startsWith("Bearer ")) throw new RecipeError(401, "Verbindungscode fehlt.");
    return value.slice(7);
  }
  const secure = { tags: ["ChatGPT photo import"], security: [{ cookieAuth: [] }] };
  app.get("/chatgpt", { schema: secure }, async req => service.status(await actor(req)));
  app.put<{ Body: { accountId: string | null } }>("/chatgpt/shared", {
    schema: { ...secure, body: object({ accountId: { type: ["string", "null"], minLength: 1, maxLength: 30 } }) },
  }, async req => {
    await service.setShared(await actor(req), req.body.accountId);
    return { ok: true };
  });
  app.get("/chatgpt/models", { schema: secure }, async req => ({ models: await service.models(await actor(req)) }));
  app.post<{ Body: { accountId: string | null } }>("/chatgpt/device/start", {
    schema: { ...secure, body: object({ accountId: { type: ["string", "null"], minLength: 1, maxLength: 30 } }) },
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async req => devices.start(await actor(req), req.body.accountId));
  const deviceParams = object({ id: text(30) });
  app.get<{ Params: { id: string } }>("/chatgpt/device/:id", { schema: { ...secure, params: deviceParams } }, async req => devices.status(await actor(req), req.params.id));
  app.delete<{ Params: { id: string } }>("/chatgpt/device/:id", { schema: { ...secure, params: deviceParams } }, async req => {
    await devices.cancel(await actor(req), req.params.id); return { ok: true };
  });
  app.post<{ Body: { accountId: string | null } }>("/chatgpt/pairing", {
    schema: { ...secure, body: object({ accountId: { type: ["string", "null"], minLength: 1, maxLength: 30 } }) },
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async req => service.start(await actor(req), req.body.accountId));
  // A local helper uses the short-lived pairing credential, never a browser login cookie.
  app.post("/chatgpt/pairing/prepare", {
    schema: { tags: secure.tags }, config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async req => service.prepare(pairingToken(req)));
  app.post<{ Body: { clientId: string; code: string; verifier: string; redirectUri: string } }>("/chatgpt/pairing/complete", {
    schema: { tags: secure.tags, body: object({ clientId: text(255), code: text(8192), verifier: { ...text(128), minLength: 43, pattern: "^[A-Za-z0-9._~-]+$" }, redirectUri: text(200) }) },
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async req => {
    await service.complete(pairingToken(req), req.body);
    return { ok: true };
  });
  const params = object({ id: text(30) });
  app.post<{ Params: { id: string } }>("/chatgpt/accounts/:id/select", { schema: { ...secure, params } }, async req => {
    await service.select(await actor(req), req.params.id);
    return { ok: true };
  });
  app.post<{ Params: { id: string }; Body: { confirmedZeroCredits: true } }>("/chatgpt/accounts/:id/credits", {
    schema: { ...secure, params, body: object({ confirmedZeroCredits: consent }) },
  }, async req => {
    await service.confirmCredits(await actor(req), req.params.id);
    return { ok: true };
  });
  app.post<{ Params: { id: string }; Body: { reviewedUsage: true } }>("/chatgpt/accounts/:id/resume", {
    schema: { ...secure, params, body: object({ reviewedUsage: consent }) },
  }, async req => {
    await service.resume(await actor(req), req.params.id);
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>("/chatgpt/accounts/:id", { schema: { ...secure, params } }, async req => service.disconnect(await actor(req), req.params.id));
  app.post<{ Querystring: { householdId: string; model: string; consent: true; keepPhoto: boolean } }>("/recipe-imports/photo/preview", {
    bodyLimit: 9 * 1024 * 1024,
    config: { imageUpload: true, rateLimit: { max: 4, timeWindow: "1 minute" } },
    schema: { ...secure, consumes: ["multipart/form-data"], querystring: object({
      householdId: text(30), model: text(120), consent, keepPhoto: { type: "boolean" },
    }) },
  }, async req => {
    const userId = await actor(req);
    await membership(db, userId, req.query.householdId, true);
    const part = await req.file();
    if (!part) throw new RecipeError(400, "Bitte ein Rezeptfoto auswählen.");
    const image = await normalizeImage(await part.toBuffer(), part.mimetype);
    const extracted = await service.recognize(userId, req.query.model, image, photoInstructions);
    // Membership can change while the external request is running.
    await membership(db, userId, req.query.householdId, true);
    if (!await auth.currentUser(req)) throw new RecipeError(401, "Bitte erneut anmelden.");
    return photoPreview(extracted, req.query.householdId, req.query.keepPhoto ? image : undefined);
  });
}
