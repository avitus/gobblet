import { uuidSchema } from "@gobblet/protocol";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveActor } from "../http/authenticate";
import { sendError } from "../http/errors";
import type { IdentityResolvers } from "../identity/resolve";
import type { MatchRuntime } from "../match/runtime";
import type { Actor } from "../match/snapshot";

type MatchParams = Readonly<{ matchId: string }>;

export function registerMatchRoutes(
  app: FastifyInstance,
  runtime: MatchRuntime,
  resolvers: IdentityResolvers,
): void {
  /**
   * Both reads are restricted to participants (spec section 14.3). Everything a
   * non-participant might learn, including whether the match exists at all, is
   * answered with the same not-found shape. Public match history arrives with
   * profiles in Phase 6.
   */
  app.get<{ Params: MatchParams }>("/v1/matches/:matchId", async (request, reply) => {
    const actor = await authorize(request, reply);
    if (!actor) {
      return reply;
    }

    const summary = await runtime.getSummaryForActor(request.params.matchId, actor);
    if (!summary) {
      return sendError(request, reply, "not_found", "Unknown match");
    }
    return reply.send(summary);
  });

  app.get<{ Params: MatchParams }>("/v1/matches/:matchId/snapshot", async (request, reply) => {
    const actor = await authorize(request, reply);
    if (!actor) {
      return reply;
    }

    const snapshot = await runtime.getSnapshotForActor(request.params.matchId, actor);
    if (!snapshot) {
      return sendError(request, reply, "not_found", "Unknown match");
    }
    return reply.send(snapshot);
  });

  async function authorize(
    request: FastifyRequest<{ Params: MatchParams }>,
    reply: FastifyReply,
  ): Promise<Actor | null> {
    if (!uuidSchema.safeParse(request.params.matchId).success) {
      await sendError(request, reply, "not_found", "Unknown match");
      return null;
    }

    const actor = await resolveActor(resolvers, request);
    if (!actor) {
      await sendError(request, reply, "unauthenticated", "A session token is required");
      return null;
    }
    return actor;
  }
}
