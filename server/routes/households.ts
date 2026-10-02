import type { FastifyInstance, FastifyRequest } from "fastify";
import { Prisma, type PrismaClient, type HouseholdRole } from "@prisma/client";
import type { Config } from "../lib/config";
import { RecipeError } from "../lib/errors";
import { authService } from "../services/auth";
import {
  createHousehold,
  householdDetail,
  renameHousehold,
  changeMember,
  createInvitation,
  revokeInvitation,
  previewInvitation,
  acceptInvitation,
  registerInvitation,
} from "../services/households";
import {
  householdParams,
  householdNameBody,
  householdRenameBody,
  memberParams,
  roleBody,
  householdRevisionQuery,
  householdRevisionBody,
  invitationBody,
  invitationParams,
  invitationToken,
  invitationRegistration,
} from "../lib/household-schemas";
export async function householdRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  config: Config,
) {
  const auth = authService(db, config);
  const secure = { tags: ["Households"], security: [{ cookieAuth: [] }] };
  async function userId(request: FastifyRequest) {
    const user = await auth.currentUser(request);
    if (!user) throw new RecipeError(401, "Bitte anmelden.");
    return user.id;
  }
  app.get("/households", { schema: secure }, async (request) => ({
    households: await db.householdMember.findMany({
      where: { userId: await userId(request) },
      select: { role: true, household: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: "asc" }, { householdId: "asc" }],
    }),
  }));
  app.post<{ Body: { name: string } }>(
    "/households",
    {
      schema: { ...secure, body: householdNameBody },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) =>
      reply.code(201).send({
        household: await createHousehold(
          db,
          await userId(request),
          request.body.name,
        ),
      }),
  );
  app.get<{ Params: { id: string } }>(
    "/households/:id",
    { schema: { ...secure, params: householdParams } },
    async (request) => {
      const actor = await userId(request);
      return {
        household: await db.$transaction(
          (tx) => householdDetail(tx, actor, request.params.id),
          { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
        ),
      };
    },
  );
  app.patch<{
    Params: { id: string };
    Body: { name: string; revision: number };
  }>(
    "/households/:id",
    {
      schema: { ...secure, params: householdParams, body: householdRenameBody },
    },
    async (request) => ({
      household: await renameHousehold(
        db,
        await userId(request),
        request.params.id,
        request.body.name,
        request.body.revision,
      ),
    }),
  );
  app.patch<{
    Params: { id: string; userId: string };
    Body: { role: HouseholdRole; revision: number };
  }>(
    "/households/:id/members/:userId",
    { schema: { ...secure, params: memberParams, body: roleBody } },
    async (request) =>
      changeMember(
        db,
        await userId(request),
        request.params.id,
        request.params.userId,
        request.body.role,
        request.body.revision,
      ),
  );
  app.delete<{
    Params: { id: string; userId: string };
    Querystring: { revision: number };
  }>(
    "/households/:id/members/:userId",
    {
      schema: {
        ...secure,
        params: memberParams,
        querystring: householdRevisionQuery,
      },
    },
    async (request) =>
      changeMember(
        db,
        await userId(request),
        request.params.id,
        request.params.userId,
        null,
        request.query.revision,
      ),
  );
  app.post<{ Params: { id: string }; Body: { revision: number } }>(
    "/households/:id/leave",
    {
      schema: {
        ...secure,
        params: householdParams,
        body: householdRevisionBody,
      },
    },
    async (request) => {
      const actor = await userId(request);
      return changeMember(
        db,
        actor,
        request.params.id,
        actor,
        null,
        request.body.revision,
        true,
      );
    },
  );
  app.post<{
    Params: { id: string };
    Body: { email: string; role: HouseholdRole; revision: number };
  }>(
    "/households/:id/invitations",
    {
      schema: { ...secure, params: householdParams, body: invitationBody },
      config: { rateLimit: { max: 15, timeWindow: "1 minute" } },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await createInvitation(
            db,
            await userId(request),
            request.params.id,
            request.body.email,
            request.body.role,
            request.body.revision,
            config.origin,
          ),
        ),
  );
  app.delete<{
    Params: { id: string; invitationId: string };
    Querystring: { revision: number };
  }>(
    "/households/:id/invitations/:invitationId",
    {
      schema: {
        ...secure,
        params: invitationParams,
        querystring: householdRevisionQuery,
      },
    },
    async (request) =>
      revokeInvitation(
        db,
        await userId(request),
        request.params.id,
        request.params.invitationId,
        request.query.revision,
      ),
  );
  const tokenLimit = { rateLimit: { max: 15, timeWindow: "1 minute" } };
  app.post<{ Body: { token: string } }>(
    "/household-invitations/preview",
    {
      schema: { tags: ["Invitations"], body: invitationToken },
      config: tokenLimit,
    },
    async (request) => previewInvitation(db, request.body.token),
  );
  app.post<{ Body: { token: string } }>(
    "/household-invitations/accept",
    { schema: { ...secure, body: invitationToken }, config: tokenLimit },
    async (request) =>
      acceptInvitation(db, request.body.token, await userId(request)),
  );
  app.post<{
    Body: { token: string; name: string; email: string; password: string };
  }>(
    "/household-invitations/register",
    {
      schema: { tags: ["Invitations"], body: invitationRegistration },
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const result = await registerInvitation(db, request.body);
      await auth.issueSession(result.user.id, reply);
      return reply.code(201).send(result);
    },
  );
}
