import type { GuestService } from "../guests/service";
import type { Actor } from "../match/snapshot";
import type { IdentityService, UserIdentity } from "./service";

/**
 * One resolution path for every credential, HTTP or socket
 * (docs/adr/0017-first-party-email-password-authentication.md). A bearer token is
 * opaque, so it is looked up as an account session first and as a guest session
 * second; both produce the `Actor` the match runtime already consumes.
 */

export type GuestIdentityView = Readonly<{
  actorType: "guest";
  actorId: string;
  displayName: string;
}>;

export type ResolvedIdentity = UserIdentity | GuestIdentityView;

export type IdentityResolvers = Readonly<{
  identity: IdentityService;
  guests: GuestService;
}>;

export async function resolveIdentity(
  resolvers: IdentityResolvers,
  token: string,
): Promise<ResolvedIdentity | null> {
  const user = await resolvers.identity.authenticate(token);
  if (user) {
    return user;
  }

  const guest = await resolvers.guests.authenticate(token);
  if (guest) {
    return { actorType: "guest", actorId: guest.guestId, displayName: guest.displayName };
  }
  return null;
}

export function toActor(identity: ResolvedIdentity): Actor {
  return { actorType: identity.actorType, actorId: identity.actorId };
}

/** A suspended account may read its own profile, but may not play (spec section 19.3). */
export function isSuspended(identity: ResolvedIdentity): boolean {
  return identity.actorType === "user" && identity.status === "suspended";
}
