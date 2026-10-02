import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config";
export function connectionSecrets(config: Config) {
  let secret: Promise<Buffer> | undefined;
  async function load() {
    if (config.cookidooKey) return Buffer.from(config.cookidooKey, "hex");
    await mkdir(config.uploadDir, { recursive: true });
    const path = join(config.uploadDir, ".cookidoo-encryption-key");
    try {
      await writeFile(path, randomBytes(32).toString("hex"), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const raw = (await readFile(path, "utf8")).trim();
    if (!/^[a-f0-9]{64}$/.test(raw)) throw Error("Invalid connection key");
    return Buffer.from(raw, "hex");
  }
  const key = () =>
    (secret ??= load().catch((e) => {
      secret = undefined;
      throw e;
    }));
  return {
    async encrypt(value: unknown) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", await key(), iv);
      cipher.setAAD(Buffer.from("recipe-cookidoo-v1"));
      const content = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
      ]);
      return JSON.stringify({
        v: 1,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: content.toString("base64"),
      });
    },
    async decrypt<T>(encrypted: string): Promise<T> {
      const value = JSON.parse(encrypted) as {
        v: number;
        iv: string;
        tag: string;
        data: string;
      };
      if (value.v !== 1) throw Error("Unsupported connection secret");
      const cipher = createDecipheriv(
        "aes-256-gcm",
        await key(),
        Buffer.from(value.iv, "base64"),
      );
      cipher.setAAD(Buffer.from("recipe-cookidoo-v1"));
      cipher.setAuthTag(Buffer.from(value.tag, "base64"));
      return JSON.parse(
        Buffer.concat([
          cipher.update(Buffer.from(value.data, "base64")),
          cipher.final(),
        ]).toString("utf8"),
      ) as T;
    },
  };
}
