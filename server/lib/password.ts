import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
function deriveKey(
  password: string,
  salt: string,
  legacy = false,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCallback(
      password,
      salt,
      64,
      legacy ? { N: 16384, r: 8, p: 1 } : parameters,
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = await deriveKey(password, salt);
  return `scrypt-v1:${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, encoded] = stored.split(":");
  if (
    !["scrypt", "scrypt-v1"].includes(algorithm) ||
    !/^[a-f0-9]{32}$/.test(salt ?? "") ||
    !/^[a-f0-9]{128}$/.test(encoded ?? "")
  )
    return false;
  const actual = await deriveKey(password, salt, algorithm === "scrypt");
  return timingSafeEqual(actual, Buffer.from(encoded, "hex"));
}
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function safeTokenEqual(actual: string, expected: string) {
  return timingSafeEqual(
    Buffer.from(hashToken(actual)),
    Buffer.from(hashToken(expected)),
  );
}
