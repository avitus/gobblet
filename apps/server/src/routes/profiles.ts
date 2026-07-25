import type { FastifyInstance } from "fastify";
import { sendError } from "../http/errors";
import type { IdentityService } from "../identity/service";

/**
 * The public profile page (spec sections 11.1 and 14.1). It is unauthenticated,
 * and it answers with only the fields section 11.1 allows: the email, the
 * moderation state and the session history never appear here.
 */
export function registerProfileRoutes(app: FastifyInstance, identity: IdentityService): void {
  app.get<{ Params: { username: string } }>("/v1/profiles/:username", async (request, reply) => {
    const profile = await identity.publicProfile(request.params.username);
    if (!profile) {
      return sendError(request, reply, "not_found", "Unknown profile");
    }
    return reply.send(profile);
  });
}
