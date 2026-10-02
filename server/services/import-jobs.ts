import { Prisma, type PrismaClient, type ImportJob } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../lib/config";
import { RecipeError } from "../lib/errors";
import { normalizeImage } from "../lib/normalize-image";
import { parseTandoor, tandoorPreview } from "./tandoor-parser";
import { lockHousehold, membership } from "./household-access";
import { saveRecipeTx, visibleRecipeWhere } from "./recipes";
const txOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 10000,
  timeout: 30000,
};
const archivePath = (config: Config, key: string) =>
  join(config.uploadDir, "imports", key);
export async function createImportJob(
  db: PrismaClient,
  userId: string,
  householdId: string,
  buffer: Buffer,
  config: Config,
) {
  await membership(db, userId, householdId, true);
  const entries = await parseTandoor(buffer, householdId);
  const preview = tandoorPreview(entries);
  const key = `${randomUUID()}.zip`;
  await mkdir(join(config.uploadDir, "imports"), { recursive: true });
  await writeFile(archivePath(config, key), buffer, {
    flag: "wx",
    mode: 0o600,
  });
  try {
    return await db.$transaction(async (tx) => {
      await lockHousehold(tx, householdId);
      await membership(tx, userId, householdId, true);
      if ((await tx.importJob.count({ where: { userId } })) >= 20)
        throw new RecipeError(
          400,
          "Höchstens 20 gespeicherte Importaufträge. Alte Berichte zuerst löschen.",
        );
      const job = await tx.importJob.create({
        data: {
          userId,
          householdId,
          archiveKey: key,
          archiveHash: createHash("sha256").update(buffer).digest("hex"),
          preview: preview as unknown as Prisma.InputJsonValue,
        },
      });
      return { id: job.id, status: job.status, preview: job.preview };
    }, txOptions);
  } catch (error) {
    await unlink(archivePath(config, key)).catch(() => {});
    throw error;
  }
}
async function jobAccess(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  id: string,
  write = false,
) {
  const job = await db.importJob.findFirst({ where: { id, userId } });
  if (!job) throw new RecipeError(404, "Import nicht gefunden.");
  await membership(db, userId, job.householdId, write);
  return job;
}
export async function importJobs(
  db: PrismaClient,
  userId: string,
  householdId: string,
) {
  return db.$transaction(
    async (tx) => {
      await membership(tx, userId, householdId);
      return tx.importJob.findMany({
        where: { householdId, userId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, status: true, createdAt: true, error: true },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function importJob(db: PrismaClient, userId: string, id: string) {
  return db.$transaction(
    async (tx) => {
      const job = await jobAccess(tx, userId, id);
      const results = await tx.importResult.findMany({
        where: { jobId: id },
        orderBy: { position: "asc" },
      });
      const ids = results.flatMap((result) =>
        result.recipeId ? [result.recipeId] : [],
      );
      const accessible = new Set(
        (
          await tx.recipe.findMany({
            where: {
              id: { in: ids },
              deletedAt: null,
              ...visibleRecipeWhere(userId),
            },
            select: { id: true },
          })
        ).map((recipe) => recipe.id),
      );
      return {
        id: job.id,
        status: job.status,
        visibility: job.visibility,
        targetBookId: job.targetBookId,
        preview: job.preview,
        error: job.error,
        results: results.map((result) => ({
          position: result.position,
          title: result.title,
          status: result.status,
          message: result.message,
          recipeId:
            result.recipeId && accessible.has(result.recipeId)
              ? result.recipeId
              : null,
        })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function changeImportJob(
  db: PrismaClient,
  userId: string,
  id: string,
  action: "START" | "CANCEL" | "DELETE",
  config: Config,
  visibility: "PRIVATE" | "HOUSEHOLD" = "PRIVATE",
  targetBookId: string | null = null,
) {
  const job = await jobAccess(db, userId, id, action !== "DELETE");
  const remove = await db.$transaction(async (tx) => {
    await lockHousehold(tx, job.householdId);
    const current = await jobAccess(tx, userId, id, action !== "DELETE");
    if (action === "START") {
      if (
        !["DRAFT", "FAILED", "CANCELLED", "COMPLETED"].includes(current.status)
      )
        throw new RecipeError(
          409,
          "Dieser Import ist bereits gestartet oder abgeschlossen.",
        );
      if (
        current.status === "COMPLETED" &&
        !(await tx.importResult.count({
          where: { jobId: id, status: "FAILED" },
        }))
      )
        throw new RecipeError(
          409,
          "Dieser Import ist bereits vollständig abgeschlossen.",
        );
      if (
        targetBookId &&
        !(await tx.cookbook.findFirst({
          where: { id: targetBookId, householdId: job.householdId },
        }))
      )
        throw new RecipeError(404, "Zielbuch nicht gefunden.");
      if (
        current.status !== "DRAFT" &&
        (current.visibility !== visibility ||
          current.targetBookId !== targetBookId)
      )
        throw new RecipeError(
          409,
          "Beim Fortsetzen müssen Sichtbarkeit und Zielbuch unverändert bleiben.",
        );
      await tx.importResult.deleteMany({
        where: { jobId: id, status: "FAILED" },
      });
      await tx.importJob.update({
        where: { id },
        data: {
          status: "QUEUED",
          visibility,
          targetBookId,
          error: "",
          runToken: null,
          leaseUntil: null,
        },
      });
    } else if (action === "CANCEL")
      await tx.importJob.update({
        where: { id },
        data: { status: "CANCELLED", runToken: null, leaseUntil: null },
      });
    else {
      if (["RUNNING", "QUEUED"].includes(current.status))
        throw new RecipeError(409, "Laufenden Import zuerst abbrechen.");
      await tx.importJob.delete({ where: { id } });
      return current.archiveKey;
    }
  }, txOptions);
  if (remove) await unlink(archivePath(config, remove)).catch(() => {});
}
async function processJob(
  db: PrismaClient,
  config: Config,
  job: ImportJob,
  token: string,
  stop: () => boolean,
) {
  const buffer = await readFile(archivePath(config, job.archiveKey));
  if (createHash("sha256").update(buffer).digest("hex") !== job.archiveHash)
    throw new RecipeError(400, "Archivprüfsumme stimmt nicht.");
  const entries = await parseTandoor(buffer, job.householdId);
  for (const [position, entry] of entries.entries()) {
    if (stop()) {
      await db.importJob.updateMany({
        where: { id: job.id, runToken: token, status: "RUNNING" },
        data: { status: "QUEUED", runToken: null, leaseUntil: null },
      });
      return;
    }
    const current = await db.importJob.findFirst({
      where: { id: job.id, runToken: token, status: "RUNNING" },
    });
    if (!current) return;
    const existing = await db.importResult.findUnique({
      where: { jobId_position: { jobId: job.id, position } },
    });
    if (existing && existing.status !== "FAILED") continue;
    let fileKey: string | null = null;
    let image: Buffer | null = null;
    let retained = false;
    const warnings = [...entry.warnings];
    try {
      if (!entry.draft)
        throw new RecipeError(400, entry.error || "Rezeptdaten ungültig.");
      if (entry.image && entry.imageMime) {
        try {
          image = await normalizeImage(entry.image, entry.imageMime);
        } catch {
          warnings.push(
            "Bild nicht übernommen: beschädigt oder nicht unterstützt.",
          );
        }
        if (image) {
          fileKey = `${randomUUID()}.webp`;
          await mkdir(config.uploadDir, { recursive: true });
          await writeFile(join(config.uploadDir, fileKey), image, {
            flag: "wx",
            mode: 0o600,
          });
        }
      }
      retained = await db.$transaction(async (tx) => {
        await lockHousehold(tx, job.householdId);
        await membership(tx, job.userId, job.householdId, true);
        if (
          !(await tx.importJob.findFirst({
            where: { id: job.id, runToken: token, status: "RUNNING" },
          }))
        )
          return false;
        const prior = await tx.importResult.findUnique({
          where: { jobId_position: { jobId: job.id, position } },
        });
        if (prior && prior.status !== "FAILED") return false;
        const receipt = await tx.importReceipt.findUnique({
          where: {
            householdId_kind_contentHash: {
              householdId: job.householdId,
              kind: "TANDOOR",
              contentHash: entry.contentHash,
            },
          },
        });
        const recipe = receipt
          ? await tx.recipe.findFirst({
              where: {
                id: receipt.recipeId,
                deletedAt: null,
                ...visibleRecipeWhere(job.userId),
              },
            })
          : await saveRecipeTx(tx, job.userId, {
              ...entry.draft!,
              visibility: job.visibility,
            });
        if (!receipt && recipe) {
          await tx.importReceipt.create({
            data: {
              householdId: job.householdId,
              kind: "TANDOOR",
              contentHash: entry.contentHash,
              recipeId: recipe.id,
            },
          });
          if (fileKey && image)
            await tx.recipeImage.create({
              data: {
                recipeId: recipe.id,
                storageKey: fileKey,
                bytes: image.length,
              },
            });
        }
        if (job.targetBookId && recipe) {
          const book = await tx.cookbook.findFirst({
            where: { id: job.targetBookId, householdId: job.householdId },
          });
          if (book) {
            await tx.cookbookRecipe.upsert({
              where: {
                cookbookId_recipeId: {
                  cookbookId: book.id,
                  recipeId: recipe.id,
                },
              },
              create: { cookbookId: book.id, recipeId: recipe.id },
              update: {},
            });
            await tx.cookbook.update({
              where: { id: book.id },
              data: { revision: { increment: 1 } },
            });
          } else warnings.push("Zielbuch inzwischen gelöscht.");
        }
        await tx.importResult.upsert({
          where: { jobId_position: { jobId: job.id, position } },
          create: {
            jobId: job.id,
            position,
            title: entry.title,
            status: receipt ? "SKIPPED" : "CREATED",
            message: [
              receipt
                ? "Bereits importiert; lokale Änderungen bleiben erhalten."
                : "",
              ...warnings,
            ]
              .filter(Boolean)
              .join("\n")
              .slice(0, 1000),
            recipeId: recipe?.id ?? null,
          },
          update: {
            status: receipt ? "SKIPPED" : "CREATED",
            message: warnings.join("\n").slice(0, 1000),
            recipeId: recipe?.id ?? null,
          },
        });
        await tx.importJob.update({
          where: { id: job.id },
          data: { leaseUntil: new Date(Date.now() + 120000) },
        });
        return !receipt && Boolean(fileKey);
      }, txOptions);
    } catch (error) {
      if (error instanceof RecipeError && [403, 404].includes(error.statusCode))
        throw error;
      const message =
        error instanceof RecipeError
          ? error.message
          : "Rezept konnte nicht gespeichert werden.";
      await db.$transaction(async (tx) => {
        await lockHousehold(tx, job.householdId);
        if (
          await tx.importJob.findFirst({
            where: { id: job.id, runToken: token, status: "RUNNING" },
          })
        )
          await tx.importResult.upsert({
            where: { jobId_position: { jobId: job.id, position } },
            create: {
              jobId: job.id,
              position,
              title: entry.title,
              status: "FAILED",
              message,
            },
            update: { status: "FAILED", message, recipeId: null },
          });
      }, txOptions);
    } finally {
      if (fileKey && !retained)
        await unlink(join(config.uploadDir, fileKey)).catch(() => {});
    }
  }
  await db.importJob.updateMany({
    where: { id: job.id, runToken: token, status: "RUNNING" },
    data: { status: "COMPLETED", runToken: null, leaseUntil: null },
  });
}
export async function processNextImport(
  db: PrismaClient,
  config: Config,
  stop: () => boolean = () => false,
) {
  const job = await db.importJob.findFirst({
    where: {
      OR: [
        { status: "QUEUED" },
        { status: "RUNNING", leaseUntil: { lt: new Date() } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
  if (!job) return false;
  const token = randomUUID();
  const claimed = await db.importJob.updateMany({
    where: {
      id: job.id,
      OR: [
        { status: "QUEUED" },
        { status: "RUNNING", leaseUntil: { lt: new Date() } },
      ],
    },
    data: {
      status: "RUNNING",
      runToken: token,
      leaseUntil: new Date(Date.now() + 120000),
    },
  });
  if (!claimed.count) return false;
  try {
    await processJob(db, config, job, token, stop);
  } catch (error) {
    await db.importJob.updateMany({
      where: { id: job.id, runToken: token },
      data: {
        status: "FAILED",
        runToken: null,
        leaseUntil: null,
        error:
          error instanceof RecipeError
            ? error.message
            : "Import konnte nicht verarbeitet werden. Archiv und Datenbank prüfen.",
      },
    });
  }
  return true;
}
export function startImportWorker(
  db: PrismaClient,
  config: Config,
  onError: () => void,
) {
  let stopped = false;
  let pending: Promise<void> | null = null;
  const tick = () => {
    if (stopped || pending) return;
    pending = processNextImport(db, config, () => stopped)
      .then(() => {})
      .catch(onError)
      .finally(() => {
        pending = null;
      });
  };
  const timer = setInterval(tick, 3000);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    if (pending) await pending;
  };
}
