import type { FastifyRequest } from "fastify";
import type { GuestService } from "../guests/service";
import type { Actor } from "../match/snapshot";

const BEARER_PREFIX = "bearer ";

export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.toLowerCase().startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

/** Phase 2 has one credential type, so an authenticated actor is always a guest. */
export async function resolveActor(
  guests: GuestService,
  request: FastifyRequest,
): Promise<Actor | null> {
  const token = bearerToken(request);
  if (token === null) {
    return null;
  }
  const identity = await guests.authenticate(token);
  return identity ? { actorType: "guest", actorId: identity.guestId } : null;
}
