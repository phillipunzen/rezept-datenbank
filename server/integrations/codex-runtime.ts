import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecipeError } from "../lib/errors";

export interface CodexEvent { method: string; params?: Record<string, any> }
export interface CodexRuntime {
  cwd: string;
  request<T = any>(method: string, params?: object, timeout?: number): Promise<T>;
  wait(method: string, accept: (params: any) => boolean, timeout: number): Promise<any>;
  credentials(): Promise<string>;
  drain(): CodexEvent[];
  close(): Promise<void>;
}
export type CodexRuntimeFactory = (authFile?: string) => Promise<CodexRuntime>;

// An application-owned runtime with no inherited API keys, user config, shell or plugins.
// Credentials only exist in this private directory for the lifetime of the operation.
export const createCodexRuntime: CodexRuntimeFactory = async (authFile) => {
  const root = await mkdtemp(join(tmpdir(), "recipe-codex-")), home = join(root, "auth"), cwd = join(root, "work");
  await mkdir(home, { mode: 0o700 }); await mkdir(cwd, { mode: 0o700 });
  await writeFile(join(home, "config.toml"), [
    'default_permissions = "recipe_photo"',
    '[permissions.recipe_photo.filesystem]',
    '"/" = "deny"', '":minimal" = "read"', `${JSON.stringify(cwd)} = "read"`, `${JSON.stringify(home)} = "deny"`,
    '[permissions.recipe_photo.network]', 'enabled = false',
  ].join("\n"), { mode: 0o600 });
  if (authFile) {
    if (authFile.length > 128 * 1024) throw new RecipeError(500, "Ungültige gespeicherte Verbindung.");
    JSON.parse(authFile);
    await writeFile(join(home, "auth.json"), authFile, { mode: 0o600 });
  }
  const settings: Record<string, unknown> = {
    forced_login_method: "chatgpt", cli_auth_credentials_store: "file", model_provider: "openai",
    approval_policy: "never", web_search: "disabled", check_for_update_on_startup: false,
    "features.shell_tool": false, "features.unified_exec": false, "features.view_image": false,
    "tools.view_image": false, "features.apps": false, "features.plugins": false,
    "features.multi_agent": false, "features.multi_agent_v2": false, "features.image_generation": false,
    "features.shell_snapshot": false, "features.sleep_tool": false, "features.memories": false,
    "features.hooks": false, "features.workspace_dependencies": false, "features.unbounded_connection_retries": false,
  };
  const args = [join(process.cwd(), "node_modules/@openai/codex/bin/codex.js"), "app-server", "--listen", "stdio://"];
  for (const [key, value] of Object.entries(settings)) args.push("-c", `${key}=${JSON.stringify(value)}`);
  const child = spawn(process.execPath, args, { cwd, env: {
    NODE_ENV: "production", PATH: "/usr/local/bin:/usr/bin:/bin", CODEX_HOME: home, TMPDIR: root, RUST_LOG: "off",
  }, stdio: ["pipe", "pipe", "ignore"] });
  let sequence = 0, buffer = "", closed = false;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  const events: CodexEvent[] = [], listeners = new Set<() => void>();
  const failure = () => new RecipeError(502, "Die Codex-Verbindung wurde unterbrochen. Bitte erneut verbinden oder später versuchen.");
  function fail() {
    closed = true;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(failure()); }
    pending.clear(); for (const notify of listeners) notify();
  }
  child.once("error", fail); child.once("exit", fail);
  child.stdin.on("error", fail);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 2 * 1024 * 1024) { child.kill("SIGKILL"); fail(); return; }
    let at: number;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      let message: any;
      try { message = JSON.parse(line); } catch { child.kill("SIGKILL"); fail(); return; }
      if (message.method) {
        if (message.id !== undefined) {
          // No model tool, approval, permission or external-token request is authorized.
          child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: "Not supported by this application" } }) + "\n");
        } else {
          if (events.length >= 1000) { child.kill("SIGKILL"); fail(); return; }
          events.push(message); for (const notify of listeners) notify();
        }
      } else if (typeof message.id === "number") {
        const item = pending.get(message.id);
        if (!item) continue;
        pending.delete(message.id); clearTimeout(item.timer);
        if (message.error) item.reject(new RecipeError(502, "Codex hat die Anfrage abgelehnt. Bitte Anmeldung, Device-Code-Freigabe und Nutzungslimit prüfen."));
        else item.resolve(message.result);
      }
    }
  });
  const runtime: CodexRuntime = {
    cwd,
    request(method, params = {}, timeout = 15000) {
      if (closed) return Promise.reject(failure());
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(failure()); }, timeout);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n", error => { if (error) fail(); });
      });
    },
    wait(method, accept, timeout) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const i = events.findIndex(e => e.method === method && accept(e.params));
          if (i >= 0) { const event = events.splice(i, 1)[0]; cleanup(); resolve(event.params); }
          else if (closed) { cleanup(); reject(failure()); }
        };
        const timer = setTimeout(() => { cleanup(); reject(new RecipeError(408, "Die Codex-Anfrage ist abgelaufen. Bitte erneut versuchen.")); }, timeout);
        function cleanup() { clearTimeout(timer); listeners.delete(check); }
        listeners.add(check); check();
      });
    },
    async credentials() {
      const path = join(home, "auth.json"); await chmod(path, 0o600);
      const data = await readFile(path, "utf8");
      if (data.length > 128 * 1024) throw failure();
      JSON.parse(data); return data;
    },
    drain() { return events.splice(0); },
    async close() {
      fail(); child.kill("SIGTERM");
      if (child.exitCode === null && child.signalCode === null) await new Promise<void>(resolve => {
        const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 1500);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
      await rm(root, { recursive: true, force: true });
    },
  };
  try {
    await runtime.request("initialize", { clientInfo: { name: "rezeptdatenbank", title: "Rezeptdatenbank", version: "0.8.0" }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    return runtime;
  } catch (e) { await runtime.close(); throw e; }
};

export function includedUsageAllowed(result: any) {
  const bucket = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
  const buckets = result?.rateLimitsByLimitId && typeof result.rateLimitsByLimitId === "object"
    ? [bucket, ...Object.values(result.rateLimitsByLimitId)] : [bucket];
  // Unknown or contradictory snapshots are not proof of an included-only request.
  return result?.ordinaryUsageAllowed === true && buckets.every((entry: any) => {
    const credits = entry?.credits;
    return !!entry && !entry.rateLimitReachedType && entry.spendControlReached !== true &&
      credits?.hasCredits === false && credits?.unlimited === false && (credits.balance === null || credits.balance === undefined || /^0+(\.0+)?$/.test(credits.balance)) &&
      [entry.primary, entry.secondary].every(w => w === null || w === undefined || (typeof w.usedPercent === "number" && w.usedPercent >= 0 && w.usedPercent < 100));
  });
}
