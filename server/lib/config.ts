import "dotenv/config";
export function readConfig(
  env: Record<string, string | undefined> = process.env,
) {
  if (!env.DATABASE_URL?.startsWith("mysql://"))
    throw new Error(
      "DATABASE_URL muss eine MariaDB/MySQL-Verbindung enthalten.",
    );
  const origin = new URL(env.APP_ORIGIN ?? "http://localhost:3000").origin;
  const setupToken = env.INITIAL_SETUP_TOKEN ?? "";
  if (setupToken.length < 32)
    throw new Error("INITIAL_SETUP_TOKEN muss mindestens 32 Zeichen haben.");
  const bool = (name: string, fallback: boolean) => {
    const value = env[name];
    if (value === undefined) return fallback;
    if (value !== "true" && value !== "false")
      throw new Error(`${name} muss true oder false sein.`);
    return value === "true";
  };
  const secureCookie = bool("COOKIE_SECURE", origin.startsWith("https://"));
  if (origin.startsWith("https://") && !secureCookie)
    throw new Error("HTTPS benötigt COOKIE_SECURE=true.");
  const smtpHost = env.SMTP_HOST?.trim();
  const smtpPort = Number(
    env.SMTP_PORT ?? (bool("SMTP_SECURE", false) ? 465 : 587),
  );
  if (
    smtpHost &&
    (!env.SMTP_FROM ||
      /[\r\n]/.test(env.SMTP_FROM) ||
      !Number.isInteger(smtpPort) ||
      smtpPort < 1 ||
      smtpPort > 65535)
  )
    throw new Error("SMTP_FROM/SMTP_PORT ungültig.");
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD))
    throw new Error("SMTP_USER und SMTP_PASSWORD gemeinsam setzen.");
  if (
    env.COOKIDOO_ENCRYPTION_KEY &&
    !/^[a-f0-9]{64}$/.test(env.COOKIDOO_ENCRYPTION_KEY)
  )
    throw new Error("COOKIDOO_ENCRYPTION_KEY muss 32 Byte als Hex enthalten.");
  const issuer = env.OIDC_ISSUER?.trim();
  if (env.CHATGPT_ENCRYPTION_KEY && !/^[a-f0-9]{64}$/.test(env.CHATGPT_ENCRYPTION_KEY))
    throw new Error("CHATGPT_ENCRYPTION_KEY muss 32 Byte als Hex enthalten.");
  if (
    issuer &&
    (!env.OIDC_CLIENT_ID ||
      new URL(issuer).protocol !== "https:" ||
      issuer.length > 500)
  )
    throw new Error("OIDC benötigt HTTPS-Issuer und CLIENT_ID.");
  return {
    origin,
    chatgpt: {
      enabled: bool("CHATGPT_PHOTO_IMPORT_ENABLED", false),
      creditsDisabledConfirmed: bool("CHATGPT_CREDITS_DISABLED_CONFIRMED", false),
      key: env.CHATGPT_ENCRYPTION_KEY || null,
    },
    publicCatalogEnabled: bool("PUBLIC_CATALOG_ENABLED", false),
    cookidooEnabled: bool("COOKIDOO_ENABLED", false),
    cookidooAllowHttp: bool("COOKIDOO_ALLOW_HTTP", false),
    cookidooKey: env.COOKIDOO_ENCRYPTION_KEY || null,
    smtp: smtpHost
      ? {
          host: smtpHost,
          port: smtpPort,
          secure: bool("SMTP_SECURE", false),
          requireTLS: bool("SMTP_REQUIRE_TLS", true),
          user: env.SMTP_USER,
          password: env.SMTP_PASSWORD,
          from: env.SMTP_FROM!,
        }
      : null,
    oidc: issuer
      ? {
          issuer,
          clientId: env.OIDC_CLIENT_ID!,
          clientSecret: env.OIDC_CLIENT_SECRET,
          registrationEnabled: bool("OIDC_REGISTRATION_ENABLED", false),
          requireEmailVerified: bool("OIDC_REQUIRE_EMAIL_VERIFIED", true),
          label: env.OIDC_LABEL?.slice(0, 80) || "Single Sign-On",
        }
      : null,
    uploadDir: env.UPLOAD_DIR ?? "/app/uploads",
    setupToken,
    secureCookie,
    registrationEnabled: bool("REGISTRATION_ENABLED", false),
    trustProxy: bool("TRUST_PROXY", false),
    logLevel: env.LOG_LEVEL ?? "info",
    sessionHours: 168,
  };
}
export type Config = ReturnType<typeof readConfig>;
