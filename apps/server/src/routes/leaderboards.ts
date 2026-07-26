import {
  decodeLeaderboardCursor,
  httpErrorDetails,
  leaderboardQuerySchema,
} from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
import { resolveRequestIdentity } from "../http/authenticate";
import { sendError } from "../http/errors";
import type { IdentityResolvers } from "../identity/resolve";
import type { LeaderboardService } from "../leaderboard/service";

type LeaderboardQueryString = Readonly<{
  period?: string;
  cursor?: string;
  limit?: string;
}>;

/**
 * The public boards of spec section 11.3. A caller who presents a session token also
 * gets their own row, wherever it falls, from the same query
 * (docs/adr/0028-leaderboards-are-read-time-queries.md).
 */
export function registerLeaderboardRoutes(
  app: FastifyInstance,
  leaderboards: LeaderboardService,
  resolvers: IdentityResolvers,
): void {
  app.get<{ Querystring: LeaderboardQueryString }>("/v1/leaderboards", async (request, reply) => {
    const parsed = leaderboardQuerySchema.safeParse({
      period: request.query.period ?? "all-time",
      ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
      ...(request.query.limit === undefined ? {} : { limit: Number(request.query.limit) }),
    });
    if (!parsed.success) {
      return sendError(
        request,
        reply,
        "validation_failed",
        "Invalid leaderboard query",
        httpErrorDetails(parsed.error),
      );
    }

    const cursor = parsed.data.cursor ? decodeLeaderboardCursor(parsed.data.cursor) : null;
    if (parsed.data.cursor !== undefined && cursor === null) {
      return sendError(request, reply, "validation_failed", "Invalid leaderboard cursor");
    }

    const identity = await resolveRequestIdentity(resolvers, request);
    return reply.send(
      await leaderboards.read({
        period: parsed.data.period,
        cursor,
        ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }),
        viewerUserId: identity?.actorType === "user" ? identity.actorId : null,
      }),
    );
  });
}
