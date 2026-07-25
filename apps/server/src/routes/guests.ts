import { createGuestRequestSchema, httpErrorDetails } from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
import type { GuestService } from "../guests/service";
import { sendError } from "../http/errors";

export function registerGuestRoutes(app: FastifyInstance, guests: GuestService): void {
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
}
