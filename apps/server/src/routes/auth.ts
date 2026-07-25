import {
  httpErrorDetails,
  registerRequestSchema,
  signInRequestSchema,
  verifyEmailRequestSchema,
} from "@gobblet/protocol";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireIdentity } from "../http/authenticate";
import { sendError } from "../http/errors";
import type { AttemptLimiter } from "../identity/rate-limit";
import type { IdentityResolvers } from "../identity/resolve";
import type { IdentityService } from "../identity/service";

export type AuthRouteOptions = Readonly<{
  identity: IdentityService;
  resolvers: IdentityResolvers;
  limiter: AttemptLimiter;
}>;

/**
 * Credential endpoints. Section 14.2 lists none, because the specification
 * delegated login to a hosted page; appendix P3 records why these exist instead.
 */
export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const { identity, resolvers, limiter } = options;

  app.post("/v1/auth/register", async (request, reply) => {
    if (!throttle(request, reply, limiter, "register")) {
      return reply;
    }

    const parsed = registerRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(
        request,
        reply,
        "validation_failed",
        "Invalid registration",
        httpErrorDetails(parsed.error),
      );
    }

    const result = await identity.register(parsed.data);
    if (!result.ok) {
      return sendError(request, reply, "conflict", conflictMessage(result.reason), [
        { path: result.reason === "email-taken" ? "email" : "username", issue: "already_taken" },
      ]);
    }

    return reply.status(201).send(result.value);
  });

  app.post("/v1/auth/sign-in", async (request, reply) => {
    if (!throttle(request, reply, limiter, "sign-in")) {
      return reply;
    }

    const parsed = signInRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      // The same answer as wrong credentials: a malformed body must not reveal
      // which field the server dislikes about a guessed address.
      return sendError(request, reply, "unauthenticated", "Email or password is incorrect");
    }

    const result = await identity.signIn(parsed.data);
    if (!result.ok) {
      if (result.reason === "suspended") {
        return sendError(request, reply, "forbidden", "This account is suspended", [
          { path: "account", issue: "suspended" },
        ]);
      }
      return sendError(request, reply, "unauthenticated", "Email or password is incorrect");
    }

    limiter.forgive(limiterKey(request, "sign-in"));
    return reply.send(result.value);
  });

  app.post("/v1/auth/sign-out", async (request, reply) => {
    const resolved = await requireIdentity(resolvers, request, reply);
    if (!resolved) {
      return reply;
    }
    if (resolved.actorType !== "user") {
      return sendError(request, reply, "forbidden", "Only an account session can be signed out");
    }

    await identity.signOut(resolved.sessionId);
    return reply.status(204).send();
  });

  app.post("/v1/auth/verify-email", async (request, reply) => {
    const parsed = verifyEmailRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(
        request,
        reply,
        "validation_failed",
        "Invalid verification request",
        httpErrorDetails(parsed.error),
      );
    }

    const result = await identity.verifyEmail(parsed.data.token);
    if (!result.ok) {
      const message =
        result.reason === "expired"
          ? "This verification link has expired"
          : result.reason === "already-used"
            ? "This verification link has already been used"
            : "This verification link is not valid";
      return sendError(request, reply, "validation_failed", message, [
        { path: "token", issue: result.reason },
      ]);
    }

    return reply.send({ account: result.value });
  });
}

function conflictMessage(reason: "email-taken" | "username-taken"): string {
  return reason === "email-taken"
    ? "An account already exists for this email address"
    : "This username is already taken";
}

function limiterKey(request: FastifyRequest, route: string): string {
  return `${route}:${request.ip}`;
}

function throttle(
  request: FastifyRequest,
  reply: FastifyReply,
  limiter: AttemptLimiter,
  route: string,
): boolean {
  const verdict = limiter.check(limiterKey(request, route));
  if (verdict.allowed) {
    return true;
  }

  void reply.header("retry-after", String(verdict.retryAfter));
  void sendError(request, reply, "rate_limited", "Too many attempts, try again later");
  return false;
}
