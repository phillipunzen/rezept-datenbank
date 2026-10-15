import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient, Prisma } from "@prisma/client";
import type { Config } from "../lib/config";
import { RecipeError } from "../lib/errors";
import { hashToken } from "../lib/password";
import { connectionSecrets } from "../lib/connection-secrets";
import { chatgptProvider, ChatgptProviderError, type ChatgptFetch, type ChatgptTokens } from "../integrations/chatgpt-provider";
import type { ChatgptStatus } from "../../shared/chatgpt";

export function chatgptService(db: PrismaClient, config: Config, customFetch?: ChatgptFetch) {
  const provider = chatgptProvider(customFetch), secrets = connectionSecrets(config, "chatgpt");
  const lockUser = async (tx: Prisma.TransactionClient, userId: string) => {
    await tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`;
  };
  function enabled() {
    if (!config.chatgpt.enabled) throw new RecipeError(403, "Der Fotoimport mit ChatGPT ist für diese Instanz nicht aktiviert.");
    if (!config.origin.startsWith("https://")) throw new RecipeError(403, "Die ChatGPT-Verbindung benötigt HTTPS.");
  }
  async function hostId() {
    await mkdir(config.uploadDir, { recursive: true });
    const path = join(config.uploadDir, ".chatgpt-host-id");
    try { await writeFile(path, "urn:uuid:" + randomUUID(), { flag: "wx", mode: 0o600 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    const id = (await readFile(path, "utf8")).trim();
    if (!/^urn:uuid:[a-f0-9-]{36}$/.test(id)) throw new RecipeError(500, "ChatGPT-Hostkennung ungültig.");
    return id;
  }
  async function pairing(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new RecipeError(401, "Verbindungscode ungültig oder abgelaufen.");
    const record = await db.chatgptPairing.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { include: { accountStatus: true } } } });
    if (!record || record.expiresAt <= new Date() || record.user.accountStatus?.disabled)
      throw new RecipeError(401, "Verbindungscode ungültig oder abgelaufen.");
    return record;
  }
  async function selected(userId: string) {
    const account = await db.chatgptAccount.findFirst({ where: { userId, active: true, encryptedTokens: { not: null } } });
    if (!account) throw new RecipeError(409, "Bitte zuerst dein ChatGPT-Konto verbinden.");
    if (account.blocked) throw new RecipeError(409, "Die ChatGPT-Nutzung ist angehalten. Bitte Nutzungslimit und Kontoberechtigung prüfen und anschließend bewusst fortsetzen oder erneut verbinden.");
    return account;
  }
  async function access(userId: string, accountId: string) {
    // Rotating refresh tokens must be serialized across all app processes.
    return db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM ChatgptAccount WHERE id = ${accountId} FOR UPDATE`;
      const record = await tx.chatgptAccount.findFirst({ where: { id: accountId, userId, active: true, encryptedTokens: { not: null } } });
      if (!record || record.blocked) throw new RecipeError(409, "ChatGPT-Konto nicht mehr aktiv. Bitte neu laden.");
      let tokens = await secrets.decrypt<ChatgptTokens>(record.encryptedTokens!);
      if (tokens.expiresAt < Date.now() + 60000) {
        tokens = await provider.refresh(record.clientId, record.subject, tokens);
        await tx.chatgptAccount.update({ where: { id: record.id }, data: { encryptedTokens: await secrets.encrypt(tokens), revision: { increment: 1 } } });
      }
      return tokens.accessToken;
    }, { timeout: 40000, maxWait: 5000 });
  }
  async function blockedOnFailure(accountId: string, error: unknown): Promise<never> {
    if (error instanceof ChatgptProviderError && error.blockAccount)
      await db.chatgptAccount.updateMany({ where: { id: accountId }, data: { blocked: true } });
    throw error;
  }
  return {
    async status(userId: string): Promise<ChatgptStatus> {
      const accounts = await db.chatgptAccount.findMany({ where: { userId }, orderBy: { id: "asc" } });
      return { enabled: config.chatgpt.enabled, secureOrigin: config.origin.startsWith("https://"), creditsDisabledConfirmed: config.chatgpt.creditsDisabledConfirmed,
        accounts: accounts.map((a, i) => ({ id: a.id, email: a.email, label: `ChatGPT ${i + 1}`, active: a.active,
          connected: a.encryptedTokens !== null, blocked: a.blocked, creditsConfirmed: a.creditsConfirmed })) };
    },
    async start(userId: string, accountId: string | null) {
      enabled();
      return db.$transaction(async tx => {
        await lockUser(tx, userId);
        const account = accountId ? await tx.chatgptAccount.findFirst({ where: { id: accountId, userId } }) : null;
        if (accountId && !account) throw new RecipeError(404, "Konto nicht gefunden.");
        if (!accountId && await tx.chatgptAccount.count({ where: { userId } }) >= 5)
          throw new RecipeError(400, "Höchstens fünf ChatGPT-Registrierungen pro Rezept-Konto. Bitte eine vorhandene Registrierung verwenden.");
        const code = randomBytes(32).toString("hex");
        await tx.chatgptPairing.deleteMany({ where: { OR: [{ userId }, { expiresAt: { lt: new Date() } }] } });
        const expiresAt = new Date(Date.now() + 600000);
        await tx.chatgptPairing.create({ data: { tokenHash: hashToken(code), userId, accountId,
          accountRevision: account?.revision, nonce: randomBytes(32).toString("base64url"), expiresAt } });
        return { code, expiresAt: expiresAt.toISOString() };
      });
    },
    async prepare(code: string) {
      enabled();
      const record = await pairing(code);
      const account = record.accountId ? await db.chatgptAccount.findFirst({ where: { id: record.accountId, userId: record.userId } }) : null;
      if (record.accountId && (!account || account.revision !== record.accountRevision)) throw new RecipeError(409, "Die Verbindung wurde inzwischen geändert. Bitte einen neuen Verbindungscode erstellen.");
      return { hostId: await hostId(), nonce: record.nonce, clientId: account?.clientId ?? null,
        loginHint: account?.email || null };
    },
    async complete(code: string, input: { clientId: string; code: string; verifier: string; redirectUri: string }) {
      enabled();
      const record = await pairing(code);
      const account = record.accountId ? await db.chatgptAccount.findFirst({ where: { id: record.accountId, userId: record.userId } }) : null;
      if (input.clientId === "dynamic_agent_client" || !/^[A-Za-z0-9._-]{1,255}$/.test(input.clientId) || (record.accountId && (!account || account.clientId !== input.clientId || account.revision !== record.accountRevision)))
        throw new RecipeError(400, "Die ChatGPT-Registrierung stimmt nicht mit dem Verbindungsversuch überein.");
      const callback = new URL(input.redirectUri);
      if (callback.protocol !== "http:" || callback.hostname !== "127.0.0.1" || !callback.port || callback.pathname !== "/auth/callback" || callback.username || callback.password || callback.search || callback.hash)
        throw new RecipeError(400, "Ungültige lokale Rücksprungadresse.");
      // Consume before exchanging: parallel/replayed callbacks must not create another session.
      if (!(await db.chatgptPairing.deleteMany({ where: { tokenHash: record.tokenHash, expiresAt: { gt: new Date() } } })).count)
        throw new RecipeError(401, "Verbindungscode wurde bereits verwendet.");
      const result = await provider.exchange({ ...input, nonce: record.nonce });
      if (account && result.subject !== account.subject) throw new RecipeError(400, "Es wurde ein anderes ChatGPT-Konto ausgewählt. Bitte als neues Konto verbinden.");
      await db.$transaction(async tx => {
        await lockUser(tx, record.userId);
        const currentUser = await tx.accountStatus.findUnique({ where: { userId: record.userId } });
        if (currentUser?.disabled) throw new RecipeError(403, "Rezept-Konto deaktiviert.");
        const existing = await tx.chatgptAccount.findUnique({ where: { userId_clientId: { userId: record.userId, clientId: input.clientId } } });
        if ((account && existing?.revision !== record.accountRevision) || (existing && existing.subject !== result.subject))
          throw new RecipeError(409, "Die Verbindung wurde inzwischen geändert. Bitte neu verbinden.");
        if (!existing && await tx.chatgptAccount.count({ where: { userId: record.userId } }) >= 5) throw new RecipeError(400, "Zu viele ChatGPT-Registrierungen.");
        await tx.chatgptAccount.updateMany({ where: { userId: record.userId }, data: { active: false } });
        const data = { encryptedTokens: await secrets.encrypt(result.tokens), email: result.email, active: true, blocked: false, creditsConfirmed: false };
        if (existing) await tx.chatgptAccount.update({ where: { id: existing.id }, data: { ...data, revision: { increment: 1 } } });
        else await tx.chatgptAccount.create({ data: { ...data, userId: record.userId, clientId: input.clientId, subject: result.subject } });
      }, { timeout: 20000 });
    },
    async select(userId: string, accountId: string) {
      enabled();
      await db.$transaction(async tx => {
        await lockUser(tx, userId);
        const account = await tx.chatgptAccount.findFirst({ where: { id: accountId, userId, encryptedTokens: { not: null } } });
        if (!account) throw new RecipeError(404, "Verbundenes Konto nicht gefunden.");
        await tx.chatgptAccount.updateMany({ where: { userId }, data: { active: false } });
        await tx.chatgptAccount.update({ where: { id: accountId }, data: { active: true } });
      });
    },
    async resume(userId: string, accountId: string) {
      enabled();
      const change = await db.chatgptAccount.updateMany({ where: { id: accountId, userId, encryptedTokens: { not: null } }, data: { blocked: false } });
      if (!change.count) throw new RecipeError(404, "Konto nicht gefunden.");
    },
    async confirmCredits(userId: string, accountId: string) {
      enabled();
      const change = await db.chatgptAccount.updateMany({ where: { id: accountId, userId, encryptedTokens: { not: null } }, data: { creditsConfirmed: true } });
      if (!change.count) throw new RecipeError(404, "Konto nicht gefunden.");
    },
    async disconnect(userId: string, accountId: string) {
      // Keep the issued-client/identity mapping for future sign-in. Stop all local use first.
      const previous = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM ChatgptAccount WHERE id = ${accountId} FOR UPDATE`;
        const account = await tx.chatgptAccount.findFirst({ where: { id: accountId, userId } });
        if (!account) throw new RecipeError(404, "Konto nicht gefunden.");
        await tx.chatgptPairing.deleteMany({ where: { userId } });
        await tx.chatgptAccount.update({ where: { id: accountId }, data: { encryptedTokens: null, active: false, blocked: false, creditsConfirmed: false, revision: { increment: 1 } } });
        return account;
      });
      if (!previous.encryptedTokens) return { revoked: true };
      try {
        const tokens = await secrets.decrypt<ChatgptTokens>(previous.encryptedTokens);
        await provider.revoke(previous.clientId, tokens.refreshToken);
        return { revoked: true };
      } catch { return { revoked: false }; }
    },
    async models(userId: string) {
      enabled();
      const account = await selected(userId);
      try { return await provider.models(await access(userId, account.id)); }
      catch (error) { return blockedOnFailure(account.id, error); }
    },
    async recognize(userId: string, model: string, image: Buffer, instructions: string) {
      enabled();
      if (!config.chatgpt.creditsDisabledConfirmed)
        throw new RecipeError(403, "Die Erkennung bleibt gesperrt, bis der Betreiber das Credit-Limit für diese Verbindung in ChatGPT geprüft und auf 0 gesetzt hat. Die App kann dieses Limit nicht selbst prüfen oder setzen.");
      const account = await selected(userId), lease = randomBytes(32).toString("hex");
      if (!account.creditsConfirmed) throw new RecipeError(403, "Bitte zuerst für dieses ChatGPT-Konto bestätigen, dass das Credit-Limit dieser App in ChatGPT auf 0 steht.");
      const acquired = await db.chatgptAccount.updateMany({ where: { id: account.id, userId, active: true, blocked: false, encryptedTokens: { not: null },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, data: { leaseToken: lease, leaseUntil: new Date(Date.now() + 120000) } });
      if (!acquired.count) throw new RecipeError(409, "Für dieses Konto läuft bereits eine Erkennung. Bitte warten.");
      try {
        const token = await access(userId, account.id);
        const models = await provider.models(token);
        if (!models.some(m => m.slug === model)) throw new RecipeError(400, "Bitte ein verfügbares ChatGPT-Modell auswählen.");
        return await provider.recognize(token, model, image, instructions);
      } catch (error) { return blockedOnFailure(account.id, error); }
      finally { await db.chatgptAccount.updateMany({ where: { id: account.id, leaseToken: lease }, data: { leaseToken: null, leaseUntil: null } }); }
    },
  };
}
