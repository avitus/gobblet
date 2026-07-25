import {
  claimGuestRequestSchema,
  createGuestRequestSchema,
  httpErrorDetails,
} from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
import type { GuestService } from "../guests/service";
import { requireIdentity } from "../http/authenticate";
import { sendError } from "../http/errors";
import type { IdentityResolvers } from "../identity/resolve";
import type { IdentityService } from "../identity/service";

export type GuestRouteOptions = Readonly<{
  guests: GuestService;
  identity: IdentityService;
  resolvers: IdentityResolvers;
}>;

export function registerGuestRoutes(app: FastifyInstance, options: GuestRouteOptions): void {
  const { guests, identity, resolvers } = options;

  app.post("/v1/guests", async (request, reply) => {
    const parsed = createGuestRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(
        request,
        reply,
        "validation_failed",
        "Invalid guest request",
        httpErrorDetails(parsed.error),
      );
    }

    const guest = await guests.createGuest(parsed.data.displayName);
    return reply.status(201).send(guest);
  });

  /**
   * The guest session that makes the request is the one being claimed, so a
   * client cannot claim a session it does not hold (spec section 2.3).
   */
  app.post("/v1/guests/claim", async (request, reply) => {
    const resolved = await requireIdentity(resolvers, request, reply);
    if (!resolved) {
      return reply;
    }
    if (resolved.actorType !== "guest") {
      return sendError(request, reply, "forbidden", "This endpoint requires a guest session");
    }

    const parsed = claimGuestRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(
        request,
        reply,
        "validation_failed",
        "Invalid claim",
        httpErrorDetails(parsed.error),
      );
    }

    const result = await identity.claimGuest(resolved.actorId, parsed.data);
    if (!result.ok) {
      const details =
        result.reason === "already-claimed"
          ? [{ path: "guest", issue: "already_claimed" }]
          : [
              {
                path: result.reason === "email-taken" ? "email" : "username",
                issue: "already_taken",
              },
            ];
      return sendError(request, reply, "conflict", claimMessage(result.reason), details);
    }

    return reply.status(201).send(result.value);
  });
}

function claimMessage(reason: "email-taken" | "username-taken" | "already-claimed"): string {
  switch (reason) {
    case "email-taken":
      return "An account already exists for this email address";
    case "username-taken":
      return "This username is already taken";
    case "already-claimed":
      return "This guest session has already been claimed";
  }
}
