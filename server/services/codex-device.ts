import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient, ChatgptAccount } from "@prisma/client";
import type { Config } from "../lib/config";
import { RecipeError } from "../lib/errors";
import { connectionSecrets } from "../lib/connection-secrets";
import { createCodexRuntime, includedUsageAllowed, type CodexRuntime, type CodexRuntimeFactory } from "../integrations/codex-runtime";
import { photoExtractionSchema } from "./recipe-photo-import";
import type { ChatgptDeviceStatus, ChatgptModel } from "../../shared/chatgpt";

export function codexDeviceService(db: PrismaClient, config: Config, factory: CodexRuntimeFactory = createCodexRuntime) {
  const secrets = connectionSecrets(config, "chatgpt");
  const running = new Map<string, { userId: string; runtime: CodexRuntime; completion: Promise<void> }>();
  let stopping = false;
  function enabled() {
    if (!config.chatgpt.enabled || !config.origin.startsWith("https://")) throw new RecipeError(403, "Die ChatGPT-Verbindung benötigt eine aktivierte Fotoerkennung und HTTPS.");
  }
  async function account(runtime: CodexRuntime) {
    const response = await runtime.request("account/read", { refreshToken: true });
    if (response?.account?.type !== "chatgpt") throw new RecipeError(403, "Nur eine persönliche ChatGPT-Anmeldung ist erlaubt. API-Schlüssel werden nicht verwendet.");
    return response.account as { email: string | null; planType: string };
  }
  async function catalog(runtime: CodexRuntime): Promise<ChatgptModel[]> {
    const result: ChatgptModel[] = []; let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page: any = await runtime.request("model/list", { includeHidden: false, cursor, limit: 100 });
      if (!Array.isArray(page?.data)) throw new RecipeError(502, "Codex hat keine Modellliste geliefert.");
      for (const model of page.data) if (!model.hidden && typeof model.model === "string" && model.model.length <= 120 && typeof model.displayName === "string" && model.displayName.length <= 200 && (model.inputModalities === undefined || (Array.isArray(model.inputModalities) && model.inputModalities.includes("image"))))
        result.push({ slug: model.model, displayName: model.displayName });
      cursor = page.nextCursor; if (!cursor) return result;
    }
    throw new RecipeError(502, "Die Modellliste ist zu groß.");
  }
  async function withAccount<T>(userId: string, accountId: string, work: (runtime: CodexRuntime) => Promise<T>) {
    enabled();
    const token = randomBytes(32).toString("hex");
    const locked = await db.chatgptAccount.updateMany({ where: { id: accountId, userId, provider: "device", active: true, encryptedTokens: { not: null }, blocked: false,
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, data: { leaseToken: token, leaseUntil: new Date(Date.now() + 115000) } });
    if (!locked.count) throw new RecipeError(409, "Diese Codex-Verbindung ist bereits beschäftigt oder nicht mehr aktiv.");
    let runtime: CodexRuntime | undefined, original: ChatgptAccount | undefined;
    let deadline: NodeJS.Timeout | undefined;
    try {
      original = await db.chatgptAccount.findUniqueOrThrow({ where: { id: accountId } });
      if (!original.encryptedTokens || !original.active || original.blocked) throw new RecipeError(409, "Die Codex-Verbindung wurde inzwischen geändert.");
      const saved = await secrets.decrypt<{ authFile: string }>(original.encryptedTokens!);
      runtime = await factory(saved.authFile);
      deadline = setTimeout(() => { void runtime?.close(); }, 90000);
      await account(runtime);
      return await work(runtime);
    } finally {
      if (deadline) clearTimeout(deadline);
      if (runtime) {
        try {
          const authFile = await runtime.credentials();
          await db.chatgptAccount.updateMany({ where: { id: accountId, userId, revision: original!.revision, leaseToken: token, encryptedTokens: { not: null } },
            data: { encryptedTokens: await secrets.encrypt({ authFile }), revision: { increment: 1 } } });
        } catch { /* A disconnected or failed runtime must never restore a cleared connection. */ }
        await runtime.close();
      }
      await db.chatgptAccount.updateMany({ where: { id: accountId, leaseToken: token }, data: { leaseToken: null, leaseUntil: null } });
    }
  }
  async function markFailed(id: string) {
    await db.chatgptDeviceAttempt.updateMany({ where: { id, status: "PENDING" }, data: { status: "FAILED" } });
  }
  return {
    async start(userId: string, accountId: string | null) {
      enabled();
      if (stopping || running.size >= 12) throw new RecipeError(429, "Zu viele gleichzeitige Anmeldungen. Bitte später erneut versuchen.");
      const selected = accountId ? await db.chatgptAccount.findFirst({ where: { id: accountId, userId } }) : null;
      if (accountId && !selected) throw new RecipeError(404, "Konto nicht gefunden.");
      if (!selected && await db.chatgptAccount.count({ where: { userId } }) >= 5) throw new RecipeError(400, "Bitte eine vorhandene Verbindung verwenden.");
      for (const [id, entry] of running) if (entry.userId === userId) { await entry.runtime.close(); await markFailed(id); }
      await db.chatgptDeviceAttempt.updateMany({ where: { userId, status: "PENDING" }, data: { status: "CANCELLED" } });
      const runtime = await factory();
      try {
        // The runtime queues notifications, including completion arriving before this response.
        const response = await runtime.request("account/login/start", { type: "chatgptDeviceCode" }, 30000);
        const url = new URL(String(response.verificationUrl));
        if (response.type !== "chatgptDeviceCode" || typeof response.loginId !== "string" || url.origin !== "https://auth.openai.com" || url.pathname !== "/codex/device" || url.search || url.hash || url.username || url.password || typeof response.userCode !== "string" || !/^[A-Za-z0-9-]{4,32}$/.test(response.userCode))
          throw new RecipeError(502, "Codex hat keinen gültigen Device-Code geliefert.");
        const attempt = await db.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`;
          await tx.chatgptDeviceAttempt.updateMany({ where: { userId, status: "PENDING" }, data: { status: "CANCELLED", userCode: "" } });
          return tx.chatgptDeviceAttempt.create({ data: { userId, accountId, accountRevision: selected?.revision,
            verificationUrl: url.href, userCode: response.userCode, expiresAt: new Date(Date.now() + 600000) } });
        });
        const completion = (async () => {
          try {
            const event = await runtime.wait("account/login/completed", e => e?.loginId === response.loginId, 600000);
            if (event.success !== true) throw new RecipeError(400, "Device-Anmeldung nicht abgeschlossen.");
            const identity = await account(runtime), authFile = await runtime.credentials();
            await db.$transaction(async tx => {
              await tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`;
              const current = await tx.chatgptDeviceAttempt.findUnique({ where: { id: attempt.id } });
              const state = await tx.accountStatus.findUnique({ where: { userId } });
              if (!current || current.status !== "PENDING" || current.expiresAt <= new Date() || state?.disabled) throw new RecipeError(409, "Anmeldung nicht mehr aktiv.");
              const existing = accountId ? await tx.chatgptAccount.findFirst({ where: { id: accountId, userId } }) : null;
              if (accountId && (!existing || existing.revision !== attempt.accountRevision)) throw new RecipeError(409, "Verbindung inzwischen geändert.");
              if (existing?.provider === "device" && existing.email && identity.email !== existing.email) throw new RecipeError(409, "Bitte das ursprüngliche ChatGPT-Konto wählen oder eine neue Verbindung anlegen.");
              if (!existing && await tx.chatgptAccount.count({ where: { userId } }) >= 5) throw new RecipeError(409, "Zu viele Verbindungen.");
              await tx.chatgptAccount.updateMany({ where: { userId }, data: { active: false } });
              const data = { provider: "device", email: identity.email?.slice(0, 254) ?? "", subject: identity.email?.slice(0, 255) ?? "codex-device",
                active: true, blocked: false, creditsConfirmed: false, encryptedTokens: await secrets.encrypt({ authFile }) };
              const saved = existing ? await tx.chatgptAccount.update({ where: { id: existing.id }, data: { ...data, revision: { increment: 1 } } })
                : await tx.chatgptAccount.create({ data: { ...data, userId, clientId: "codex-device:" + randomUUID() } });
              await tx.chatgptDeviceAttempt.update({ where: { id: attempt.id }, data: { status: "COMPLETE", resultAccountId: saved.id, userCode: "" } });
            });
          } catch { await markFailed(attempt.id).catch(() => {}); }
          finally { running.delete(attempt.id); await runtime.close(); }
        })();
        running.set(attempt.id, { userId, runtime, completion });
        return this.status(userId, attempt.id);
      } catch (error) { await runtime.close(); throw error; }
    },
    async status(userId: string, id: string): Promise<ChatgptDeviceStatus> {
      const attempt = await db.chatgptDeviceAttempt.findFirst({ where: { id, userId } });
      if (!attempt) throw new RecipeError(404, "Anmeldevorgang nicht gefunden.");
      const expired = attempt.expiresAt <= new Date() && attempt.status === "PENDING";
      return { id: attempt.id, status: (expired ? "EXPIRED" : attempt.status) as ChatgptDeviceStatus["status"],
        verificationUrl: attempt.verificationUrl, userCode: attempt.status === "PENDING" && !expired ? attempt.userCode : "", expiresAt: attempt.expiresAt.toISOString() };
    },
    async cancel(userId: string, id: string) {
      const attempt = await db.chatgptDeviceAttempt.findFirst({ where: { id, userId } });
      if (!attempt) throw new RecipeError(404, "Anmeldevorgang nicht gefunden.");
      await db.chatgptDeviceAttempt.updateMany({ where: { id, userId, status: "PENDING" }, data: { status: "CANCELLED", userCode: "" } });
      const entry = running.get(id); if (entry) await entry.runtime.close();
    },
    models(userId: string, id: string) { return withAccount(userId, id, catalog); },
    recognize(userId: string, id: string, model: string, image: Buffer, instructions: string) {
      return withAccount(userId, id, async runtime => {
        if (!(await catalog(runtime)).some(m => m.slug === model)) throw new RecipeError(400, "Bitte ein verfügbares Modell mit Bildeingabe auswählen.");
        const limits = await runtime.request("account/rateLimits/read");
        if (!includedUsageAllowed(limits)) {
          await db.chatgptAccount.updateMany({ where: { id, userId }, data: { blocked: true } });
          throw new RecipeError(403, "Codex kann enthaltene Nutzung ohne Zusatzguthaben derzeit nicht bestätigen. Bitte Nutzungslimit, Guthaben und automatische Aufladung in ChatGPT prüfen. Die Erkennung bleibt gesperrt.");
        }
        const thread = await runtime.request("thread/start", { model, ephemeral: true, permissions: "recipe_photo", approvalPolicy: "never",
          cwd: runtime.cwd, environments: [], baseInstructions: instructions, developerInstructions: "Lies nur das übermittelte Bild. Keine Tools, Befehle, Dateien oder weiteren Agenten verwenden.",
          allowProviderModelFallback: false });
        const threadId = thread?.thread?.id;
        if (typeof threadId !== "string") throw new RecipeError(502, "Codex konnte die Erkennung nicht starten.");
        const result = await runtime.request("turn/start", { threadId, model, approvalPolicy: "never", permissions: "recipe_photo", environments: [],
          input: [{ type: "text", text: "Übertrage dieses Rezeptfoto in das vorgegebene JSON-Format." }, { type: "image", url: "data:image/webp;base64," + image.toString("base64") }], outputSchema: photoExtractionSchema });
        const completed = await runtime.wait("turn/completed", e => e?.threadId === threadId && e?.turn?.id === result?.turn?.id, 65000);
        if (completed.turn.status !== "completed") {
          await db.chatgptAccount.updateMany({ where: { id, userId }, data: { blocked: true } });
          throw new RecipeError(502, "Die Codex-Erkennung wurde nicht abgeschlossen. Es wurde kein Rezept gespeichert. Bitte Nutzung und Verbindung prüfen.");
        }
        const items = [...(completed.turn.items ?? []), ...runtime.drain().filter(e => e.method === "item/completed" && e.params?.threadId === threadId && e.params?.turnId === result.turn.id).map(e => e.params!.item)];
        if (items.some(i => !["agentMessage", "reasoning", "userMessage"].includes(i.type))) throw new RecipeError(502, "Codex hat unerwartete Werkzeugaktionen gemeldet. Die Vorlage wurde verworfen.");
        const messages = items.filter(i => i.type === "agentMessage" && i.phase !== "commentary" && typeof i.text === "string");
        const text = messages.at(-1)?.text;
        if (!text || text.length > 128 * 1024) throw new RecipeError(502, "Codex hat keine gültige Rezeptvorlage geliefert.");
        return text as string;
      });
    },
    async logout(authFile: string) {
      const runtime = await factory(authFile);
      try { await runtime.request("account/logout"); } finally { await runtime.close(); }
    },
    async close() {
      stopping = true;
      const entries = [...running.values()];
      await Promise.all(entries.map(e => e.runtime.close()));
      await Promise.all(entries.map(e => e.completion));
    },
  };
}
export type CodexDeviceService = ReturnType<typeof codexDeviceService>;
