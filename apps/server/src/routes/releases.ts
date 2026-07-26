import {
  httpErrorDetails,
  pauseReleaseRequestSchema,
  promoteReleaseRequestSchema,
  publishReleaseRequestSchema,
  releaseBuildEventRequestSchema,
  updateChannelParamsSchema,
  updateQuerySchema,
} from "@gobblet/protocol";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAdmin } from "../admin/guard";
import type { AdminGuardOptions } from "../admin/guard";
import { sendError } from "../http/errors";
import type { ReleaseFailure, ReleaseResult, ReleaseService } from "../releases/service";

/**
 * The update endpoint the desktop asks and the administrative routes that publish,
 * pause and promote (docs/adr/0034-updates-are-asked-of-our-own-server.md). The
 * update endpoint is anonymous, because an updater has no session; everything that
 * changes a release requires the role and writes an audit record.
 */

type UpdateQueryString = Readonly<{ target?: string; currentVersion?: string }>;

export function registerReleaseRoutes(
  app: FastifyInstance,
  releases: ReleaseService,
  guard: AdminGuardOptions,
): void {
  app.get<{ Params: { channel: string }; Querystring: UpdateQueryString }>(
    "/v1/updates/:channel",
    async (request, reply) => {
      const channel = updateChannelParamsSchema.safeParse(request.params);
      if (!channel.success) {
        return invalid(request, reply, "Unknown release channel", channel.error);
      }

      const query = updateQuerySchema.safeParse(request.query);
      if (!query.success) {
        return invalid(request, reply, "Invalid update check", query.error);
      }

      const manifest = await releases.manifestFor(
        channel.data.channel,
        query.data.target,
        query.data.currentVersion,
      );
      // 204 is how Tauri's updater is told there is nothing to install.
      return manifest === null ? reply.code(204).send() : reply.send(manifest);
    },
  );

  app.get("/v1/releases/latest", async (_request, reply) => reply.send(await releases.latest()));

  app.get("/v1/admin/releases", async (request, reply) => {
    if (!(await requireAdmin(guard, request, reply))) {
      return reply;
    }
    return reply.send({ releases: await releases.list() });
  });

  app.post("/v1/admin/releases", async (request, reply) => {
    const actor = await requireAdmin(guard, request, reply);
    if (!actor) {
      return reply;
    }

    const parsed = publishReleaseRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalid(request, reply, "Invalid release", parsed.error);
    }

    return answer(request, reply, await releases.publish(actor, parsed.data));
  });

  app.post<{ Params: { releaseId: string } }>(
    "/v1/admin/releases/:releaseId/pause",
    async (request, reply) => {
      const actor = await requireAdmin(guard, request, reply);
      if (!actor) {
        return reply;
      }

      const parsed = pauseReleaseRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalid(request, reply, "Invalid rollout change", parsed.error);
      }

      return answer(
        request,
        reply,
        await releases.setPaused(
          actor,
          request.params.releaseId,
          parsed.data.paused,
          parsed.data.reason,
        ),
      );
    },
  );

  app.post<{ Params: { releaseId: string } }>(
    "/v1/admin/releases/:releaseId/promote",
    async (request, reply) => {
      const actor = await requireAdmin(guard, request, reply);
      if (!actor) {
        return reply;
      }

      const parsed = promoteReleaseRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalid(request, reply, "A reason is required", parsed.error);
      }

      return answer(
        request,
        reply,
        await releases.promote(actor, request.params.releaseId, parsed.data.reason),
      );
    },
  );

  app.post("/v1/admin/releases/build-events", async (request, reply) => {
    if (!(await requireAdmin(guard, request, reply))) {
      return reply;
    }

    const parsed = releaseBuildEventRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalid(request, reply, "Invalid build event", parsed.error);
    }

    releases.recordBuildEvent(parsed.data);
    return reply.send({ recorded: true });
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
  Record<ReleaseFailure, Readonly<{ code: "not_found" | "conflict"; message: string }>>
> = Object.freeze({
  "unknown-release": { code: "not_found", message: "Unknown release" },
  "version-exists": { code: "conflict", message: "That version is already published" },
  "already-stable": { code: "conflict", message: "That release is already stable" },
});

function answer<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  result: ReleaseResult<T>,
): FastifyReply {
  if (result.ok) {
    return reply.send(result.value);
  }
  const refusal = REFUSALS[result.reason];
  return sendError(request, reply, refusal.code, refusal.message);
}
