import type { ServerConfig } from "@gobblet/config";
import { createDevMatchRequestSchema, httpErrorDetails } from "@gobblet/protocol";
import type { CreateDevMatchResponse } from "@gobblet/protocol";
import type { FastifyInstance } from "fastify";
import { sendError } from "../http/errors";
import type { IdentityResolvers } from "../identity/resolve";
import { checkParticipant, ineligibilityMessage } from "../match/eligibility";
import type { MatchRuntime } from "../match/runtime";

/**
 * Matchmaking arrives in Phase 4, so Phase 2 needs a way to start a match for
 * tests and local play. The route only exists where it cannot affect players:
 * a local process or an automated test run.
 */
export function devMatchesEnabled(config: ServerConfig): boolean {
  return config.appEnv === "local" || config.nodeEnv === "test";
}

export function registerDevMatchRoutes(
  app: FastifyInstance,
  runtime: MatchRuntime,
  resolvers: IdentityResolvers,
  config: ServerConfig,
): void {
  if (!devMatchesEnabled(config)) {
    return;
  }

  app.post("/v1/dev/matches", async (request, reply) => {
    const parsed = createDevMatchRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(
        request,
        reply,
        "validation_failed",
        "Invalid match request",
        httpErrorDetails(parsed.error),
      );
    }

    const { mode, timeControlSeconds, light, dark, firstPlayer } = parsed.data;
    if (light.actorId === dark.actorId) {
      return sendError(request, reply, "conflict", "A match needs two distinct actors");
    }

    // Who may be seated is decided by one function, which the Phase 4 queues will
    // also call (spec sections 2.3, 5.6 and 19.3).
    for (const [seat, participant] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      const verdict = await checkParticipant(resolvers.identity, participant, mode);
      if (!verdict.eligible) {
        return sendError(request, reply, "forbidden", ineligibilityMessage(verdict.reason), [
          { path: seat, issue: verdict.reason },
        ]);
      }
    }

    const snapshot = await runtime.createMatch({
      mode,
      timeControlSeconds,
      light,
      dark,
      ...(firstPlayer ? { firstPlayer } : {}),
    });

    const body: CreateDevMatchResponse = { matchId: snapshot.matchId, snapshot };
    return reply.status(201).send(body);
  });
}
