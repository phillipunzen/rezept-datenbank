import type { FastifyInstance, FastifyRequest } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { Config } from "../lib/config";
import { authService } from "../services/auth";
import {
  membership,
  readRecipe,
  recipeRow,
  RecipeError,
  saveRecipe,
  setDeleted,
  listRecipes,
  lockRecipe,
  visibleRecipeWhere,
  type ListOptions,
} from "../services/recipes";
import {
  recipeBody,
  recipeUpdate,
  idParams,
  listQuery,
  detailResponse,
  pageResponse,
  revisionQuery,
} from "../lib/recipe-schemas";
import type { RecipeInput } from "../../shared/recipes";
import { imageRoutes } from "./recipe-images";
import { recipeAccessRoutes } from "./recipe-access";
import { importRecipeUrl } from "../services/recipe-import";
import type { RemoteFetcher } from "../lib/safe-fetch";
export async function recipeRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  config: Config,
  fetcher?: RemoteFetcher,
) {
  const auth = authService(db, config);
  async function userId(request: FastifyRequest) {
    const user = await auth.currentUser(request);
    if (!user) throw new RecipeError(401, "Bitte anmelden.");
    return user.id;
  }
  const secure = { tags: ["Recipes"], security: [{ cookieAuth: [] }] };
  app.post<{ Body: { householdId: string; url: string } }>(
    "/recipe-imports/preview",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        ...secure,
        summary:
          "Import a recipe website into an editable draft, including its image",
        body: {
          type: "object",
          additionalProperties: false,
          required: ["householdId", "url"],
          properties: {
            householdId: { type: "string", minLength: 1, maxLength: 30 },
            url: { type: "string", minLength: 1, maxLength: 2048 },
          },
        },
      },
    },
    async (request) => {
      await membership(
        db,
        await userId(request),
        request.body.householdId,
        true,
      );
      return importRecipeUrl(
        request.body.url,
        request.body.householdId,
        fetcher,
      );
    },
  );
  app.get<{ Querystring: ListOptions }>(
    "/recipes",
    {
      schema: {
        ...secure,
        querystring: listQuery,
        response: { 200: pageResponse },
      },
    },
    async (request) => listRecipes(db, await userId(request), request.query),
  );
  app.get<{
    Params: { id: string };
    Querystring: { includeDeleted?: boolean };
  }>(
    "/recipes/:id",
    {
      schema: {
        ...secure,
        params: idParams,
        querystring: {
          type: "object",
          properties: { includeDeleted: { type: "boolean" } },
        },
        response: { 200: detailResponse },
      },
    },
    async (request) => ({
      recipe: await db.$transaction(
        async (tx) =>
          readRecipe(
            tx,
            await userId(request),
            request.params.id,
            request.query.includeDeleted,
          ),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      ),
    }),
  );
  app.post<{ Body: RecipeInput }>(
    "/recipes",
    {
      bodyLimit: 128 * 1024,
      schema: {
        ...secure,
        body: recipeBody,
        response: { 201: detailResponse },
      },
    },
    async (request, reply) =>
      reply.code(201).send({
        recipe: await saveRecipe(db, await userId(request), request.body),
      }),
  );
  app.patch<{
    Params: { id: string };
    Body: RecipeInput & { revision: number };
  }>(
    "/recipes/:id",
    {
      bodyLimit: 128 * 1024,
      schema: {
        ...secure,
        params: idParams,
        body: recipeUpdate,
        response: { 200: detailResponse },
      },
    },
    async (request) => ({
      recipe: await saveRecipe(
        db,
        await userId(request),
        request.body,
        request.params.id,
        request.body.revision,
      ),
    }),
  );
  app.delete<{ Params: { id: string }; Querystring: { revision: number } }>(
    "/recipes/:id",
    {
      schema: {
        ...secure,
        params: idParams,
        querystring: revisionQuery,
        response: { 200: detailResponse },
      },
    },
    async (request) => ({
      recipe: await setDeleted(
        db,
        await userId(request),
        request.params.id,
        request.query.revision,
        false,
      ),
    }),
  );
  app.post<{ Params: { id: string }; Body: { revision: number } }>(
    "/recipes/:id/restore",
    {
      schema: {
        ...secure,
        params: idParams,
        body: {
          type: "object",
          required: ["revision"],
          properties: { revision: { type: "integer", minimum: 1 } },
        },
        response: { 200: detailResponse },
      },
    },
    async (request) => ({
      recipe: await setDeleted(
        db,
        await userId(request),
        request.params.id,
        request.body.revision,
        true,
      ),
    }),
  );
  app.put<{ Params: { id: string }; Body: { favorite: boolean } }>(
    "/recipes/:id/favorite",
    {
      schema: {
        ...secure,
        params: idParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["favorite"],
          properties: { favorite: { type: "boolean" } },
        },
        response: { 200: detailResponse },
      },
    },
    async (request) => {
      const id = await userId(request);
      return db.$transaction(
        async (tx) => {
          await lockRecipe(tx, id, request.params.id);
          if (request.body.favorite)
            await tx.favorite.upsert({
              where: {
                recipeId_userId: { recipeId: request.params.id, userId: id },
              },
              create: { recipeId: request.params.id, userId: id },
              update: {},
            });
          else
            await tx.favorite.deleteMany({
              where: { recipeId: request.params.id, userId: id },
            });
          return { recipe: await readRecipe(tx, id, request.params.id) };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    },
  );
  app.put<{ Params: { id: string }; Body: { rating: number | null } }>(
    "/recipes/:id/rating",
    {
      schema: {
        ...secure,
        params: idParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["rating"],
          properties: {
            rating: {
              anyOf: [
                { type: "integer", minimum: 1, maximum: 5 },
                { type: "null" },
              ],
            },
          },
        },
        response: { 200: detailResponse },
      },
    },
    async (request) => {
      const id = await userId(request);
      return db.$transaction(
        async (tx) => {
          await lockRecipe(tx, id, request.params.id);
          if (request.body.rating === null)
            await tx.rating.deleteMany({
              where: { recipeId: request.params.id, userId: id },
            });
          else
            await tx.rating.upsert({
              where: {
                recipeId_userId: { recipeId: request.params.id, userId: id },
              },
              create: {
                recipeId: request.params.id,
                userId: id,
                value: request.body.rating,
              },
              update: { value: request.body.rating },
            });
          return { recipe: await readRecipe(tx, id, request.params.id) };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    },
  );
  app.get<{ Querystring: { householdId: string } }>(
    "/recipe-metadata",
    {
      schema: {
        ...secure,
        querystring: {
          type: "object",
          required: ["householdId"],
          properties: { householdId: { type: "string", maxLength: 30 } },
        },
      },
    },
    async (request) => {
      const actor = await userId(request);
      await membership(db, actor, request.query.householdId);
      const where = {
        householdId: request.query.householdId,
        recipes: {
          some: { recipe: { deletedAt: null, ...visibleRecipeWhere(actor) } },
        },
      };
      const [tags, categories, ingredients, units] = await Promise.all([
        db.tag.findMany({
          where,
          select: { name: true },
          orderBy: { name: "asc" },
          take: 200,
        }),
        db.category.findMany({
          where,
          select: { name: true },
          orderBy: { name: "asc" },
          take: 200,
        }),
        db.ingredient.findMany({
          where,
          select: { name: true },
          orderBy: { name: "asc" },
          take: 500,
        }),
        db.unit.findMany({
          where,
          select: { name: true },
          orderBy: { name: "asc" },
          take: 100,
        }),
      ]);
      return {
        tags: tags.map((t) => t.name),
        categories: categories.map((t) => t.name),
        ingredients: ingredients.map((t) => t.name),
        units: units.map((t) => t.name),
      };
    },
  );
  await imageRoutes(app, db, config, userId);
  await recipeAccessRoutes(app, db, userId);
}
