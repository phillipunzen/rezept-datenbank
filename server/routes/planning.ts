import type { FastifyInstance, FastifyRequest } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { Config } from "../lib/config";
import { authService } from "../services/auth";
import { RecipeError } from "../lib/errors";
import { planningResponse } from "../lib/planning-schemas";
import * as service from "../services/planning";
import type { IngredientQuantity, MealSlot } from "../../shared/planning";
const text = (maxLength: number, minLength = 0) => ({
  type: "string",
  maxLength,
  minLength,
  ...(minLength ? { pattern: "\\S" } : {}),
});
const id = text(30, 1),
  name = text(120, 1),
  revision = { type: "integer", minimum: 1 };
const servings = { type: "integer", minimum: 1, maximum: 1000 };
const date = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const slot = {
  type: "string",
  enum: ["BREAKFAST", "LUNCH", "DINNER", "SNACK"],
};
const item = {
  name: text(150, 1),
  amount: {
    anyOf: [
      { type: "null" },
      { type: "string", pattern: "^\\d{1,16}(\\.\\d{1,4})?$", maxLength: 21 },
    ],
  },
  unit: text(24),
  note: text(2000),
};
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
export async function planningRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  config: Config,
) {
  app.addHook("onRoute", (route) => {
    const response = planningResponse(String(route.method), route.url);
    if (response)
      route.schema = { ...route.schema, response: { 200: response } };
  });
  const auth = authService(db, config);
  async function user(request: FastifyRequest) {
    const actor = await auth.currentUser(request);
    if (!actor) throw new RecipeError(401, "Bitte anmelden.");
    return actor.id;
  }
  const secure = { tags: ["Planning"], security: [{ cookieAuth: [] }] };
  const params = object({ id });
  const listParams = object({ id, itemId: id });
  const query = object({ householdId: id });
  const read = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
    db.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  app.get<{ Querystring: { householdId: string } }>(
    "/cookbooks",
    {
      schema: {
        ...secure,
        querystring: query,
        summary: "List household cookbooks with accessible recipes",
      },
    },
    async (request) => {
      const actor = await user(request);
      return {
        cookbooks: await read((tx) =>
          service.cookbooks(tx, actor, request.query.householdId),
        ),
      };
    },
  );
  app.post<{
    Body: { householdId: string; name: string; description: string };
  }>(
    "/cookbooks",
    {
      schema: {
        ...secure,
        body: object({ householdId: id, name, description: text(2000) }),
      },
    },
    async (request) => ({
      cookbook: await service.createBook(
        db,
        await user(request),
        request.body.householdId,
        request.body.name,
        request.body.description,
      ),
    }),
  );
  app.patch<{
    Params: { id: string };
    Body: { name: string; description: string; revision: number };
  }>(
    "/cookbooks/:id",
    {
      schema: {
        ...secure,
        params,
        body: object({ name, description: text(2000), revision }),
      },
    },
    async (request) => {
      await service.mutateBook(
        db,
        await user(request),
        request.params.id,
        request.body.revision,
        request.body,
      );
      return { ok: true };
    },
  );
  app.delete<{ Params: { id: string }; Querystring: { revision: number } }>(
    "/cookbooks/:id",
    { schema: { ...secure, params, querystring: object({ revision }) } },
    async (request) => {
      await service.mutateBook(
        db,
        await user(request),
        request.params.id,
        request.query.revision,
        null,
      );
      return { ok: true };
    },
  );
  app.post<{
    Params: { id: string };
    Body: { recipeId: string; revision: number; remove: boolean };
  }>(
    "/cookbooks/:id/recipes",
    {
      schema: {
        ...secure,
        params,
        body: object({ recipeId: id, revision, remove: { type: "boolean" } }),
      },
    },
    async (request) => {
      await service.mutateBook(
        db,
        await user(request),
        request.params.id,
        request.body.revision,
        request.body,
      );
      return { ok: true };
    },
  );
  app.get<{ Querystring: { householdId: string; from: string; to: string } }>(
    "/meal-plan",
    {
      schema: {
        ...secure,
        querystring: object({ householdId: id, from: date, to: date }),
      },
    },
    async (request) => {
      const actor = await user(request);
      return {
        entries: await read((tx) =>
          service.plan(
            tx,
            actor,
            request.query.householdId,
            request.query.from,
            request.query.to,
          ),
        ),
      };
    },
  );
  app.post<{
    Body: {
      householdId: string;
      recipeId: string;
      date: string;
      slot: MealSlot;
      servings: number;
    };
  }>(
    "/meal-plan",
    {
      schema: {
        ...secure,
        body: object({ householdId: id, recipeId: id, date, slot, servings }),
      },
    },
    async (request) => ({
      entry: await service.createPlanEntry(
        db,
        await user(request),
        request.body,
      ),
    }),
  );
  app.patch<{
    Params: { id: string };
    Body: { date: string; slot: MealSlot; servings: number; revision: number };
  }>(
    "/meal-plan/:id",
    {
      schema: {
        ...secure,
        params,
        body: object({ date, slot, servings, revision }),
      },
    },
    async (request) => {
      await service.mutatePlanEntry(
        db,
        await user(request),
        request.params.id,
        request.body.revision,
        request.body,
      );
      return { ok: true };
    },
  );
  app.delete<{ Params: { id: string }; Querystring: { revision: number } }>(
    "/meal-plan/:id",
    { schema: { ...secure, params, querystring: object({ revision }) } },
    async (request) => {
      await service.mutatePlanEntry(
        db,
        await user(request),
        request.params.id,
        request.query.revision,
        null,
      );
      return { ok: true };
    },
  );
  app.get<{ Querystring: { householdId: string } }>(
    "/shopping-lists",
    { schema: { ...secure, querystring: query } },
    async (request) => {
      const actor = await user(request);
      return {
        lists: await read((tx) =>
          service.shoppingLists(tx, actor, request.query.householdId),
        ),
      };
    },
  );
  app.post<{ Body: { householdId: string; name: string } }>(
    "/shopping-lists",
    { schema: { ...secure, body: object({ householdId: id, name }) } },
    async (request) => ({
      list: await service.createList(
        db,
        await user(request),
        request.body.householdId,
        request.body.name,
      ),
    }),
  );
  app.patch<{
    Params: { id: string };
    Body: { name: string; revision: number };
  }>(
    "/shopping-lists/:id",
    { schema: { ...secure, params, body: object({ name, revision }) } },
    async (request) => {
      await service.mutateList(
        db,
        await user(request),
        request.params.id,
        request.body.revision,
        request.body,
      );
      return { ok: true };
    },
  );
  app.delete<{ Params: { id: string }; Querystring: { revision: number } }>(
    "/shopping-lists/:id",
    { schema: { ...secure, params, querystring: object({ revision }) } },
    async (request) => {
      await service.mutateList(
        db,
        await user(request),
        request.params.id,
        request.query.revision,
        null,
      );
      return { ok: true };
    },
  );
  app.post<{
    Params: { id: string };
    Body: IngredientQuantity & { revision: number };
  }>(
    "/shopping-lists/:id/items",
    { schema: { ...secure, params, body: object({ ...item, revision }) } },
    async (request) => {
      await service.addManualItem(
        db,
        await user(request),
        request.params.id,
        request.body.revision,
        request.body,
      );
      return { ok: true };
    },
  );
  app.patch<{
    Params: { id: string; itemId: string };
    Body:
      | { checked: boolean; revision: number }
      | (IngredientQuantity & { checked: boolean; revision: number });
  }>(
    "/shopping-lists/:id/items/:itemId",
    {
      schema: {
        ...secure,
        params: listParams,
        body: {
          ...object({ ...item, checked: { type: "boolean" }, revision }, [
            "checked",
            "revision",
          ]),
          anyOf: [
            { required: ["name", "amount", "unit", "note"] },
            {
              not: {
                anyOf: [
                  { required: ["name"] },
                  { required: ["amount"] },
                  { required: ["unit"] },
                  { required: ["note"] },
                ],
              },
            },
          ],
        },
      },
    },
    async (request) => {
      await service.mutateItem(
        db,
        await user(request),
        request.params.id,
        request.params.itemId,
        request.body.revision,
        request.body,
      );
      return { ok: true };
    },
  );
  app.delete<{
    Params: { id: string; itemId: string };
    Querystring: { revision: number };
  }>(
    "/shopping-lists/:id/items/:itemId",
    {
      schema: {
        ...secure,
        params: listParams,
        querystring: object({ revision }),
      },
    },
    async (request) => {
      await service.mutateItem(
        db,
        await user(request),
        request.params.id,
        request.params.itemId,
        request.query.revision,
        null,
      );
      return { ok: true };
    },
  );
  app.post<{
    Params: { id: string };
    Body: {
      recipeId: string;
      servings: number;
      revision: number;
      sharePrivate: boolean;
    };
  }>(
    "/shopping-lists/:id/from-recipe",
    {
      schema: {
        ...secure,
        params,
        body: object({
          recipeId: id,
          servings,
          revision,
          sharePrivate: { type: "boolean" },
        }),
      },
    },
    async (request) => {
      await service.addRecipeToList(
        db,
        await user(request),
        request.params.id,
        request.body.revision,
        request.body.recipeId,
        request.body.servings,
        request.body.sharePrivate,
      );
      return { ok: true };
    },
  );
  app.post<{
    Params: { id: string };
    Body: { from: string; to: string; revision: number; sharePrivate: boolean };
  }>(
    "/shopping-lists/:id/from-plan",
    {
      schema: {
        ...secure,
        params,
        body: object({
          from: date,
          to: date,
          revision,
          sharePrivate: { type: "boolean" },
        }),
      },
    },
    async (request) => {
      await service.addPlanToList(
        db,
        await user(request),
        request.params.id,
        request.body.revision,
        request.body.from,
        request.body.to,
        request.body.sharePrivate,
      );
      return { ok: true };
    },
  );
  app.get<{ Querystring: { householdId: string } }>(
    "/cooking-history",
    { schema: { ...secure, querystring: query } },
    async (request) => {
      const actor = await user(request);
      return {
        events: await read((tx) =>
          service.cookingHistory(tx, actor, request.query.householdId),
        ),
      };
    },
  );
  app.post<{
    Params: { id: string };
    Body: { servings: number; note: string; requestKey: string };
  }>(
    "/recipes/:id/cooking-history",
    {
      schema: {
        ...secure,
        params,
        body: object({
          servings,
          note: text(2000),
          requestKey: {
            type: "string",
            pattern: "^[a-zA-Z0-9_-]{8,100}$",
            maxLength: 100,
          },
        }),
      },
    },
    async (request) => ({
      event: await service.completeCooking(
        db,
        await user(request),
        request.params.id,
        request.body.servings,
        request.body.note,
        request.body.requestKey,
      ),
    }),
  );
  app.delete<{ Params: { id: string } }>(
    "/cooking-history/:id",
    { schema: { ...secure, params } },
    async (request) => {
      await service.deleteCookingEvent(
        db,
        await user(request),
        request.params.id,
      );
      return { ok: true };
    },
  );
}
