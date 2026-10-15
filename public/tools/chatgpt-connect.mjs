#!/usr/bin/env node
// Run locally with Node.js 22+. No npm packages, API key or paid API fallback.
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";

export function authorizationUrl({ hostId, nonce, clientId }, redirectUri, state, verifier) {
  const url = new URL("https://auth.openai.com/api/accounts/authorize");
  url.search = new URLSearchParams({
    client_id: clientId || "dynamic_agent_client",
    ...(!clientId ? { agent_name_hint: "Rezeptdatenbank" } : {}),
    ext_agent_host_id: hostId, response_type: "code", redirect_uri: redirectUri,
    scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource: "https://api.openai.com/v1", state, nonce,
    code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  }).toString();
  // Deliberately omit id_token_hint: the displayed URL must never contain tokens.
  return url.href;
}

export async function connect(origin, pairingCode, print = console.log) {
  const app = new URL(origin);
  if (app.protocol !== "https:" || app.username || app.password || app.origin !== origin)
    throw Error("Bitte die reine HTTPS-Adresse der Rezept-App verwenden, ohne Pfad oder abschließenden Schrägstrich.");
  if (!/^[a-f0-9]{64}$/.test(pairingCode)) throw Error("Verbindungscode ungültig.");
  async function call(path, body) {
    const response = await fetch(app.origin + "/api/v1/chatgpt/pairing/" + path, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
      headers: { Origin: app.origin, Authorization: "Bearer " + pairingCode, "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (Number(response.headers.get("content-length")) > 32768) throw Error("Antwort zu groß.");
    const data = await response.json();
    if (!response.ok) throw Error(typeof data.message === "string" ? data.message : "Die Verbindung wurde abgelehnt.");
    return data;
  }
  const pending = await call("prepare");
  if (!/^urn:uuid:[a-f0-9-]{36}$/.test(pending.hostId) || typeof pending.nonce !== "string" || pending.nonce.length > 100)
    throw Error("Ungültiger Verbindungsversuch.");
  const state = randomBytes(32).toString("base64url"), verifier = randomBytes(48).toString("base64url");
  let redirectUri = "", handling = false;
  let resolveDone, rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    const callback = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "GET" || callback.pathname !== "/auth/callback" || callback.searchParams.getAll("state").length !== 1 || callback.searchParams.get("state") !== state || handling) {
      res.writeHead(400).end("Ungültiger Rücksprung. Bitte zum ursprünglichen Anmeldefenster zurückkehren.");
      return;
    }
    handling = true;
    try {
      if (callback.searchParams.has("error")) throw Error("ChatGPT-Anmeldung abgebrochen oder nicht freigegeben.");
      const code = callback.searchParams.get("code"), clientId = callback.searchParams.get("client_id") || pending.clientId;
      if (!code || code.length > 8192 || !clientId || !/^[A-Za-z0-9._-]{1,255}$/.test(clientId) || clientId === "dynamic_agent_client" || (pending.clientId && pending.clientId !== clientId) || callback.searchParams.getAll("code").length !== 1 || callback.searchParams.getAll("client_id").length > 1)
        throw Error("Unvollständige oder abweichende ChatGPT-Registrierung.");
      await call("complete", { clientId, code, verifier, redirectUri });
      res.end("ChatGPT wurde verbunden. Du kannst dieses Fenster schließen und in der Rezept-App den Verbindungsstatus aktualisieren. Vor der Fotoerkennung das Credit-Limit dieser App in ChatGPT auf 0 setzen.");
      resolveDone();
    } catch (error) {
      res.writeHead(400).end("Die Verbindung konnte nicht abgeschlossen werden. Bitte die Meldung im lokalen Anmeldeprogramm prüfen.");
      rejectDone(error);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  const timeout = setTimeout(() => rejectDone(Error("Der Verbindungscode ist abgelaufen. Bitte in der Rezept-App einen neuen erstellen.")), 600000);
  const interrupted = () => rejectDone(Error("Anmeldung abgebrochen."));
  process.once("SIGINT", interrupted);
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
    print("Öffne diese Adresse im Browser auf DIESEM Rechner (nicht auf dem Server):");
    print(authorizationUrl(pending, redirectUri, state, verifier));
    await done;
    print("Verbunden. Zurück zur Rezept-App → Verbindungsstatus aktualisieren.");
  } finally {
    clearTimeout(timeout);
    process.removeListener("SIGINT", interrupted);
    server.close();
    server.closeAllConnections();
  }
}

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 22) throw Error("Node.js 22 oder neuer wird benötigt.");
  const input = createInterface({ input: stdin, output: stdout });
  let origin, code;
  try {
    origin = (await input.question("HTTPS-Adresse deiner Rezept-App: ")).trim().replace(/\/$/, "");
    code = (await input.question("Verbindungscode aus der Rezept-App (10 Minuten gültig): ")).trim();
  } finally { input.close(); }
  await connect(origin, code);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(error instanceof Error ? error.message : "Anmeldung fehlgeschlagen."); process.exitCode = 1; });
