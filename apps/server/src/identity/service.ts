import {
  DAY_MS,
  expiresAt,
  hashPassword,
  hashToken,
  issueToken,
  verifyPassword,
} from "@gobblet/auth";
import type { ServerConfig } from "@gobblet/config";
import {
  claimGuestSession,
  consumeEmailVerificationToken,
  countCasualResults,
  findEmailVerificationToken,
  findProfileByUserId,
  findUserByEmail,
  findUserById,
  findUserByUsername,
  findUserSessionByTokenHash,
  insertEmailVerificationToken,
  insertProfile,
  insertUser,
  insertUserSession,
  markEmailVerified,
  reassignMatchParticipation,
  revokeUserSession,
  revokeUserSessions,
  setUserSuspension,
  touchUser,
  touchUserSession,
  uniqueUserConflict,
  updateProfile,
} from "@gobblet/db";
import type { Database, ProfileRow, UserRow } from "@gobblet/db";
import {
  isReservedUsername,
  normalizeEmail,
  normalizeUsername,
  usernameSchema,
} from "@gobblet/protocol";
import type {
  Account,
  AuthResponse,
  CasualRecord,
  CheckUsernameResponse,
  ClaimGuestRequest,
  ClaimGuestResponse,
  IssuedSession,
  MeResponse,
  ProfileSettings,
  PublicProfile,
  RegisterRequest,
  SignInRequest,
  UpdateProfileRequest,
  UserStatus,
} from "@gobblet/protocol";

/**
 * Accounts, their sessions and their profiles
 * (docs/adr/0017-first-party-email-password-authentication.md). Everything a
 * password or a session token touches happens here, so there is one place to
 * audit. Rule logic and hashing live in `@gobblet/auth`; shapes live in
 * `@gobblet/protocol`.
 */

export const EMAIL_VERIFICATION_TTL_MS = 3 * DAY_MS;

/** What a match gate needs to know about an account (spec sections 2.3 and 5.6). */
export type AccountFlags = Readonly<{
  status: UserStatus;
  emailVerified: boolean;
}>;

/** A resolved credential, whichever kind it was. */
export type UserIdentity = Readonly<{
  actorType: "user";
  actorId: string;
  sessionId: string;
  displayName: string;
  username: string;
  status: UserStatus;
  emailVerified: boolean;
}>;

export type IdentityServiceOptions = Readonly<{
  db: Database;
  config: ServerConfig;
  now?: () => number;
}>;

export type RegisterFailure = "email-taken" | "username-taken";
export type SignInFailure = "invalid-credentials" | "suspended";
export type VerifyEmailFailure = "unknown-token" | "expired" | "already-used";
export type ClaimFailure = RegisterFailure | "already-claimed";

export type Result<T, F> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; reason: F }>;

/**
 * Thrown inside the claim transaction so the account it created is rolled back:
 * a claim that loses the race must not leave an orphan account holding the email
 * address and the username it asked for.
 */
class GuestAlreadyClaimedError extends Error {}

function ok<T, F>(value: T): Result<T, F> {
  return { ok: true, value };
}

function fail<T, F>(reason: F): Result<T, F> {
  return { ok: false, reason };
}

export function toAccount(user: UserRow): Account {
  return {
    userId: user.id,
    username: user.username,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toProfileSettings(profile: ProfileRow): ProfileSettings {
  return {
    avatarUrl: profile.avatarUrl,
    countryCode: profile.countryCode,
    presetMessagesMuted: profile.presetMessagesMuted,
    reactionsMuted: profile.reactionsMuted,
    gameSoundMuted: profile.gameSoundMuted,
    reducedMotion: profile.reducedMotion,
  };
}

export class IdentityService {
  private readonly db: Database;

  private readonly config: ServerConfig;

  private readonly clock: () => number;

  constructor(options: IdentityServiceOptions) {
    this.db = options.db;
    this.config = options.config;
    this.clock = options.now ?? ((): number => Date.now());
  }

  /**
   * Creates the account, its profile, its first session and its verification
   * token in one transaction: a half-created account would have no way to sign in
   * and no way to be created again, because the email would already be taken.
   */
  async register(request: RegisterRequest): Promise<Result<AuthResponse, RegisterFailure>> {
    const now = this.clock();
    const passwordHash = await hashPassword(request.password);

    try {
      const created = await this.db.transaction(async (tx) => {
        const user = await insertUser(tx, {
          email: normalizeEmail(request.email),
          passwordHash,
          username: request.username,
          usernameNormalized: normalizeUsername(request.username),
          displayName: request.displayName ?? request.username,
          createdAt: new Date(now),
          updatedAt: new Date(now),
          lastSeenAt: new Date(now),
        });
        await insertProfile(tx, {
          userId: user.id,
          createdAt: new Date(now),
          updatedAt: new Date(now),
        });
        const session = await this.openSession(tx, user.id, now);
        const verification = await this.issueEmailVerification(tx, user, now);
        return { user, session, verification };
      });

      return ok({
        account: toAccount(created.user),
        session: created.session,
        ...(created.verification ? { emailVerification: created.verification } : {}),
      });
    } catch (error) {
      const conflict = uniqueUserConflict(error);
      if (conflict === "email") {
        return fail("email-taken");
      }
      if (conflict === "username") {
        return fail("username-taken");
      }
      throw error;
    }
  }

  /**
   * A wrong email and a wrong password are the same answer, so sign-in cannot be
   * used to discover which addresses have accounts.
   */
  async signIn(request: SignInRequest): Promise<Result<AuthResponse, SignInFailure>> {
    const now = this.clock();
    const user = await findUserByEmail(this.db, normalizeEmail(request.email));
    if (!user || user.status === "deleted") {
      return fail("invalid-credentials");
    }

    if (!(await verifyPassword(request.password, user.passwordHash))) {
      return fail("invalid-credentials");
    }

    if (user.status === "suspended") {
      return fail("suspended");
    }

    const session = await this.db.transaction(async (tx) => {
      await touchUser(tx, user.id, new Date(now));
      return this.openSession(tx, user.id, now);
    });

    return ok({ account: toAccount(user), session });
  }

  async signOut(sessionId: string): Promise<void> {
    await revokeUserSession(this.db, sessionId, new Date(this.clock()));
  }

  /**
   * Resolves an account session token. Expiry and revocation are read from the
   * row, so signing out and suspending take effect on the next request.
   */
  async authenticate(token: string): Promise<UserIdentity | null> {
    const session = await findUserSessionByTokenHash(this.db, hashToken(token));
    if (!session) {
      return null;
    }

    const now = this.clock();
    if (session.revokedAt !== null || session.expiresAt.getTime() <= now) {
      return null;
    }

    const user = await findUserById(this.db, session.userId);
    if (!user || user.status === "deleted") {
      return null;
    }

    await touchUserSession(this.db, session.id, new Date(now));
    return {
      actorType: "user",
      actorId: user.id,
      sessionId: session.id,
      displayName: user.displayName,
      username: user.username,
      status: user.status,
      emailVerified: user.emailVerifiedAt !== null,
    };
  }

  async verifyEmail(token: string): Promise<Result<Account, VerifyEmailFailure>> {
    const now = this.clock();
    const row = await findEmailVerificationToken(this.db, hashToken(token));
    if (!row) {
      return fail("unknown-token");
    }
    if (row.consumedAt !== null) {
      return fail("already-used");
    }
    if (row.expiresAt.getTime() <= now) {
      return fail("expired");
    }

    const verified = await this.db.transaction(async (tx) => {
      // The update is conditional on the token still being unused, so two
      // concurrent openings of the same link cannot both verify.
      if (!(await consumeEmailVerificationToken(tx, row.id, new Date(now)))) {
        return null;
      }
      await markEmailVerified(tx, row.userId, new Date(now));
      return findUserById(tx, row.userId);
    });

    if (!verified) {
      return fail("already-used");
    }
    return ok(toAccount(verified));
  }

  /**
   * Turns the guest session that made the request into an account and moves the
   * guest's matches to it, in one transaction (spec section 2.3).
   */
  async claimGuest(
    guestId: string,
    request: ClaimGuestRequest,
  ): Promise<Result<ClaimGuestResponse, ClaimFailure>> {
    const now = this.clock();
    const passwordHash = await hashPassword(request.password);

    try {
      const claimed = await this.db.transaction(async (tx) => {
        const user = await insertUser(tx, {
          email: normalizeEmail(request.email),
          passwordHash,
          username: request.username,
          usernameNormalized: normalizeUsername(request.username),
          displayName: request.username,
          createdAt: new Date(now),
          updatedAt: new Date(now),
          lastSeenAt: new Date(now),
        });
        const guest = await claimGuestSession(tx, guestId, user.id, new Date(now));
        if (!guest) {
          throw new GuestAlreadyClaimedError();
        }
        await insertProfile(tx, {
          userId: user.id,
          createdAt: new Date(now),
          updatedAt: new Date(now),
        });
        const claimedMatches = await reassignMatchParticipation(
          tx,
          { actorType: "guest", actorId: guestId },
          { actorType: "user", actorId: user.id },
        );
        // The guest token becomes an account session, so a client that is holding
        // it, mid-match included, keeps acting as the account it just created
        // instead of losing its seat.
        await insertUserSession(tx, {
          userId: user.id,
          tokenHash: guest.tokenHash,
          createdAt: new Date(now),
          lastSeenAt: new Date(now),
          expiresAt: expiresAt(now, this.config.userSessionTtlDays * DAY_MS),
        });
        const session = await this.openSession(tx, user.id, now);
        const verification = await this.issueEmailVerification(tx, user, now);
        return { user, session, verification, claimedMatches };
      });

      return ok({
        account: toAccount(claimed.user),
        session: claimed.session,
        ...(claimed.verification ? { emailVerification: claimed.verification } : {}),
        claimedMatches: claimed.claimedMatches,
      });
    } catch (error) {
      if (error instanceof GuestAlreadyClaimedError) {
        return fail("already-claimed");
      }
      const conflict = uniqueUserConflict(error);
      if (conflict === "email") {
        return fail("email-taken");
      }
      if (conflict === "username") {
        return fail("username-taken");
      }
      throw error;
    }
  }

  /**
   * The gating state of an account, read fresh. Suspension is enforced at match
   * creation and at every match command, so a suspension that lands mid-session
   * stops the next action rather than the next sign-in.
   */
  async accountFlags(userId: string): Promise<AccountFlags | null> {
    const user = await findUserById(this.db, userId);
    if (!user) {
      return null;
    }
    return { status: user.status, emailVerified: user.emailVerifiedAt !== null };
  }

  /**
   * The profile page anyone may read (spec section 11.1). It carries none of the
   * fields section 11.1 forbids, and a deleted account has no page at all.
   */
  async publicProfile(username: string): Promise<PublicProfile | null> {
    const user = await findUserByUsername(this.db, normalizeUsername(username));
    if (!user || user.status === "deleted") {
      return null;
    }
    const profile = await findProfileByUserId(this.db, user.id);
    if (!profile) {
      return null;
    }

    return {
      username: user.username,
      avatarUrl: profile.avatarUrl,
      countryCode: profile.countryCode,
      memberSince: user.createdAt.toISOString().slice(0, 7),
      casual: await this.casualRecord(user.id),
      ranked: null,
    };
  }

  async getMe(userId: string): Promise<MeResponse | null> {
    const user = await findUserById(this.db, userId);
    const profile = await findProfileByUserId(this.db, userId);
    if (!user || !profile) {
      return null;
    }

    return {
      account: toAccount(user),
      profile: toProfileSettings(profile),
      casual: await this.casualRecord(userId),
      ranked: null,
    };
  }

  async updateProfile(userId: string, patch: UpdateProfileRequest): Promise<ProfileSettings> {
    return toProfileSettings(await updateProfile(this.db, userId, patch));
  }

  async casualRecord(userId: string): Promise<CasualRecord> {
    const counts = await countCasualResults(this.db, userId);
    return { wins: counts.wins, losses: counts.losses, draws: counts.draws, played: counts.played };
  }

  /**
   * Availability for the sign-up form. An unusable name is an answer with a
   * reason, not a request error, so the field can explain itself as it is typed.
   */
  async checkUsername(candidate: string): Promise<CheckUsernameResponse> {
    if (isReservedUsername(candidate)) {
      return { username: candidate, available: false, reason: "reserved" };
    }

    const validated = usernameSchema.safeParse(candidate);
    if (!validated.success) {
      return { username: candidate, available: false, reason: "invalid" };
    }

    const username = validated.data;
    if (await findUserByUsername(this.db, normalizeUsername(username))) {
      return { username, available: false, reason: "taken" };
    }
    return { username, available: true, reason: null };
  }

  /**
   * Suspension revokes every live session, so a suspended account cannot keep
   * playing with a token it already holds.
   */
  async suspend(userId: string, reason: string | null): Promise<UserRow> {
    const now = new Date(this.clock());
    return this.db.transaction(async (tx) => {
      const user = await setUserSuspension(tx, userId, {
        status: "suspended",
        suspendedAt: now,
        suspendedReason: reason,
      });
      await revokeUserSessions(tx, userId, now);
      return user;
    });
  }

  async reinstate(userId: string): Promise<UserRow> {
    return setUserSuspension(this.db, userId, {
      status: "active",
      suspendedAt: null,
      suspendedReason: null,
    });
  }

  private async openSession(
    executor: Parameters<typeof insertUserSession>[0],
    userId: string,
    now: number,
  ): Promise<IssuedSession> {
    const issued = issueToken();
    const expires = expiresAt(now, this.config.userSessionTtlDays * DAY_MS);
    await insertUserSession(executor, {
      userId,
      tokenHash: issued.tokenHash,
      createdAt: new Date(now),
      lastSeenAt: new Date(now),
      expiresAt: expires,
    });
    return { sessionToken: issued.token, expiresAt: expires.toISOString() };
  }

  /**
   * Issues the verification token, and hands it back only outside production,
   * where there is no mail sender to deliver it (appendix P3). The token value is
   * never logged.
   */
  private async issueEmailVerification(
    executor: Parameters<typeof insertEmailVerificationToken>[0],
    user: UserRow,
    now: number,
  ): Promise<Readonly<{ token: string; expiresAt: string }> | null> {
    const issued = issueToken();
    const expires = expiresAt(now, EMAIL_VERIFICATION_TTL_MS);
    await insertEmailVerificationToken(executor, {
      userId: user.id,
      tokenHash: issued.tokenHash,
      email: user.email,
      createdAt: new Date(now),
      expiresAt: expires,
    });

    if (this.config.appEnv === "production") {
      return null;
    }
    return { token: issued.token, expiresAt: expires.toISOString() };
  }
}
