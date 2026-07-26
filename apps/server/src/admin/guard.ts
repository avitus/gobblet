import type { FastifyReply, FastifyRequest } from "fastify";
import { findUserById } from "@gobblet/db";
import type { Database } from "@gobblet/db";
import { requireIdentity } from "../http/authenticate";
import { sendError } from "../http/errors";
import type { IdentityResolvers } from "../identity/resolve";
import type { AdminIdentity } from "./service";

/**
 * The role check every `/v1/admin/*` route makes. The role is read from the account
 * on every request rather than from anything the caller presents, and a player, a
 * guest and an anonymous caller are refused identically, so the surface does not
 * reveal that it exists (appendix P7.1).
 */
export type AdminGuardOptions = Readonly<{
  db: Database;
  resolvers: IdentityResolvers;
}>;

const REFUSAL = "Administrative access is required";

export async function requireAdmin(
  options: AdminGuardOptions,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AdminIdentity | null> {
  const identity = await requireIdentity(options.resolvers, request, reply);
  if (!identity) {
    return null;
  }
  if (identity.actorType !== "user") {
    await sendError(request, reply, "forbidden", REFUSAL);
    return null;
  }

  const user = await findUserById(options.db, identity.actorId);
  if (!user || user.role !== "admin" || user.status !== "active") {
    await sendError(request, reply, "forbidden", REFUSAL);
    return null;
  }

  return { userId: user.id, username: user.username };
}
