import { spawn } from "node:child_process";
export interface CookidooToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}
export interface RemoteShoppingItem {
  key: string;
  kind: "additional" | "ingredient";
  id: string;
  name: string;
  description: string;
  preparation: string;
  checked: boolean;
}
export interface CookidooAction {
  type: "create" | "update" | "delete";
  remoteKey?: string;
  expected?: RemoteShoppingItem;
  name?: string;
  checked?: boolean;
}
export interface ProviderResult {
  ok: boolean;
  code?: "AUTH" | "CONFLICT" | "UNAVAILABLE";
  tokens?: CookidooToken | null;
  items?: RemoteShoppingItem[];
  created?: RemoteShoppingItem[];
}
export interface CookidooProvider {
  call(request: {
    operation: "login" | "read" | "apply";
    market: string;
    email?: string;
    password?: string;
    tokens?: CookidooToken;
    action?: CookidooAction;
  }): Promise<ProviderResult>;
}
function validResult(value: unknown): value is ProviderResult {
  if (!value || typeof value !== "object") return false;
  const r = value as ProviderResult;
  if (
    typeof r.ok !== "boolean" ||
    (r.code && !["AUTH", "CONFLICT", "UNAVAILABLE"].includes(r.code))
  )
    return false;
  if (
    r.tokens &&
    (typeof r.tokens.access_token !== "string" ||
      r.tokens.access_token.length > 16000 ||
      typeof r.tokens.refresh_token !== "string" ||
      r.tokens.refresh_token.length > 16000 ||
      typeof r.tokens.expires_at !== "number" ||
      !Number.isFinite(r.tokens.expires_at))
  )
    return false;
  for (const items of [r.items, r.created])
    if (items !== undefined) {
      if (!Array.isArray(items) || items.length > 1000) return false;
      const keys = new Set<string>();
      for (const item of items) {
        if (
          !item ||
          !["additional", "ingredient"].includes(item.kind) ||
          typeof item.checked !== "boolean" ||
          typeof item.id !== "string" ||
          !item.id ||
          item.key !== `${item.kind}:${item.id}` ||
          item.key.length > 255 ||
          keys.has(item.key)
        )
          return false;
        keys.add(item.key);
        for (const field of ["name", "description", "preparation"] as const)
          if (typeof item[field] !== "string" || item[field].length > 500)
            return false;
      }
    }
  return !r.ok || (!!r.items && !!r.tokens);
}
export const pythonCookidooProvider: CookidooProvider = {
  async call(request) {
    return new Promise((resolve) => {
      const child = spawn(
        "/usr/local/bin/python3.13",
        ["-I", "-B", "scripts/cookidoo_bridge.py"],
        {
          cwd: process.cwd(),
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            NODE_ENV: "production",
            PATH: "/usr/local/bin:/usr/bin:/bin",
            LD_LIBRARY_PATH: "/usr/local/lib",
          },
        },
      );
      let output = "",
        finished = false;
      const finish = (result: ProviderResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        resolve(result);
      };
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        finish({ ok: false, code: "UNAVAILABLE" });
      }, 40000);
      child.on("error", () => finish({ ok: false, code: "UNAVAILABLE" }));
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
        if (output.length > 2 * 1024 * 1024) {
          child.kill("SIGKILL");
          finish({ ok: false, code: "UNAVAILABLE" });
        }
      });
      child.stderr.resume(); // Library errors may contain remote details; never forward them to logs.
      child.on("close", () => {
        try {
          const result: unknown = JSON.parse(output);
          if (!validResult(result)) throw Error();
          finish(result);
        } catch {
          finish({ ok: false, code: "UNAVAILABLE" });
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(request));
    });
  },
};
