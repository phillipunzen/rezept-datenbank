import { cookidooSync, startCookidooWorker } from "./services/cookidoo-sync";
import { PrismaClient } from "@prisma/client";
import { startImportWorker } from "./services/import-jobs";
import { readConfig } from "./lib/config";
import { buildApp } from "./app";
async function main() {
  const config = readConfig();
  const db = new PrismaClient();
  await db.$connect();
  const app = await buildApp(db, config);
  const stopWorker = startImportWorker(db, config, () =>
    app.log.error("Import-Worker fehlgeschlagen"),
  );
  const stopCookidoo = startCookidooWorker(cookidooSync(db, config), () =>
    app.log.error("Cookidoo-Abgleich fehlgeschlagen"),
  );
  const cleanup = setInterval(() => {
    void Promise.all([
      db.passwordReset.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
      db.oidcAttempt.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
      db.auditEvent.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 90 * 86400000) } },
      }),
    ]).catch(() => app.log.error("Kontodaten-Bereinigung fehlgeschlagen"));
    void db.session
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => app.log.error("Session-Bereinigung fehlgeschlagen"));
  }, 3600000);
  cleanup.unref();
  app.addHook("onClose", async () => {
    clearInterval(cleanup);
    await Promise.all([stopWorker(), stopCookidoo()]);
    await db.$disconnect();
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => {
      void app.close();
    });
  await app.listen({ host: "127.0.0.1", port: 3001 });
}
main().catch(() => {
  process.stderr.write(
    "Backendstart fehlgeschlagen. DB-Verbindung und Environment prüfen.\n",
  );
  process.exit(1);
});
