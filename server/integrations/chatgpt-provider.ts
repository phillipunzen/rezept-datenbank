import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { RecipeError } from "../lib/errors";

export const chatgptIssuer = "https://auth.openai.com";
export const chatgptResource = "https://api.openai.com/v1";
export const chatgptScopes = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export interface ChatgptTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  scopes: string[];
}
export type ChatgptFetch = typeof fetch;
export class ChatgptProviderError extends RecipeError {
  constructor(status: number, message: string, public blockAccount = false) {
    super(status, message);
  }
}

// Provider diagnostics can contain submitted text or tokens: expose only mapped messages.
function providerFailure(status: number, code?: string): never {
  if (code === "subscription_sharing_usage_limit_exceeded" || status === 429)
    throw new ChatgptProviderError(429, "Das ChatGPT-Nutzungslimit wurde erreicht. Bitte unter ChatGPT → Einstellungen → Nutzung prüfen. Es erfolgt kein kostenpflichtiger Ausweichversuch.", true);
  if (code === "subscription_sharing_user_not_eligible")
    throw new ChatgptProviderError(403, "Dein ChatGPT-Konto oder Arbeitsbereich ist für diese Nutzung nicht freigeschaltet.", true);
  if (status === 401 || ["invalid_grant", "invalid_refresh_token", "refresh_token_reused", "subscription_sharing_invalid_user"].includes(code ?? ""))
    throw new ChatgptProviderError(401, "Bitte das ChatGPT-Konto erneut verbinden.", true);
  if (status === 403)
    throw new ChatgptProviderError(403, "ChatGPT hat die Anfrage nicht freigegeben. Bitte Kontoberechtigung und Nutzungseinstellungen prüfen.", true);
  throw new ChatgptProviderError(502, "Die ChatGPT-Anfrage konnte nicht abgeschlossen werden. Bitte später erneut versuchen.");
}

export async function readBounded(response: Response, maxBytes: number) {
  if (!response.body) throw new RecipeError(502, "Leere Antwort von ChatGPT.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > maxBytes) throw new RecipeError(502, "Die Antwort von ChatGPT ist zu groß.");
      chunks.push(next.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function chatgptProvider(customFetch: ChatgptFetch = fetch) {
  async function request(url: string, init: RequestInit = {}, timeout = 10000) {
    try {
      return await customFetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(timeout) });
    } catch {
      throw new RecipeError(502, "ChatGPT ist zurzeit nicht erreichbar.");
    }
  }
  async function json(url: string, init?: RequestInit) {
    const response = await request(url, init);
    let data: Record<string, unknown>;
    try { data = JSON.parse(await readBounded(response, 1024 * 1024)); }
    catch { throw new RecipeError(502, "Ungültige Antwort von ChatGPT."); }
    if (!response.ok) {
      const error = data.error;
      providerFailure(response.status, typeof error === "string" ? error : (error as { code?: string })?.code);
    }
    return data;
  }
  let metadata: Promise<{ keys: JSONWebKeySet; revocationEndpoint: string }> | undefined;
  function discovery() {
    return metadata ??= (async () => {
      const doc = await json(chatgptIssuer + "/.well-known/openid-configuration");
      if (doc.issuer !== chatgptIssuer) throw Error("issuer");
      const jwks = new URL(String(doc.jwks_uri));
      const revoke = new URL(String(doc.revocation_endpoint));
      if ([jwks, revoke].some(u => u.origin !== chatgptIssuer || u.username || u.password || u.hash)) throw Error("metadata");
      const keys = await json(jwks.href) as unknown as JSONWebKeySet;
      if (!Array.isArray(keys.keys)) throw Error("jwks");
      return { keys, revocationEndpoint: revoke.href };
    })().catch(() => {
      metadata = undefined;
      throw new RecipeError(502, "ChatGPT-Anmeldedienst nicht erreichbar.");
    });
  }
  async function identity(idToken: string, clientId: string, nonce?: string) {
    try {
      const { keys } = await discovery();
      const { payload } = await jwtVerify(idToken, createLocalJWKSet(keys), {
        issuer: chatgptIssuer, audience: clientId, algorithms: ["RS256", "ES256"],
        requiredClaims: ["sub", "exp", "iat", ...(nonce ? ["nonce"] : [])],
      });
      if (!payload.sub || payload.sub.length > 255 || (nonce && payload.nonce !== nonce) || (payload.azp && payload.azp !== clientId)) throw Error("identity");
      return { subject: payload.sub, email: typeof payload.email === "string" ? payload.email.slice(0, 254) : "" };
    } catch {
      // A later reconnect can pick up a provider signing-key rotation.
      metadata = undefined;
      throw new RecipeError(400, "Die Identität der ChatGPT-Anmeldung konnte nicht bestätigt werden.");
    }
  }
  function tokens(data: Record<string, unknown>, previous?: ChatgptTokens): ChatgptTokens {
    const scopes = typeof data.scope === "string" ? data.scope.split(/\s+/) : previous?.scopes ?? [];
    if (!scopes.includes("chatgpt.tokens.use.direct") || !scopes.includes("resource.invoke"))
      throw new ChatgptProviderError(403, "Die Freigabe zur Nutzung deines ChatGPT-Tarifs fehlt. Bitte erneut verbinden und diese Berechtigung erteilen.", true);
    if (typeof data.access_token !== "string" || !data.access_token || data.access_token.length > 32768 || typeof data.refresh_token !== "string" || !data.refresh_token || data.refresh_token.length > 32768 || (typeof data.token_type !== "string" || data.token_type.toLowerCase() !== "bearer") || typeof data.expires_in !== "number" || data.expires_in < 60 || data.expires_in > 86400 || (data.id_token !== undefined && typeof data.id_token !== "string"))
      throw new RecipeError(502, "Unvollständige ChatGPT-Anmeldung.");
    const idToken = data.id_token ?? previous?.idToken;
    if (typeof idToken !== "string" || !idToken || idToken.length > 32768) throw new RecipeError(502, "ChatGPT-Identitätsnachweis fehlt.");
    return { accessToken: data.access_token, refreshToken: data.refresh_token, idToken, scopes,
      expiresAt: Date.now() + data.expires_in * 1000 };
  }
  async function grant(body: Record<string, string>) {
    return json(chatgptIssuer + "/api/accounts/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...body, resource: chatgptResource }).toString(),
    });
  }
  return {
    async exchange(input: { clientId: string; code: string; verifier: string; redirectUri: string; nonce: string }) {
      const data = await grant({ grant_type: "authorization_code", client_id: input.clientId,
        code: input.code, code_verifier: input.verifier, redirect_uri: input.redirectUri });
      const result = tokens(data);
      return { ...await identity(result.idToken, input.clientId, input.nonce), tokens: result };
    },
    async refresh(clientId: string, subject: string, previous: ChatgptTokens) {
      const data = await grant({ grant_type: "refresh_token", client_id: clientId, refresh_token: previous.refreshToken });
      const next = tokens(data, previous);
      if (data.id_token && (await identity(next.idToken, clientId)).subject !== subject)
        throw new ChatgptProviderError(401, "Die Identität des ChatGPT-Kontos hat sich geändert. Bitte erneut verbinden.", true);
      return next;
    },
    async revoke(clientId: string, token: string) {
      const { revocationEndpoint } = await discovery();
      const response = await request(revocationEndpoint, { method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, token, token_type_hint: "refresh_token" }).toString() });
      await response.body?.cancel();
      if (!response.ok) throw new RecipeError(502, "Die externe Abmeldung konnte nicht bestätigt werden.");
    },
    async models(accessToken: string) {
      const data = await json(chatgptResource + "/models", { headers: { Authorization: "Bearer " + accessToken } });
      if (!Array.isArray(data.models)) throw new RecipeError(502, "Modellliste von ChatGPT fehlt.");
      return data.models.filter((m): m is { slug: string; display_name: string; visibility: string } => !!m && typeof m === "object" && typeof m.slug === "string" && /^[a-zA-Z0-9._-]{1,120}$/.test(m.slug) && typeof m.display_name === "string" && m.display_name.length <= 200 && m.visibility === "list")
        .slice(0, 100).map(m => ({ slug: m.slug, displayName: m.display_name }));
    },
    async recognize(accessToken: string, model: string, image: Buffer, instructions: string) {
      const response = await request(chatgptResource + "/responses", { method: "POST",
        headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ model, store: false, stream: true, instructions,
          input: [{ role: "user", content: [{ type: "input_text", text: "Übertrage dieses Rezeptfoto einschließlich lesbarer Handschrift." },
            { type: "input_image", image_url: "data:image/webp;base64," + image.toString("base64"), detail: "high" }] }] }),
      }, 65000);
      if (!response.ok) {
        let code: string | undefined;
        try { code = JSON.parse(await readBounded(response, 65536)).error?.code; } catch {}
        providerFailure(response.status, code);
      }
      return readRecipeStream(response);
    },
  };
}

export async function readRecipeStream(response: Response): Promise<string> {
  if (!response.body) throw new RecipeError(502, "Leere ChatGPT-Antwort.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = "", bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > 2 * 1024 * 1024) throw new RecipeError(502, "ChatGPT-Antwort zu groß.");
      pending += decoder.decode(next.value, { stream: true }).replace(/\r\n/g, "\n");
      // Normalize after concatenation too, including CR/LF split across network chunks.
      pending = pending.replace(/\r\n/g, "\n");
      let end: number;
      while ((end = pending.indexOf("\n\n")) >= 0) {
        const event = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const data = event.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
        if (!data || data === "[DONE]") continue;
        let value;
        try { value = JSON.parse(data); } catch { throw new RecipeError(502, "Ungültiger ChatGPT-Antwortstrom."); }
        if (value.type === "response.failed" || value.type === "error")
          providerFailure(502, value.response?.error?.code ?? value.error?.code ?? value.code);
        if (value.type === "response.incomplete") throw new RecipeError(502, "Die Erkennung ist unvollständig. Es wurde kein Rezept gespeichert.");
        if (value.type === "response.completed") {
          if (value.response?.status !== "completed" || !Array.isArray(value.response.output)) break;
          const text = value.response.output.filter((item: { type?: string }) => item.type === "message")
            .flatMap((item: { content?: unknown[] }) => item.content ?? [])
            .filter((item: { type?: string }) => item.type === "output_text")
            .map((item: { text?: string }) => item.text ?? "").join("");
          if (!text || text.length > 128 * 1024) throw new RecipeError(502, "ChatGPT hat kein verwendbares Rezept geliefert.");
          return text;
        }
      }
    }
    throw new RecipeError(502, "Die Erkennung wurde unterbrochen. Es wurde kein Rezept gespeichert.");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
