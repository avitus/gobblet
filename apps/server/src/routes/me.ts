import { httpErrorDetails, updateProfileRequestSchema } from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
import { requireIdentity } from "../http/authenticate";
import { sendError } from "../http/errors";
import type { IdentityResolvers } from "../identity/resolve";
import type { IdentityService } from "../identity/service";
import type { MatchRuntime } from "../match/runtime";

const MATCH_HISTORY_LIMIT = 20;

/**
 * The private account surface (spec sections 11.1 and 14.2). It shows the email,
 * which the public profile must never do, and it is readable while an account is
 * suspended so a player can see their own state.
 */
export function registerMeRoutes(
  app: FastifyInstance,
  identity: IdentityService,
  resolvers: IdentityResolvers,
  runtime: MatchRuntime,
): void {
  app.get("/v1/me", async (request, reply) => {
    const resolved = await requireIdentity(resolvers, request, reply);
    if (!resolved) {
      return reply;
    }
    if (resolved.actorType !== "user") {
      return sendError(request, reply, "forbidden", "This endpoint requires an account");
    }

    const me = await identity.getMe(resolved.actorId);
    if (!me) {
      return sendError(request, reply, "not_found", "Unknown account");
    }
    return reply.send(me);
  });

  app.patch("/v1/me/profile", async (request, reply) => {
    const resolved = await requireIdentity(resolvers, request, reply);
    if (!resolved) {
      return reply;
    }
    if (resolved.actorType !== "user") {
      return sendError(request, reply, "forbidden", "This endpoint requires an account");
    }

    const parsed = updateProfileRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(
        request,
        reply,
        "validation_failed",
        "Invalid profile update",
        httpErrorDetails(parsed.error),
      );
    }

    const profile = await identity.updateProfile(resolved.actorId, parsed.data);
    return reply.send(profile);
  });

  app.get("/v1/me/matches", async (request, reply) => {
    const resolved = await requireIdentity(resolvers, request, reply);
    if (!resolved) {
      return reply;
    }

    const matches = await runtime.listPlayerSummariesForActor(
      { actorType: resolved.actorType, actorId: resolved.actorId },
      MATCH_HISTORY_LIMIT,
    );
    return reply.send({ matches });
  });

  /**
   * The whole catalogue with this account's progress (spec section 11.4), so the
   * client can show what is still unearned without a second definition of the set.
   */
  app.get("/v1/me/achievements", async (request, reply) => {
    const resolved = await requireIdentity(resolvers, request, reply);
    if (!resolved) {
      return reply;
    }
    if (resolved.actorType !== "user") {
      return sendError(request, reply, "forbidden", "This endpoint requires an account");
    }

    return reply.send({ achievements: await identity.achievements(resolved.actorId) });
  });
}
