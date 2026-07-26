import {
  adminAchievementCreateRequestSchema,
  adminAchievementUpdateRequestSchema,
  adminAuditQuerySchema,
  adminRatingAdjustRequestSchema,
  adminSuspendRequestSchema,
  adminUserSearchQuerySchema,
  httpErrorDetails,
} from "@gobblet/protocol";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAdmin } from "../admin/guard";
import type { AdminGuardOptions } from "../admin/guard";
import type { AdminFailure, AdminResult, AdminService } from "../admin/service";
import { sendError } from "../http/errors";

/**
 * The administrative routes of spec section 16
 * (docs/adr/0029-administration-is-a-role-on-the-account.md). Every one of them
 * checks the role first, and every mutation carries the reason that becomes the
 * audit record.
 */

type SearchQueryString = Readonly<{
  query?: string;
  status?: string;
  limit?: string;
  cursor?: string;
}>;

type AuditQueryString = Readonly<{
  action?: string;
  targetId?: string;
  limit?: string;
  cursor?: string;
}>;

export function registerAdminRoutes(
  app: FastifyInstance,
  admin: AdminService,
  guard: AdminGuardOptions,
): void {
  app.get<{ Querystring: SearchQueryString }>("/v1/admin/users", async (request, reply) => {
    if (!(await requireAdmin(guard, request, reply))) {
      return reply;
    }

    const parsed = adminUserSearchQuerySchema.safeParse({
      ...(request.query.query === undefined ? {} : { query: request.query.query }),
      ...(request.query.status === undefined ? {} : { status: request.query.status }),
      ...(request.query.limit === undefined ? {} : { limit: Number(request.query.limit) }),
      ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
    });
    if (!parsed.success) {
      return invalid(request, reply, "Invalid user search", parsed.error);
    }

    return reply.send(await admin.searchUsers(parsed.data));
  });

  app.get<{ Params: { userId: string } }>("/v1/admin/users/:userId", async (request, reply) => {
    if (!(await requireAdmin(guard, request, reply))) {
      return reply;
    }
    return answer(request, reply, await admin.userDetail(request.params.userId));
  });

  app.post<{ Params: { userId: string } }>(
    "/v1/admin/users/:userId/suspend",
    async (request, reply) => {
      const actor = await requireAdmin(guard, request, reply);
      if (!actor) {
        return reply;
      }

      const parsed = adminSuspendRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalid(request, reply, "A reason is required", parsed.error);
      }

      return answer(
        request,
        reply,
        await admin.suspend(actor, request.params.userId, parsed.data.reason),
      );
    },
  );

  app.post<{ Params: { userId: string } }>(
    "/v1/admin/users/:userId/reinstate",
    async (request, reply) => {
      const actor = await requireAdmin(guard, request, reply);
      if (!actor) {
        return reply;
      }

      const parsed = adminSuspendRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalid(request, reply, "A reason is required", parsed.error);
      }

      return answer(
        request,
        reply,
        await admin.reinstate(actor, request.params.userId, parsed.data.reason),
      );
    },
  );

  app.post<{ Params: { userId: string } }>(
    "/v1/admin/users/:userId/rating",
    async (request, reply) => {
      const actor = await requireAdmin(guard, request, reply);
      if (!actor) {
        return reply;
      }

      const parsed = adminRatingAdjustRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalid(request, reply, "Invalid rating correction", parsed.error);
      }

      return answer(
        request,
        reply,
        await admin.adjustRating(
          actor,
          request.params.userId,
          parsed.data.rating,
          parsed.data.reason,
        ),
      );
    },
  );

  app.get<{ Params: { matchId: string } }>("/v1/admin/matches/:matchId", async (request, reply) => {
    if (!(await requireAdmin(guard, request, reply))) {
      return reply;
    }
    return answer(request, reply, await admin.matchDetail(request.params.matchId));
  });

  app.get("/v1/admin/matches", async (request, reply) => {
    if (!(await requireAdmin(guard, request, reply))) {
      return reply;
    }
    return reply.send({ matches: await admin.activeMatches() });
  });

  app.get("/v1/admin/achievements", async (request, reply) => {
    if (!(await requireAdmin(guard, request, reply))) {
      return reply;
    }
    return reply.send({ achievements: await admin.achievements() });
  });

  app.post("/v1/admin/achievements", async (request, reply) => {
    const actor = await requireAdmin(guard, request, reply);
    if (!actor) {
      return reply;
    }

    const parsed = adminAchievementCreateRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalid(request, reply, "Invalid achievement", parsed.error);
    }

    return answer(request, reply, await admin.createAchievement(actor, parsed.data));
  });

  app.patch<{ Params: { achievementId: string } }>(
    "/v1/admin/achievements/:achievementId",
    async (request, reply) => {
      const actor = await requireAdmin(guard, request, reply);
      if (!actor) {
        return reply;
      }

      const parsed = adminAchievementUpdateRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalid(request, reply, "Invalid achievement update", parsed.error);
      }

      return answer(
        request,
        reply,
        await admin.updateAchievement(actor, request.params.achievementId, parsed.data),
      );
    },
  );

  app.get("/v1/admin/metrics", async (request, reply) => {
    if (!(await requireAdmin(guard, request, reply))) {
      return reply;
    }
    return reply.send(await admin.metricsSummary());
  });

  app.get<{ Querystring: AuditQueryString }>("/v1/admin/audit", async (request, reply) => {
    if (!(await requireAdmin(guard, request, reply))) {
      return reply;
    }

    const parsed = adminAuditQuerySchema.safeParse({
      ...(request.query.action === undefined ? {} : { action: request.query.action }),
      ...(request.query.targetId === undefined ? {} : { targetId: request.query.targetId }),
      ...(request.query.limit === undefined ? {} : { limit: Number(request.query.limit) }),
      ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
    });
    if (!parsed.success) {
      return invalid(request, reply, "Invalid audit query", parsed.error);
    }

    return reply.send(await admin.auditLog(parsed.data));
  });
}

function invalid(
  request: FastifyRequest,
  reply: FastifyReply,
  message: string,
  error: Parameters<typeof httpErrorDetails>[0],
): FastifyReply {
  return sendError(request, reply, "validation_failed", message, httpErrorDetails(error));
}

const REFUSALS: Readonly<
  Record<AdminFailure, Readonly<{ code: "not_found" | "conflict"; message: string }>>
> = Object.freeze({
  "unknown-user": { code: "not_found", message: "Unknown account" },
  "unknown-match": { code: "not_found", message: "Unknown match" },
  "unknown-achievement": { code: "not_found", message: "Unknown achievement" },
  "achievement-exists": { code: "conflict", message: "That achievement already exists" },
  unrated: { code: "conflict", message: "That account has no rating to correct" },
});

function answer<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  result: AdminResult<T>,
): FastifyReply {
  if (result.ok) {
    return reply.send(result.value);
  }
  const refusal = REFUSALS[result.reason];
  return sendError(request, reply, refusal.code, refusal.message);
}
