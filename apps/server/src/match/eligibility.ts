import type { DevMatchParticipant, MatchMode } from "@gobblet/protocol";
import type { IdentityService } from "../identity/service";

/**
 * Who may be seated in a match, in one place: match creation checks it now and
 * the Phase 4 queues will check the same function, so the rules of sections 2.3
 * and 5.6 cannot drift between the two entry points.
 */
export type Ineligibility = "unknown-account" | "suspended" | "guest-ranked" | "email-unverified";

export type EligibilityVerdict =
  Readonly<{ eligible: true }> | Readonly<{ eligible: false; reason: Ineligibility }>;

const ELIGIBLE: EligibilityVerdict = { eligible: true };

export async function checkParticipant(
  identity: IdentityService,
  participant: Pick<DevMatchParticipant, "actorType" | "actorId">,
  mode: MatchMode,
): Promise<EligibilityVerdict> {
  if (participant.actorType === "guest") {
    // Guests play casual games only, so a guest in a ranked seat is refused
    // before the match exists rather than when a rating would be written.
    return mode === "ranked" ? { eligible: false, reason: "guest-ranked" } : ELIGIBLE;
  }

  const flags = await identity.accountFlags(participant.actorId);
  if (!flags || flags.status === "deleted") {
    return { eligible: false, reason: "unknown-account" };
  }
  if (flags.status === "suspended") {
    return { eligible: false, reason: "suspended" };
  }
  if (mode === "ranked" && !flags.emailVerified) {
    return { eligible: false, reason: "email-unverified" };
  }
  return ELIGIBLE;
}

export function ineligibilityMessage(reason: Ineligibility): string {
  switch (reason) {
    case "unknown-account":
      return "That account cannot be seated in a match";
    case "suspended":
      return "A suspended account cannot join a match";
    case "guest-ranked":
      return "Ranked matches require a registered account";
    case "email-unverified":
      return "Ranked matches require a verified email address";
  }
}
