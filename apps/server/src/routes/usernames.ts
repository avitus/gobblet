import { checkUsernameRequestSchema, httpErrorDetails } from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
import { sendError } from "../http/errors";
import type { IdentityService } from "../identity/service";

/**
 * Availability for the sign-up form (spec section 14.2). It is public because it
 * answers about a name a caller is about to type, and the answer is already
 * visible on every public profile.
 */
export function registerUsernameRoutes(app: FastifyInstance, identity: IdentityService): void {
  app.post("/v1/usernames/check", async (request, reply) => {
    const parsed = checkUsernameRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(
        request,
        reply,
        "validation_failed",
        "Invalid username request",
        httpErrorDetails(parsed.error),
      );
    }

    return reply.send(await identity.checkUsername(parsed.data.username));
  });
}
