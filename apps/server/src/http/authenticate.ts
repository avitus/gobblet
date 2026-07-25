import type { FastifyReply, FastifyRequest } from "fastify";
import { resolveIdentity, toActor } from "../identity/resolve";
import type { IdentityResolvers, ResolvedIdentity } from "../identity/resolve";
import type { Actor } from "../match/snapshot";
import { sendError } from "./errors";

const BEARER_PREFIX = "bearer ";

export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.toLowerCase().startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

/** Resolves the bearer token of a request through the one resolution path. */
export async function resolveRequestIdentity(
  resolvers: IdentityResolvers,
  request: FastifyRequest,
): Promise<ResolvedIdentity | null> {
  const token = bearerToken(request);
  if (token === null) {
    return null;
  }
  return resolveIdentity(resolvers, token);
}

export async function resolveActor(
  resolvers: IdentityResolvers,
  request: FastifyRequest,
): Promise<Actor | null> {
  const identity = await resolveRequestIdentity(resolvers, request);
  return identity ? toActor(identity) : null;
}

/**
 * Resolves the caller or answers `401` itself, so routes stay a single
 * `if (!resolved) return reply;` and cannot forget the error shape.
 */
export async function requireIdentity(
  resolvers: IdentityResolvers,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<ResolvedIdentity | null> {
  const identity = await resolveRequestIdentity(resolvers, request);
  if (!identity) {
    await sendError(request, reply, "unauthenticated", "A session token is required");
    return null;
  }
  return identity;
}
