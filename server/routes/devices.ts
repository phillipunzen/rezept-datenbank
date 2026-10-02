import type { FastifyInstance, FastifyRequest } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import type { Config } from "../lib/config";
import { authService } from "../services/auth";
import { RecipeError } from "../lib/errors";
import { deviceStepsSchema } from "../lib/recipe-document";
import { thermomixTm6Adapter, type DeviceStep } from "../../shared/devices";
import { lockRecipe, readRecipe, detailDto } from "../services/recipes";
import { detailResponse, idParams } from "../lib/recipe-schemas";
export async function deviceRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  config: Config,
) {
  const auth = authService(db, config);
  const user = async (request: FastifyRequest) => {
    const actor = await auth.currentUser(request);
    if (!actor) throw new RecipeError(401, "Bitte anmelden.");
    return actor.id;
  };
  const secure = { tags: ["Device recipes"], security: [{ cookieAuth: [] }] };
  app.get<{ Params: { id: string } }>(
    "/recipes/:id/devices/thermomix-tm6/suggest",
    { schema: { ...secure, params: idParams } },
    async (request) => {
      const recipe = await readRecipe(
        db,
        await user(request),
        request.params.id,
      );
      if (!recipe.canEdit)
        throw new RecipeError(403, "Bearbeitungsrechte erforderlich.");
      return {
        deviceKey: "thermomix-tm6",
        steps: thermomixTm6Adapter.suggest(recipe),
        revision: recipe.revision,
        confirmed: false,
      };
    },
  );
  app.put<{
    Params: { id: string };
    Body: { revision: number; confirmed: true; steps: DeviceStep[] };
  }>(
    "/recipes/:id/devices/thermomix-tm6",
    {
      schema: {
        ...secure,
        params: idParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["revision", "confirmed", "steps"],
          properties: {
            revision: { type: "integer", minimum: 1 },
            confirmed: { type: "boolean", const: true },
            steps: deviceStepsSchema,
          },
        },
        response: { 200: detailResponse },
      },
    },
    async (request) => {
      const actor = await user(request);
      return db.$transaction(
        async (tx) => {
          const { row, canEdit } = await lockRecipe(
            tx,
            actor,
            request.params.id,
            false,
            true,
          );
          const recipe = detailDto(row, actor, canEdit);
          if (recipe.revision !== request.body.revision)
            throw new RecipeError(
              409,
              "Rezept geändert. Geräteschritte neu prüfen.",
            );
          if (request.body.steps.length !== recipe.steps.length)
            throw new RecipeError(
              400,
              "Ein Geräteschritt pro Rezeptschritt erforderlich.",
            );
          for (const step of request.body.steps) {
            const error = thermomixTm6Adapter.validate(step);
            if (error) throw new RecipeError(400, error);
          }
          await tx.recipeVersion.create({
            data: {
              recipeId: row.id,
              authorId: actor,
              revision: row.revision,
              snapshot: JSON.parse(
                JSON.stringify(recipe),
              ) as Prisma.InputJsonValue,
            },
          });
          const data = {
            contentHash: createHash("sha256")
              .update(thermomixTm6Adapter.signature(recipe))
              .digest("hex"),
            data: request.body.steps as unknown as Prisma.InputJsonValue,
            confirmedAt: new Date(),
          };
          await tx.deviceRecipeData.upsert({
            where: {
              recipeId_deviceKey: {
                recipeId: row.id,
                deviceKey: "thermomix-tm6",
              },
            },
            create: { recipeId: row.id, deviceKey: "thermomix-tm6", ...data },
            update: data,
          });
          await tx.recipe.update({
            where: { id: row.id },
            data: { revision: { increment: 1 } },
          });
          return { recipe: await readRecipe(tx, actor, row.id) };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    },
  );
  app.get<{ Params: { id: string } }>(
    "/recipes/:id/devices/thermomix-tm6/export",
    { schema: { ...secure, params: idParams } },
    async (request) => {
      const recipe = await readRecipe(
        db,
        await user(request),
        request.params.id,
      );
      const device = recipe.deviceData.find(
        (data) => data.deviceKey === "thermomix-tm6" && data.current,
      );
      if (!device)
        throw new RecipeError(
          409,
          "Geräteparameter zuerst prüfen und bestätigen.",
        );
      return {
        format: "rezeptdatenbank-device",
        version: 1,
        deviceKey: device.deviceKey,
        title: recipe.title,
        servings: recipe.servings,
        ingredients: recipe.ingredients,
        steps: recipe.steps.map((step, index) => ({
          instruction: step.instruction,
          ingredientIndexes: step.ingredientIndexes ?? [],
          parameters: device.steps[index],
        })),
        notice:
          "Eigener Export; kein zugesagtes Cookidoo-Importformat und keine Gerätesteuerung.",
      };
    },
  );
}
