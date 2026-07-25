# Gobblet Online — Polished Public MVP

Product and Engineering Specification with Phased Implementation Plan

Document status: Coding-agent handoff
Prepared: July 2026
Primary platforms: Web, macOS, Windows
Future platforms: iOS and Android
Game: Standard 4×4 Gobblet
Release target: Polished public MVP
Primary quality criterion: Correctness, reliability, and zero known critical or high-severity defects

> Copy note: this file holds the controlling specification as delivered, with wording preserved.
> Only markdown structure lost in transfer (list markers, code fences, section separators) has been
> restored. Additions made after delivery are confined to clearly marked appendices at the end of
> this document, as required by section 26 and section 30.

---

## 1. Executive Summary

Build a real-time, online player-versus-player implementation of standard 4×4 Gobblet. The initial release must be available as:

- A web application.
- A directly downloadable macOS desktop application.
- A directly downloadable Windows desktop application.

The web and desktop products should share nearly all client code. The desktop applications should use signed installers and automatic updates. Native iOS and Android applications are explicitly deferred, but the domain engine, network protocol, account system, and client architecture must not prevent them from being added later.

Players may participate as guests or registered users. Guests may enter casual public matchmaking. Registered users may enter both casual and ranked public matchmaking. Ranked matches use a single global Elo rating. Matches are played in real time using chess-style clocks with no increment.

The game must implement the official standard Gobblet rules, including the exact distinction between:

- Entering a piece from an external stack.
- Moving a piece already on the board.
- Gobbling from reserve only in the official three-in-a-row defensive exception.
- Revealing an opponent's line of four.
- Threefold repetition.

The server is authoritative for moves, clocks, outcomes, ratings, achievements, and match lifecycle. The initial production architecture may run in one server region and one application cluster, but interfaces around matchmaking, presence, and real-time transport must be replaceable so horizontal scaling can be added later.

The board should be rendered as a fully 3D scene with a constrained 2.5D-style camera. The visual style should reproduce a realistic wooden Gobblet set using the authorized Gobblet name and identity. The first release uses one board and piece theme.

---

## 2. Fixed Product Decisions

### 2.1 Platforms

- Responsive web application.
- macOS desktop application.
- Windows desktop application.
- Desktop distribution by direct download from the product website.
- Automatic desktop updates.
- No App Store or Microsoft Store release in the MVP.
- No native iOS or Android application in the MVP.
- Internet connection required; no offline mode.

### 2.2 Match Types

- Real-time matches only.
- Public matchmaking only.
- Ranked queue.
- Casual queue.
- No private rooms.
- No invite links.
- No room codes.
- No friend challenges.
- No spectators.

### 2.3 Accounts

- Guest play is supported.
- Registered accounts are supported.
- Guests may play casual games only.
- Ranked games require a registered account.
- Guest activity is claimable when the guest creates or signs into an account.
- Globally unique usernames.
- Usernames are immutable after creation.

Login methods:

- Email and password.
- Passwordless email link.
- Google.
- Apple.
- GitHub.

### 2.4 Clocks

Initial clock choices:

- 3 minutes per player.
- 5 minutes per player.
- 10 minutes per player.
- 15 minutes per player.

Rules:

- No increment.
- No delay.
- Clock begins when the match is ready and the first player receives the active turn.
- The active player's clock continues through network disconnection.
- Time expiration causes an immediate loss.
- The server clock is authoritative.
- No network-latency compensation in the MVP.

### 2.5 Match Controls

- Resign.
- Request rematch.
- No undo.
- No public move-history panel.
- No player-accessible replay.
- No downloadable game record.
- No spectator mode.
- No free-text chat.
- Preset messages and reactions may be used at any time.
- Players may mute opponent messages, reactions, and game sounds.
- Rematch requests expire after 30 seconds.
- A rematch uses the same mode and time control.
- Colors alternate on rematch.
- A ranked rematch remains ranked.

### 2.6 Rankings and Profiles

- One global Elo rating shared across all ranked time controls.
- Starting rating: 1200.
- K-factor: 32.
- No provisional-rating acceleration.
- Casual games do not affect Elo.
- Casual and ranked results are tracked separately in aggregate statistics.
- Basic public profiles.
- Basic leaderboards.
- Cosmetic achievements and profile badges.
- Optional avatar.
- Optional country flag.
- No profile biography in the MVP.
- No direct messaging.

### 2.7 Visual Experience

- Fully 3D board and pieces.
- Constrained camera producing a polished 2.5D presentation.
- Realistic wood materials.
- One board and piece set.
- Animated piece lift, move, placement, gobbling, reveal, and winning line.
- Sound effects.
- Optional reduced-motion setting.
- Legal destinations shown after piece selection.
- Hidden pieces beneath a board stack must remain visually hidden.
- External reserve stacks must remain visible and understandable.

### 2.8 Operations

Include basic versions of:

- Automated deployment.
- Error monitoring.
- Structured logging.
- Operational metrics.
- Product analytics.
- Database backups.
- Administrative dashboard.
- Desktop release automation.
- Desktop update publishing.

### 2.9 Explicit Non-Goals

The MVP does not include:

- Computer opponents.
- Correspondence games.
- Tournaments.
- Multiple Gobblet variants.
- Private games.
- Friend lists.
- Spectators.
- Free-text chat.
- Player moderation workflows beyond account suspension.
- Advanced anti-cheat systems.
- Multiple visual themes.
- In-game purchases.
- Advertising.
- iOS or Android native applications.
- Public APIs.
- Replay analysis.
- Opening databases.
- Game notation export.

The architecture must anticipate computer opponents, but no computer opponent is implemented in the MVP.

---

## 3. Official Rules as Software Requirements

### 3.1 Source of Truth

Use the current English rulebook published by Blue Orange Games as the rule source of truth:

- Standard 4×4 board.
- Two players.
- Twelve pieces per player.
- Four piece sizes.
- Three external stacks of four nested pieces per player.
- Visible four-in-a-row wins horizontally, vertically, or diagonally.

Do not implement Gobblet Gobblers or any 3×3 variant.

### 3.2 Piece Model

Each piece has:

- Unique immutable ID.
- Owner: light or dark.
- Size: 1, 2, 3, or 4.
- Original external stack: 0, 1, or 2.

Each player begins with three external stacks. Each stack contains one piece of each size. The largest piece is exposed first.

A piece exists in exactly one location:

- An external stack.
- A board square.

Never both.
Never removed from play.

### 3.3 Board Model

The board contains sixteen squares indexed in a stable canonical order, such as:

- Rows 0–3.
- Columns 0–3.
- Square key r{row}c{column}.

Each board square contains a stack of zero or more pieces ordered bottom-to-top.

Stack invariant:

- Every piece above another piece must be strictly larger.
- Only the top piece is visible.
- Only the top piece can be moved.
- A player may move only a visible piece owned by that player.

### 3.4 Legal Move Types

The domain engine should define only two game-piece move types:

```ts
type ReserveMove = {
  kind: "reserve";
  reserveStack: 0 | 1 | 2;
  to: Square;
};

type BoardMove = {
  kind: "board";
  from: Square;
  to: Square;
};
```

Administrative match actions such as resignation are not board moves.

### 3.5 Moving from an External Stack

Normally, the exposed piece from an external stack may be placed only on an empty board square.

Official exception:

When the opponent already has three visible pieces aligned in a potential winning row, column, or diagonal, a player may take the exposed piece from an external stack and cover one of those three opponent pieces.

- The reserve piece must be larger than the visible opponent piece being covered.
- The destination piece must be part of an opponent three-piece line.
- A reserve piece may not otherwise enter by covering a piece.
- A reserve piece may not enter by covering the player's own piece.

This rule must be represented explicitly. Do not treat a reserve move as equivalent to a board move.

### 3.6 Moving a Piece Already on the Board

A visible piece owned by the active player may move to:

- Any empty square.
- Any square whose visible top piece is smaller.

The moved piece may cover:

- An opponent's smaller piece.
- The player's own smaller piece.

The piece cannot:

- Move to its current square as a no-op.
- Cover an equal-sized piece.
- Cover a larger piece.
- Move while covered.
- Return to an external stack.

### 3.7 Winning Lines

A winning line consists of four visible top pieces owned by one player in:

- Any of four rows.
- Any of four columns.
- Either of two main diagonals.

Covered pieces do not count.

The engine must evaluate all ten possible winning lines.

### 3.8 Revealing an Opponent's Four-in-a-Row

This is a critical rules edge case.

When a player lifts a board piece, the piece beneath it becomes visible before the moving piece is placed. If this reveals an opponent line of four:

- The moving player loses unless the moving piece is placed over a different opponent piece in that same revealed line, thereby breaking the line.
- The blocking destination must be a piece the mover can legally cover.
- If more than one opponent line is revealed, the move must eliminate every revealed opponent winning line; otherwise the mover loses.
- Completing the mover's own line elsewhere does not override an unblocked revealed opponent line under the current official rulebook.

The engine should model a board move in two phases:

1. Lift from source and evaluate newly revealed opponent winning lines.
2. Place at destination and evaluate whether all such lines were blocked, then evaluate final winning lines.

The move enumerator should return both structurally possible destinations and their terminal consequences. The UI should distinguish:

- Normal legal destination.
- Destination that immediately loses because it fails to block a revealed line.
- Destination that successfully blocks a revealed line.

### 3.9 Draws

Implement automatic threefold repetition as follows:

- Create a canonical hash of the complete game position.
- Include all board stacks in order.
- Include all external stacks in order.
- Include the side to move.
- Do not include clocks in the position hash.
- Declare a draw when the same canonical position with the same player to move occurs for the third time.

The physical rulebook also allows a draw by mutual agreement. The MVP omits a player draw-offer control based on the stated product scope. This is an explicit product-level deviation, not an accidental omission.

### 3.10 Digital Interpretation of the Touched-Piece Rule

The physical rulebook has a touched-piece rule. The digital product will treat selection as a preview rather than a binding physical touch because:

- Selecting does not expose hidden information.
- The UI is expected to show legal destinations.
- Accidental clicks should not cause immediate match loss.

A board move becomes binding only when the player chooses a destination and submits the move. Once submitted, it cannot be canceled.

This is an explicit digital interaction adaptation. Keep the rule engine independent of UI selection state.

### 3.11 Terminal Outcome Priority

For each accepted move, evaluate outcomes in this order:

1. Validate turn, source, destination, and piece-size rules.
2. Apply the lift phase.
3. Determine whether opponent winning lines were revealed.
4. Apply the destination phase.
5. If a revealed opponent line remains, moving player loses.
6. Otherwise, if the moving player has a visible line of four, moving player wins.
7. Otherwise, if the opponent has a visible line of four, opponent wins.
8. Otherwise, evaluate threefold repetition.
9. Otherwise, switch turns and continue.

Resignation and timeout bypass board evaluation and immediately end the match.

---

## 4. Core Product Journeys

### 4.1 Guest Casual Match

1. Visitor opens the web or desktop app.
2. App creates or resumes a guest session.
3. Visitor chooses a temporary display name, subject to profanity and uniqueness constraints within the current matchmaking population.
4. Visitor selects Casual.
5. Visitor selects a time control.
6. Visitor joins matchmaking.
7. Match is found.
8. Visitor plays.
9. Result is saved to the guest record.
10. Visitor may request a rematch.
11. Visitor may create an account.
12. Guest aggregate statistics and recent match summaries are transferred to the account.

### 4.2 Registered Ranked Match

1. User authenticates.
2. User has an immutable unique username and current Elo rating.
3. User selects Ranked.
4. User selects a time control.
5. User joins the rating-based queue.
6. System matches the user with a similarly rated opponent.
7. Match begins.
8. Result is committed.
9. Both Elo ratings update atomically.
10. Achievements and leaderboard eligibility update.
11. Both players receive final rating changes.
12. Either player may request a rematch.

### 4.3 Reconnection

1. Client disconnects.
2. Active player's clock continues.
3. Server keeps or reconstructs authoritative match state.
4. Client reconnects using authenticated or guest session.
5. Client requests a full snapshot.
6. Server returns:
   - Current board state.
   - Reserve state.
   - Active player.
   - Match version.
   - Remaining clock values.
   - Match status.
   - Recent communication events needed for UI continuity.
7. Client discards stale local state and renders the snapshot.

### 4.4 Explicit Abandonment

- Selecting "Leave Match" during an active game is a resignation.
- Closing the Tauri desktop window during a match should be intercepted and confirmed; confirmed close sends resignation before exit.
- Browser tab or window close should send a best-effort resignation beacon.
- Browser close, crash, power loss, and network loss cannot always be distinguished reliably.
- When no reliable resignation signal is received, treat the event as a disconnection and continue the active clock until the player returns or flags.

### 4.5 Rematch

1. Match ends.
2. One player requests a rematch.
3. Opponent sees a 30-second request.
4. If accepted:
   - Same game mode.
   - Same time control.
   - Colors alternate.
   - New independent match record.
5. If declined or expired, return both players to post-match state.

---

## 5. Recommended Technology Stack

### 5.1 Principles

- TypeScript across client, server, shared engine, and protocol.
- Pure deterministic rules engine with no database or UI dependencies.
- Shared client for web and Tauri.
- Authoritative real-time server.
- PostgreSQL as durable state.
- No Redis required in the initial single-server deployment.
- Clear interfaces for future Redis-backed matchmaking and Socket.IO adapters.
- Managed identity provider to reduce authentication security risk.
- Containers for reproducible deployment.
- Monorepo with strict package boundaries.

### 5.2 Monorepo

Use:

- pnpm workspaces.
- Turborepo.
- TypeScript project references where useful.
- ESLint.
- Prettier.
- Changesets only if package versioning becomes necessary; omit initially.

Suggested structure:

```
gobblet-online/
├── apps/
│   ├── web/                 # React/Vite web client
│   ├── desktop/             # Tauri v2 shell and desktop integration
│   ├── server/              # Fastify HTTP API + Socket.IO
│   └── admin/               # Optional separate admin shell; may begin as protected web routes
├── packages/
│   ├── game-core/           # Pure rules engine
│   ├── protocol/            # Zod schemas and shared event types
│   ├── game-ui/             # Shared React game UI
│   ├── design-system/       # Tokens and reusable components
│   ├── db/                  # Drizzle schema, queries, migrations
│   ├── auth/                # Auth client/server adapters
│   ├── observability/       # Logging, metrics, tracing helpers
│   ├── config/              # Typed environment configuration
│   └── test-utils/
├── assets/
│   ├── brand/
│   ├── models/
│   ├── textures/
│   ├── audio/
│   └── licenses/
├── infra/
│   ├── docker/
│   ├── deployment/
│   ├── monitoring/
│   └── backup/
├── docs/
│   ├── product-spec.md
│   ├── architecture.md
│   ├── protocol.md
│   ├── rules.md
│   ├── operations.md
│   └── adr/
├── .github/workflows/
├── docker-compose.yml
└── README.md
```

### 5.3 Client

Use:

- React.
- Vite.
- React Router.
- TanStack Query for HTTP server state.
- Zustand for limited local UI state.
- Three.js.
- React Three Fiber.
- @react-three/drei where appropriate.
- Zod for runtime validation.
- CSS variables and design tokens.
- Tailwind CSS or CSS Modules; choose one and document the ADR.
- Howler.js or the Web Audio API for sound.
- Auth0 SPA SDK on web.
- Tauri deep links and system-browser authentication for desktop.

Do not put authoritative game state in a general-purpose client state store. The active match view should consume a versioned server snapshot and pending command state.

### 5.4 Desktop

Use Tauri v2.

Desktop responsibilities:

- Package the same client build used by the web application.
- Store refresh/session material using platform secure storage where supported.
- Open external authentication in the system browser.
- Receive OAuth callback through a registered deep link.
- Confirm before closing an active match.
- Publish signed macOS and Windows installers.
- Check for and install signed updates.
- Report native crashes and update failures.

Artifacts:

- macOS DMG.
- Windows installer, preferably NSIS .exe; MSI may also be generated.
- Update manifest and signed update bundles.

### 5.5 Server

Use:

- Current Node.js LTS.
- Fastify.
- Socket.IO.
- Zod request and event schemas.
- Drizzle ORM.
- PostgreSQL.
- Pino structured logging.
- Sentry for application errors.
- Prometheus-compatible metrics endpoint.
- OpenTelemetry-ready instrumentation boundaries, without requiring a full tracing deployment in the first milestone.

Server modules:

- auth
- users
- guests
- profiles
- matchmaking
- matches
- game-runtime
- ratings
- leaderboards
- achievements
- communications
- admin
- analytics
- email
- health

### 5.6 Authentication

Use Auth0 Universal Login and Authorization Code Flow with PKCE.

Connections:

- Username/password database connection.
- Passwordless email.
- Google.
- Apple.
- GitHub.

Requirements:

- Email verification for password-based accounts.
- Verified email required before ranked matchmaking.
- Account-linking flow for identities sharing a verified email.
- Never silently link unverified identities.
- Server maps Auth0 subject identifiers to local user records.
- Local username remains independent of provider display name.
- Auth0 roles or local claims identify administrators.
- Desktop authentication uses system browser and PKCE, not an embedded credential form.

### 5.7 Database

Use PostgreSQL.

Core tables:

- users
- user_identities
- profiles
- guest_sessions
- ratings
- matches
- match_players
- match_events
- match_snapshots
- matchmaking_entries
- achievements
- user_achievements
- leaderboard_period_activity
- admin_audit_log
- outbox_events
- schema_migrations

Store canonical match state as versioned JSONB plus indexed relational summary columns.

Do not rely only on an in-memory match object. Persist after every accepted move and terminal action.

### 5.8 Deployment

Initial production topology:

- One application server region.
- Recommended region: US Central for broad global reach.
- One or two application containers on the same host for deploy continuity.
- Managed PostgreSQL.
- Cloudflare or equivalent CDN for static web assets and TLS edge termination.
- One authoritative Socket.IO origin.
- Object storage or GitHub Releases for desktop installers and update artifacts.

"Global" means globally reachable from one region. It does not imply uniform worldwide latency.

---

## 6. Game-Core Package

### 6.1 Requirements

packages/game-core must:

- Have no network imports.
- Have no database imports.
- Have no React imports.
- Avoid nondeterministic APIs.
- Avoid reading wall-clock time.
- Accept all time-related facts as arguments.
- Export immutable state transitions.
- Serialize deterministically.
- Be usable later by a computer-opponent package.

Suggested API:

```ts
export type GameState = Readonly<{
  version: 1;
  board: BoardState;
  reserves: ReserveState;
  activePlayer: Player;
  ply: number;
  repetition: RepetitionState;
  status: GameStatus;
}>;

export function createInitialGame(firstPlayer: Player): GameState;

export function enumerateMoves(state: GameState): readonly EvaluatedMove[];

export function evaluateMove(state: GameState, move: Move): MoveEvaluation;

export function applyMove(state: GameState, move: Move): MoveResult;

export function getVisibleOwner(state: GameState, square: Square): Player | null;

export function getWinningLines(state: GameState, player: Player): readonly WinningLine[];

export function canonicalPositionKey(state: GameState): string;
```

### 6.2 Evaluated Moves

The engine should distinguish legality from tactical consequence:

```ts
type EvaluatedMove = {
  move: Move;
  legal: boolean;
  consequence: "continues" | "wins" | "loses-by-reveal" | "draws-by-repetition";
  revealedOpponentLines: readonly WinningLine[];
  blockedOpponentLines: readonly WinningLine[];
};
```

### 6.3 Invariants

Assert after every transition:

- Exactly 24 pieces exist.
- Exactly 12 pieces belong to each player.
- Each piece exists in one location.
- Board stack sizes strictly increase bottom-to-top.
- External stack order is valid.
- Active player alternates only after a nonterminal accepted move.
- Terminal states cannot accept further moves.
- Position serialization is stable.
- Game state is immutable from the caller's perspective.

### 6.4 AI Readiness

Future computer opponents should be able to use:

- enumerateMoves.
- applyMove.
- getWinningLines.
- Canonical state keys.
- Terminal evaluation.
- A future evaluation function.

Do not place AI-specific logic inside the production rules engine.

---

## 7. Real-Time Match Runtime

### 7.1 Server Authority

Clients may calculate legal moves for immediate UI feedback using the shared engine, but the server must independently validate every command.

The client must never authoritatively determine:

- Whether a move is legal.
- Whether a player has won.
- Whether time expired.
- Rating changes.
- Achievement awards.
- Match version.
- Rematch creation.

### 7.2 Versioned Commands

Every mutating real-time command includes:

```ts
type CommandEnvelope<T> = {
  commandId: string;
  matchId: string;
  expectedVersion: number;
  sentAtClient: string;
  payload: T;
};
```

The server returns an acknowledgment:

```ts
type CommandAck =
  | {
      ok: true;
      commandId: string;
      newVersion: number;
    }
  | {
      ok: false;
      commandId: string;
      reason:
        | "stale-version"
        | "not-your-turn"
        | "illegal-move"
        | "match-ended"
        | "not-authorized"
        | "clock-expired"
        | "duplicate-command";
      snapshot?: MatchSnapshot;
    };
```

commandId must make retries idempotent.

### 7.3 Socket Events

Client to server:

- session:authenticate
- queue:join
- queue:leave
- match:sync
- match:move
- match:resign
- match:rematch-request
- match:rematch-respond
- match:preset-message
- match:reaction
- match:mute-state
- presence:heartbeat

Server to client:

- session:ready
- queue:status
- match:found
- match:snapshot
- match:move-committed
- match:clock-sync
- match:ended
- match:rematch-status
- match:preset-message
- match:reaction
- error:recoverable
- error:fatal

### 7.4 Persistence

For every accepted board move:

1. Lock the match row.
2. Recalculate the active clock.
3. Reject if time has expired.
4. Validate expected version.
5. Validate and apply move with game-core.
6. Append a match_event.
7. Update canonical state snapshot.
8. Update clock fields.
9. Increment match version.
10. Commit transaction.
11. Broadcast the committed event and snapshot delta.

On terminal outcome:

1. Mark match terminal.
2. Write result and reason.
3. Update ratings atomically if ranked.
4. Update aggregate statistics.
5. Evaluate achievements.
6. Write outbox events.
7. Commit.
8. Broadcast final state.

### 7.5 Recovery

On process restart:

- Load active match snapshots.
- Derive current clocks from persisted turn_started_at.
- Mark timed-out matches terminal before accepting new commands.
- Clients reconnect and request snapshots.

Matchmaking clients automatically rejoin their prior queue only after explicit client confirmation; do not silently queue stale sessions.

### 7.6 Deploy Draining

For production deploys:

- New container starts and becomes ready.
- Load balancer sends new connections to the new container.
- Old container stops accepting matchmaking entries.
- Existing sockets may remain until matches finish or a maximum drain period is reached.

Because state is persisted after every move, forced reconnects recover from PostgreSQL.

---

## 8. Clock Design

### 8.1 Persisted Fields

For each match:

- light_remaining_ms
- dark_remaining_ms
- active_player
- turn_started_at
- last_clock_commit_at
- status
- version

### 8.2 Clock Calculation

Do not decrement stored clocks every second.

For the active player:

```
effective_remaining =
  stored_remaining_ms - (server_now - turn_started_at)
```

On move receipt:

- Calculate effective remaining.
- If effective remaining is less than or equal to zero, reject the move and record timeout loss.
- Otherwise subtract elapsed time, apply move, switch active player, and set a new turn_started_at.

### 8.3 Client Display

The server periodically sends clock-sync events containing:

- Server timestamp.
- Both remaining times.
- Active player.
- Match version.

The client interpolates display locally but never decides timeout.

Suggested sync frequency:

- Every 2 seconds normally.
- Every 250 milliseconds when either clock is below 10 seconds.
- Immediate sync after accepted move, reconnect, and visibility change.

### 8.4 Background Tabs and Sleep

- Web clients must not depend on animation frames for correctness.
- Desktop sleep does not pause the server clock.
- On resume or tab visibility change, request a fresh snapshot.
- Audio warning near time expiration is optional and locally configurable.

---

## 9. Matchmaking

### 9.1 Queue Dimensions

Separate queues by:

- Mode: ranked or casual.
- Time control: 3, 5, 10, or 15 minutes.

### 9.2 Ranked Matchmaking

- Match only registered, eligible users.
- Initial rating window: ±100 Elo.
- Expansion: Add 50 Elo every 10 seconds.
- Maximum window ±400.
- After 60 seconds, allow any queued opponent in the same time control unless blocked by account or prior-match safety rules.
- Do not use geographic latency in matchmaking.
- Do not match a user against themselves through linked sessions.

### 9.3 Casual Matchmaking

- Guests and registered users.
- Same time-control queue.
- Use rating when available as a soft preference.
- Treat unrated guests as 1200 for queue ordering.
- Expand rapidly to prioritize short wait times.
- No Elo effect.

### 9.4 Color Assignment

- First match: random.
- Rematch: alternate colors.
- Store the random seed or assignment decision in match metadata for auditability.

---

## 10. Elo Rating

Use standard Elo:

```
expectedA = 1 / (1 + 10 ^ ((ratingB - ratingA) / 400))
newA = ratingA + K × (scoreA - expectedA)
```

Where:

- K = 32.
- Win score = 1.
- Draw score = 0.5.
- Loss score = 0.

Rules:

- Final rating is rounded to the nearest integer.
- Minimum displayed rating = 0.
- Rating updates occur only for ranked matches.
- Timeout and resignation count as ordinary losses.
- Threefold repetition counts as a draw.
- No provisional K-factor.
- No separate ratings by time control.
- Rating updates for both players must occur in the same transaction as final match completion.

Store:

- Rating before.
- Rating after.
- Delta.
- Formula version.
- Opponent rating before.
- Outcome.

---

## 11. Profiles, Statistics, Leaderboards, and Achievements

### 11.1 Public Profile

Show:

- Username.
- Avatar.
- Optional country flag.
- Current Elo.
- Current leaderboard rank.
- Ranked wins, losses, draws.
- Casual wins, losses, draws.
- Ranked games played.
- Casual games played.
- Current ranked streak.
- Best ranked streak.
- Account creation month and year.
- Earned achievement badges.
- Recent match summaries without move replay.

Do not show:

- Email.
- Identity providers.
- IP address.
- Exact location.
- Authentication history.
- Administrative notes.

### 11.2 Match Summaries

A match summary may show:

- Opponent username or guest label.
- Mode.
- Time control.
- Color.
- Result.
- End reason.
- Date.
- Elo change if ranked.
- Move count.

It must not expose the move event log to normal users.

### 11.3 Leaderboards

Provide:

- Daily.
- Weekly.
- Monthly.
- All-time.

Definition:

- All-time ranks all eligible users by current Elo.
- Period boards include users who completed at least one ranked match in that period, sorted by current Elo.

Tie-breakers:

1. Higher Elo.
2. More ranked wins in the period.
3. Fewer ranked games in the period.
4. Earlier achievement of current rating.

Initial display:

- Top 100.
- Current user's position even when outside top 100.
- Pagination or cursor for deeper results.

### 11.4 Achievements

Achievements are cosmetic and may award profile badges. No currency or gameplay advantage.

Initial set:

- First Victory — Win the first match.
- Getting Started — Complete 10 matches.
- Contender — Win 10 ranked matches.
- On a Roll — Win 3 ranked matches consecutively.
- Century Club — Complete 100 matches.
- Time Keeper — Win a ranked match by timeout.
- Uncovered — Win after moving a piece that revealed and then successfully blocked an opponent line.
- Four Ways — Record wins using row, column, and both diagonal categories over the account lifetime.

Achievement evaluation must be idempotent.

---

## 12. Preset Messages and Reactions

### 12.1 Preset Messages

Initial messages:

- Good luck.
- Good game.
- Nice move.
- Well played.
- One moment.
- Thanks.
- Oops.
- Rematch?

Messages may be sent at any time.

### 12.2 Reactions

Initial reactions should be visual icons without user-entered text, such as:

- Applause.
- Surprise.
- Thinking.
- Smile.
- Wooden-piece tap.

### 12.3 Mute

A player may independently mute:

- Preset messages.
- Reactions.
- Sound effects.

Mute preferences persist locally and, for registered users, in profile settings.

### 12.4 Safety

There is no user-visible communication cooldown in the MVP. Nevertheless:

- Payloads must be server-defined enums.
- Unknown values are rejected.
- Event sizes are capped.
- Infrastructure-level denial-of-service protections remain enabled.
- Muted communication must not be rendered or played.

---

## 13. 3D Board and Interaction Design

### 13.1 Rendering Approach

Use Three.js through React Three Fiber.

Scene:

- Realistic wooden 4×4 board.
- Two contrasting wooden piece finishes.
- Physically based materials.
- Soft studio lighting.
- Ambient occlusion or equivalent subtle contact shading.
- High-quality shadows with a performance fallback.
- Constrained perspective camera.
- Optional small orbit range, not free rotation.
- Camera automatically mirrors or rotates so the local player's reserve is nearest.

### 13.2 Asset Pipeline

- Use glTF/GLB for final models.
- Keep source Blender files outside runtime bundles but in controlled asset storage.
- Generate lower-detail variants if required.
- Compress textures.
- Use KTX2/Basis where supported.
- Track licenses and ownership for every asset.
- Keep logo, board, piece, texture, and sound assets replaceable.
- Use authorized Gobblet identity assets supplied by the rights holder.

The coding agent may begin with procedural placeholder geometry, but final public release requires approved production assets.

### 13.3 Interaction

Desktop pointer:

- Hover highlights a movable visible piece.
- Select lifts it slightly.
- Legal destinations illuminate.
- Losing reveal destinations use a warning treatment.
- Click a destination to submit.
- Input locks until acknowledgment.
- Accepted move animates.
- Rejected move returns piece and refreshes snapshot.

Keyboard:

- Tab through movable pieces.
- Arrow keys or WASD navigate squares.
- Enter selects or confirms.
- Escape cancels an unsubmitted selection.

Selection cancellation is allowed because selection is not a committed move.

### 13.4 Animation

Required animations:

- Piece hover.
- Selection lift.
- Board-to-board move.
- Reserve-to-board move.
- Gobbling descent.
- Covered-piece reveal.
- Winning-line emphasis.
- Timeout.
- Resignation.
- Match found.
- Rating change.

Rules:

- Animation must never delay the server clock.
- The next player's turn begins at server commit, not animation completion.
- Client may shorten or skip animation when catching up.
- Reduced-motion mode replaces movement with short fades or immediate transitions.

### 13.5 Sound

Required sounds:

- Piece select.
- Wood placement.
- Gobble.
- Reveal.
- Match found.
- Low-time warning.
- Win.
- Loss.
- Draw.
- Reaction.

Use short, nonintrusive sounds with independent master, game, and communication controls.

---

## 14. HTTP API

All endpoints are versioned under /v1.

### 14.1 Public

```
GET  /v1/config
GET  /v1/leaderboards
GET  /v1/profiles/:username
GET  /health/live
GET  /health/ready
```

### 14.2 Session and User

```
POST /v1/guests
POST /v1/guests/claim
GET  /v1/me
PATCH /v1/me/profile
GET  /v1/me/matches
GET  /v1/me/achievements
POST /v1/usernames/check
POST /v1/usernames/claim
```

### 14.3 Match

Most active match operations use Socket.IO. HTTP supports recovery and summaries:

```
GET /v1/matches/:matchId
GET /v1/matches/:matchId/snapshot
```

Authorization must ensure only participants or administrators can view a nonpublic match snapshot.

### 14.4 Admin

```
GET  /v1/admin/users
GET  /v1/admin/users/:userId
POST /v1/admin/users/:userId/suspend
POST /v1/admin/users/:userId/unsuspend
GET  /v1/admin/matches/:matchId
POST /v1/admin/ratings/:userId/adjust
GET  /v1/admin/achievements
POST /v1/admin/achievements
PATCH /v1/admin/achievements/:achievementId
GET  /v1/admin/metrics/summary
GET  /v1/admin/audit
```

Every administrative mutation requires an audit record with:

- Administrator.
- Action.
- Target.
- Before state.
- After state.
- Reason.
- Timestamp.

---

## 15. Data Model

### 15.1 Users

```
users
- id UUID PK
- auth_subject UNIQUE
- username UNIQUE
- status active|suspended|deleted
- created_at
- updated_at
- last_seen_at
```

### 15.2 Profiles

```
profiles
- user_id PK/FK
- avatar_url nullable
- country_code nullable
- preset_messages_muted
- reactions_muted
- game_sound_muted
- reduced_motion
- created_at
- updated_at
```

### 15.3 Guest Sessions

```
guest_sessions
- id UUID PK
- token_hash UNIQUE
- display_name
- claimed_by_user_id nullable
- created_at
- expires_at
- last_seen_at
```

Store only a hash of the guest claim token.

### 15.4 Ratings

```
ratings
- user_id PK/FK
- rating integer
- games_played integer
- wins integer
- losses integer
- draws integer
- current_streak integer
- best_streak integer
- updated_at
```

### 15.5 Matches

```
matches
- id UUID PK
- mode ranked|casual
- time_control_seconds
- status queued|active|completed|aborted
- result light|dark|draw|null
- end_reason line|timeout|resignation|repetition|admin|null
- light_player_type user|guest
- light_player_id
- dark_player_type user|guest
- dark_player_id
- game_state JSONB
- state_version integer
- light_remaining_ms
- dark_remaining_ms
- active_player
- turn_started_at
- move_count
- created_at
- started_at
- ended_at
```

### 15.6 Match Events

```
match_events
- id bigserial PK
- match_id FK
- sequence integer
- command_id UUID nullable
- type
- actor_type
- actor_id
- payload JSONB
- state_hash
- created_at

UNIQUE(match_id, sequence)
UNIQUE(match_id, command_id) WHERE command_id IS NOT NULL
```

Event log is internal for:

- Recovery.
- Debugging.
- Administrative inspection.
- Rule regression investigation.

It is not exposed as player replay in the MVP.

### 15.7 Achievements

```
achievements
- id UUID PK
- code UNIQUE
- name
- description
- badge_asset
- enabled
- rule_version

user_achievements
- user_id
- achievement_id
- earned_at
- source_match_id nullable
PRIMARY KEY(user_id, achievement_id)
```

---

## 16. Administration

The protected admin dashboard must support:

- Search users by username, email-derived identity lookup where permitted, or internal ID.
- View profile and account status.
- Suspend and unsuspend accounts.
- Inspect complete internal match event history.
- View clock and reconnection events.
- Correct Elo with required reason.
- Create, edit, enable, and disable achievements.
- View active matches.
- View queue depth by mode and time control.
- View recent errors.
- View daily active users.
- View match completion and abandonment rates.
- View average matchmaking wait.
- View server health and database health.
- View desktop version adoption.
- View audit log.

The admin dashboard does not need a separate native application.

---

## 17. Analytics and Observability

### 17.1 Product Analytics

Use anonymous or pseudonymous product analytics.

Track:

- App launch.
- Guest creation.
- Sign-up conversion.
- Authentication method.
- Queue join.
- Queue wait duration.
- Match found.
- Match started.
- Match completed.
- End reason.
- Rematch requested and accepted.
- Desktop update success or failure.
- Client rendering capability tier.
- Feature-setting changes.

Do not send:

- Move-by-move board state to third-party analytics.
- Email addresses.
- Authentication tokens.
- Free-form user data.
- IP-derived precise location.

### 17.2 Logs

Use structured JSON logs with:

- Request ID.
- Socket session ID.
- Match ID.
- User or guest pseudonymous ID.
- Command ID.
- Match version.
- Event type.
- Duration.
- Result.
- Error code.

Never log:

- Access tokens.
- Refresh tokens.
- Passwords.
- Magic links.
- Full authorization headers.

### 17.3 Metrics

Minimum metrics:

- HTTP request count and latency.
- Socket connection count.
- Socket reconnect count.
- Active matches.
- Queue depth.
- Matchmaking wait.
- Move validation latency.
- Database transaction latency.
- Command rejection reasons.
- Clock timeout count.
- Completed matches by end reason.
- Error count.
- Desktop version distribution.
- Deployment version.

### 17.4 Alerts

Alert on:

- Readiness failure.
- Elevated 5xx rate.
- Database connection exhaustion.
- Match transaction failures.
- Large increase in stale-version rejections.
- Clock calculation errors.
- Failed backups.
- Desktop update-signing failure.
- Error-rate regression after deployment.

---

## 18. Email

Keep email minimal.

Required:

- Email verification.
- Passwordless sign-in link.
- Password reset.
- Security notification for significant account changes.
- Optional welcome email.

Do not implement:

- Marketing campaigns.
- Match-result emails.
- Leaderboard digests.
- Achievement emails.

Use Auth0-supported email flows and a transactional provider such as Postmark, Resend, or equivalent. Wrap provider-specific calls behind an interface.

---

## 19. Security and Correctness

### 19.1 Server Validation

The server validates:

- Authentication.
- Match participation.
- Turn ownership.
- Match version.
- Command idempotency.
- Piece ownership.
- Source visibility.
- Reserve exposure.
- Destination size.
- Reserve-entry exception.
- Reveal consequences.
- Clock status.
- Match terminal status.

### 19.2 General Security

- HTTPS only.
- Secure, HttpOnly, SameSite cookies where cookies are used.
- PKCE for SPA and desktop authentication.
- Strict Content Security Policy compatible with required 3D assets.
- Dependency scanning.
- Secret scanning.
- Signed desktop binaries.
- Signed update manifests and bundles.
- macOS notarization.
- Windows code signing.
- Database least-privilege roles.
- Admin role separation.
- Request size limits.
- Schema validation on all inputs.
- Database parameterization through ORM/query builder.
- Regular backup restore tests.

### 19.3 Abuse Scope

Advanced anti-cheat and moderation are out of scope. However, foundational correctness is not optional:

- Clients cannot submit illegal moves successfully.
- Clients cannot set clocks.
- Clients cannot set results.
- Clients cannot set ratings.
- Clients cannot award achievements.
- Suspended accounts cannot queue.
- Preset-message payloads are enumerated server-side.

---

## 20. Testing Strategy

### 20.1 Game-Core Unit Tests

Require 100% statement, branch, and function coverage for game-core.

Test every rule explicitly:

- Initial setup.
- External stack order.
- Empty-square reserve placement.
- Illegal ordinary reserve gobble.
- Legal defensive reserve gobble.
- Board movement to empty square.
- Gobbling own smaller piece.
- Gobbling opponent smaller piece.
- Equal-size rejection.
- Larger-piece rejection.
- Covered-piece rejection.
- Every row win.
- Every column win.
- Both diagonal wins.
- Reveal loss.
- Reveal-and-block survival.
- Multiple revealed lines.
- Threefold repetition.
- Piece conservation.
- Terminal-state immutability.

### 20.2 Property-Based Tests

Use fast-check.

Properties:

- Applying a legal move preserves all piece invariants.
- Applying an enumerated legal move never throws.
- Every move not enumerated is rejected.
- Serialization and deserialization preserve canonical state.
- Position keys are deterministic.
- No piece is duplicated.
- No piece disappears.
- Board stacks remain strictly ordered.
- Game result is deterministic.
- Undo is not required, but test-only transition reconstruction from event logs reproduces snapshots.
- Random reachable states remain valid for long move sequences.

Run at least:

- 100,000 generated transitions in CI nightly.
- A smaller deterministic seed set on every pull request.
- Persist failing seeds as regression tests.

### 20.3 Protocol Tests

- Schema compatibility.
- Duplicate command IDs.
- Stale expected versions.
- Out-of-order events.
- Reconnect during move.
- Reconnect after move commit but before acknowledgment.
- Match completion exactly once.
- Rating update exactly once.
- Achievement award exactly once.

### 20.4 Clock Tests

Use fake clocks.

Test:

- Move immediately before timeout.
- Move received at timeout.
- Clock after reconnect.
- Clock after process restart.
- Clock after system sleep.
- No increment.
- Every time control.
- Resignation while clock running.
- Simultaneous timeout and move transaction ordering.

### 20.5 Integration Tests

Run server and PostgreSQL in containers.

Test:

- Guest casual match end-to-end.
- Account ranked match end-to-end.
- Guest claim.
- All authentication connection mappings with mocked identity provider.
- Matchmaking rating expansion.
- Rematch.
- Desktop deep-link callback at integration boundary.
- Planned deployment restart with active match recovery.

### 20.6 End-to-End Tests

Use Playwright.

Critical paths:

- Guest joins casual queue and completes match.
- Registered user joins ranked queue.
- Legal destinations render correctly.
- Illegal move cannot be submitted.
- Clock updates.
- Disconnect and reconnect.
- Resignation.
- Timeout.
- Preset message.
- Reaction.
- Mute.
- Rematch.
- Profile update.
- Leaderboard.
- Admin suspension.
- Desktop update check through a staged test channel.

### 20.7 Visual Tests

- Stable screenshots of menus, profiles, leaderboards, and admin views.
- 3D scene smoke tests on macOS and Windows CI where practical.

Manual rendering matrix for:

- Safari.
- Chrome.
- Firefox.
- Edge.
- macOS desktop webview.
- Windows desktop webview.

Test integrated and discrete GPUs where available.

Provide low-quality rendering fallback for unsupported effects.

### 20.8 Load Tests

Baseline release target:

- 1,000 simultaneous connected clients.
- 500 simultaneous active matches.
- Move acknowledgment server processing p95 below 100 ms, excluding public-network latency.
- No lost committed moves.
- No duplicate match completion.
- Stable database connection usage.
- Recovery after application restart.

Use k6, Artillery, or equivalent.

---

## 21. Quality Gates

"No bugs" is translated into verifiable release gates.

### 21.1 Pull Request Gates

- Type checking passes.
- Lint passes.
- Formatting check passes.
- Unit tests pass.
- Game-core coverage remains 100%.
- Protocol compatibility tests pass.
- Database migration validation passes.
- Dependency vulnerability threshold passes.
- No secrets detected.
- Required ADR added for architectural changes.

### 21.2 Release Candidate Gates

- Zero known critical defects.
- Zero known high-severity defects.
- All critical end-to-end journeys pass.
- All official rules acceptance tests pass.
- Property test nightly suite passes.
- Load target passes.
- Backup restore succeeds.
- Active-match restart recovery succeeds.
- macOS binary signed and notarized.
- Windows binary signed.
- Auto-update works from prior public version.
- Error-monitoring release marker present.
- Rollback procedure tested.
- Admin suspension and audit log tested.
- Privacy and terms pages published.

### 21.3 Production Targets

Initial targets:

- 99.9% API availability, excluding announced maintenance.
- More than 99.9% crash-free client sessions.
- Zero accepted illegal moves.
- Zero duplicate rating applications.
- Zero lost committed match events.
- Alert acknowledgment for critical production incidents.
- Daily database backups with at least 14 days retention.
- Quarterly restore drill.

---

## 22. Continuous Integration and Deployment

### 22.1 Pull Requests

GitHub Actions should run:

- Install with locked dependencies.
- Type check.
- Lint.
- Unit tests.
- Property smoke suite.
- Integration tests.
- Build web.
- Build server.
- Build Tauri in non-signing verification mode where feasible.
- Migration check.
- Security scan.

### 22.2 Main Branch

On merge:

- Build immutable server image.
- Build web assets.
- Run full tests.
- Deploy to staging.
- Run smoke tests.
- Require approval for production.
- Deploy production with drain-and-reconnect strategy.
- Publish release metadata to observability systems.

### 22.3 Desktop Releases

Use a separate versioned workflow:

1. Tag release.
2. Build macOS artifact on macOS runner.
3. Sign and notarize.
4. Build Windows artifact on Windows runner.
5. Sign.
6. Publish installers.
7. Publish signed update bundles.
8. Publish update manifest.
9. Test staged update channel.
10. Promote manifest to stable.
11. Update download page.

Maintain:

- Stable channel.
- Optional internal beta channel.
- Ability to pause update rollout.
- Minimum supported client version controlled by server configuration.

---

## 23. Backups and Disaster Recovery

- Managed PostgreSQL automated daily backups.
- Point-in-time recovery where available.
- At least 14 days retention.
- Monthly export of critical tables to encrypted object storage.
- Restore runbook.
- Quarterly restore test.
- Desktop artifacts replicated or retained in immutable release storage.
- Brand and 3D source assets backed up separately.
- Environment and infrastructure configuration stored as code.
- No production secrets in source control.

Recovery objectives for MVP:

- Recovery point objective: no more than 24 hours for catastrophic database loss; prefer point-in-time recovery.
- Recovery time objective: four hours for documented single-region recovery.
- Active in-progress matches may be declared aborted only after database recovery failure, with no Elo change.

---

## 24. Phased Implementation Plan

Each phase must end with working software and documented acceptance evidence. Do not build later-phase UI against mocked rule behavior once the authoritative engine exists.

### Phase 0 — Repository, Decisions, and Delivery Skeleton

Deliver:

- Monorepo.
- Package boundaries.
- Coding standards.
- Local Docker Compose.
- CI skeleton.
- Staging environment skeleton.
- ADRs for:
  - React/Vite.
  - Tauri.
  - Three.js/React Three Fiber.
  - Fastify/Socket.IO.
  - PostgreSQL/Drizzle.
  - Auth0.
  - Server-authoritative clocks.
  - Match event persistence.
- Initial docs.
- Environment-variable schema.
- Health endpoints.
- Basic release versioning.

Exit criteria:

- One command starts local web, server, and database.
- CI passes.
- Staging health check is reachable.
- Empty Tauri shells build on macOS and Windows CI.

### Phase 1 — Authoritative Rules Engine

Deliver:

- Complete game state model.
- Initial setup.
- Legal move enumeration.
- Move application.
- Win evaluation.
- Reserve defensive gobble exception.
- Reveal-loss rule.
- Repetition detection.
- Canonical serialization.
- Unit tests.
- Property tests.
- Rules documentation with examples.

Exit criteria:

- 100% game-core coverage.
- All official rule cases pass.
- 100,000-transition nightly property test passes.
- Pure package usable in Node and browser.
- No UI or server dependency.

### Phase 2 — Persistence and Match Runtime

Deliver:

- Database schema and migrations.
- Match creation.
- Match snapshots.
- Append-only event log.
- Versioned commands.
- Idempotency.
- Server clock.
- Resignation.
- Timeout.
- Restart recovery.
- Match finalization.
- Integration tests.

Exit criteria:

- Two test clients can complete a match through the server.
- Restart during an active match recovers state and clocks.
- Duplicate move commands do not duplicate moves.
- Terminal outcome is committed exactly once.

### Phase 3 — Authentication, Guests, and Profiles

Deliver:

- Auth0 integration.
- Email/password.
- Passwordless email.
- Google.
- Apple.
- GitHub.
- Guest sessions.
- Guest-to-account claim.
- Username selection.
- Immutable unique usernames.
- Basic profile.
- Profile settings.
- Suspension enforcement.

Exit criteria:

- All auth methods work in staging.
- Desktop PKCE deep-link flow works.
- Guest can claim data.
- Duplicate username races are handled transactionally.
- Suspended account cannot queue.

### Phase 4 — Matchmaking, Elo, and Rematches

Deliver:

- Casual queues.
- Ranked queues.
- Time-control queues.
- Elo rating.
- Rating-window expansion.
- Match creation.
- Color assignment.
- Rematch request and response.
- Rating transaction audit.
- Queue metrics.

Exit criteria:

- Guest casual matching works.
- Registered ranked matching works.
- Elo calculations match reference test vectors.
- Rematch alternates colors.
- Queue restart behavior is documented and tested.

### Phase 5 — Playable 3D Client

Deliver:

- Board scene.
- Piece models.
- External stacks.
- Camera.
- Piece selection.
- Legal destination display.
- Reveal-loss warning display.
- Move animation.
- Clock UI.
- Match status.
- Reconnect UI.
- Win/loss/draw presentation.
- Sound.
- Reduced motion.
- Rendering fallback.
- Responsive desktop layout.

Exit criteria:

- Complete match playable in supported browsers.
- Complete match playable in macOS and Windows shells.
- Hidden pieces never leak visually.
- Client cannot issue disallowed moves through ordinary UI.
- Snapshot recovery renders correct state.

### Phase 6 — Social Surface and Progression

Deliver:

- Preset messages.
- Reactions.
- Mute controls.
- Profiles.
- Separate ranked/casual statistics.
- Daily, weekly, monthly, and all-time leaderboards.
- Achievement system.
- Achievement badges.
- Recent match summaries.

Exit criteria:

- Communication works and respects mute.
- Achievement evaluation is idempotent.
- Leaderboards are correct under concurrent rating updates.
- No match replay is exposed to players.

### Phase 7 — Administration and Operations

Deliver:

- Admin dashboard.
- User lookup.
- Suspension.
- Match inspection.
- Elo correction.
- Achievement management.
- Metrics summary.
- Audit log.
- Sentry.
- Product analytics.
- Structured logs.
- Metrics and alerts.
- Backup automation.
- Restore runbook.
- Production deployment workflow.

Exit criteria:

- Admin actions are audited.
- Backup restores into staging.
- Alerts fire in controlled failure tests.
- Production deploy preserves or recovers active matches.

### Phase 8 — Desktop Distribution

Deliver:

- Production icons and metadata.
- macOS signing.
- macOS notarization.
- Windows signing.
- Direct-download pages.
- Automatic updater.
- Stable and beta channels.
- Update failure recovery.
- Client minimum-version control.

Exit criteria:

- Clean macOS machine installs and launches without security warning.
- Clean Windows machine installs and launches without SmartScreen trust warning after reputation/signing requirements are met.
- Prior version updates successfully to release candidate.
- Failed update leaves prior application usable.

### Phase 9 — Hardening and Public Launch

Deliver:

- Full regression suite.
- Load tests.
- Browser matrix.
- Desktop compatibility matrix.
- Privacy policy.
- Terms.
- Support and incident workflow.
- Launch dashboards.
- Rollback test.
- Release candidate bug burn-down.

Exit criteria:

- Every quality gate in Section 21 passes.
- Zero known critical or high-severity defects.
- Product owner approves visual quality.
- Product owner approves official-rule behavior.
- Production readiness review is signed off.

---

## 25. Work Ordering for a Coding Agent

The coding agent must work in vertical, reviewable increments.

Required order:

1. Create documentation and ADR structure.
2. Create monorepo and CI.
3. Implement game-core before networked gameplay.
4. Implement authoritative server runtime before polished animation.
5. Persist every accepted move before adding ratings.
6. Add auth and guest claim before public profiles.
7. Add matchmaking before leaderboards.
8. Make a plain but complete playable client.
9. Replace placeholders with final 3D presentation.
10. Add operations and desktop distribution.
11. Harden and launch.

The agent must not:

- Duplicate rule logic separately in client and server.
- Trust client-calculated outcomes.
- Store active matches only in memory.
- Couple game-core to Socket.IO.
- Couple game-core to PostgreSQL.
- Implement AI before the MVP is stable.
- Add private games or spectators without a scope change.
- expose internal match events as replay UI.
- use unsigned automatic updates.
- silently change a rules interpretation.

---

## 26. Documentation Requirements

Maintain these documents continuously:

- docs/product-spec.md
  - This specification and approved scope changes.
- docs/rules.md
  - Formal state representation.
  - Legal move definitions.
  - Terminal priority.
  - Worked edge cases.
  - Rule-source references.
  - Explicit digital adaptations.
- docs/architecture.md
  - Runtime diagram.
  - Deployment diagram.
  - Package dependencies.
  - Data flow.
  - Recovery behavior.
- docs/protocol.md
  - HTTP endpoints.
  - Socket events.
  - Schemas.
  - Versioning.
  - Idempotency.
  - Error codes.
- docs/operations.md
  - Deploy.
  - Rollback.
  - Backup.
  - Restore.
  - Incident response.
  - Desktop release.
  - Key rotation.
- docs/adr/
  - Every material choice or change receives an ADR.
- CHANGELOG.md
  - User-visible changes by version.

---

## 27. Initial Acceptance Scenarios

The coding agent must turn these into executable tests.

### Scenario A — Ordinary Reserve Placement

- Light selects exposed reserve size 4.
- Empty destination is accepted.
- Occupied destination is rejected unless official defensive exception applies.

### Scenario B — Defensive Reserve Gobble

- Dark has three visible pieces in a row.
- Light has an exposed reserve piece larger than one dark piece in that line.
- Light may cover that piece from reserve.
- Light may not cover unrelated occupied squares from reserve.

### Scenario C — Board Gobble of Own Piece

- Light size 4 is visible.
- Light size 2 is visible elsewhere.
- Size 4 may move over size 2.
- Size 2 becomes hidden.

### Scenario D — Reveal Loss

- A light piece covers a dark piece.
- Moving the light piece reveals dark's fourth visible piece.
- Light places elsewhere.
- Light loses immediately.

### Scenario E — Reveal and Block

- Moving the light piece reveals dark's line of four.
- The moved light piece is large enough to cover a different dark piece in the same line.
- Light covers that different piece.
- Match continues unless another terminal condition applies.

### Scenario F — Threefold Repetition

- Identical complete position with same side to move occurs three times.
- Match ends in draw.
- Ranked players receive Elo draw updates.

### Scenario G — Timeout During Disconnect

- Active player disconnects.
- Clock continues.
- Remaining time reaches zero.
- Server records timeout loss.
- Reconnection receives terminal snapshot.

### Scenario H — Retry After Lost Acknowledgment

- Server commits move.
- Acknowledgment is lost.
- Client retries same command ID.
- Server returns existing committed result.
- No duplicate event or turn advancement occurs.

### Scenario I — Guest Claim

- Guest completes casual matches.
- Guest creates an account.
- Guest statistics and summaries transfer once.
- Repeating claim does not duplicate data.

### Scenario J — Active Match Deployment

- Match is active.
- New server version deploys.
- Client reconnects.
- State, turn, and clocks remain correct.
- Match completes normally.

---

## 28. Assumptions Recorded from Product Answers

The question numbering contained one offset around rating questions. This specification uses the following interpretations:

- Elo is global rather than separated by time control.
- Starting rating is 1200.
- No provisional K-factor acceleration.
- Casual results are tracked separately but do not affect Elo.
- Leaderboards include daily, weekly, monthly, and all-time views.
- Achievements are cosmetic profile badges.
- Profiles include optional avatars and country flags but no biographies.
- Analytics are anonymous or pseudonymous by default.
- The deployment is globally accessible from one server region.
- A fully 3D scene with constrained camera is preferred over free camera rotation.

Any change to these assumptions must be made as an explicit product-spec edit and, when architectural, an ADR.

---

## 29. Reference Sources

1. Blue Orange Games, official English Gobblet rules:
   https://blueorangegames.eu/wp-content/uploads/2023/04/Gobblet-Rules-EN.pdf
2. Tauri v2 updater documentation:
   https://v2.tauri.app/plugin/updater/
3. Tauri v2 distribution documentation:
   https://v2.tauri.app/distribute/
4. Tauri v2 macOS code-signing documentation:
   https://v2.tauri.app/distribute/sign/macos/
5. Tauri v2 Windows code-signing documentation:
   https://v2.tauri.app/distribute/sign/windows/
6. React Three Fiber introduction:
   https://r3f.docs.pmnd.rs/getting-started/introduction
7. Three.js documentation:
   https://threejs.org/docs/
8. Socket.IO connection recovery and delivery documentation:
   https://socket.io/docs/v4/
9. Auth0 Authorization Code Flow with PKCE:
   https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-pkce
10. Fastify documentation:
    https://fastify.io/docs/latest/

---

## 30. Starting Instruction for the Coding Agent

Use this document as the controlling product and engineering specification.

Begin with Phase 0 and Phase 1 only. Before writing feature code:

1. Create the monorepo.
2. Copy this specification into docs/product-spec.md.
3. Create the ADR structure.
4. Write docs/rules.md as a formal restatement of Section 3.
5. Create a traceability matrix mapping every rule and acceptance scenario to planned automated tests.
6. Implement packages/game-core.

Do not begin the network server or 3D client until the rules engine, official edge-case tests, and property tests satisfy the Phase 1 exit criteria.

When ambiguity is found, record it in the product specification rather than silently choosing behavior.

Keep every change small, testable, and reviewable.

Treat server authority, idempotency, persistent match state, and clock correctness as non-negotiable architecture constraints.

---

# Appendix P1 — Recorded ambiguities and interpretations (added during Phase 1)

Section 30 requires ambiguities to be recorded here rather than silently decided. Each
entry names the specification text involved, the reading the implementation uses, and the
test that would fail if the reading were changed. The full statements live in
[`rules.md` section 13](rules.md#13-open-questions-and-interpretations); the identifiers
below match that document.

| ID  | Specification text                                                      | Ambiguity                                                                                                     | Reading implemented                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Section 3.5, "three visible pieces aligned in a potential winning" line | Whether a line still counts as "potential winning" when its fourth square already holds the mover's piece.    | It counts. The opponent could still complete the line by covering that piece, so the defensive entry stays available. The threat must run through the covered square, and the covered piece is therefore always one of the three.                   |
| Q2  | Section 3.8 and section 3.11                                            | Order of evaluation when one move both leaves a revealed opponent line and completes the mover's own line.    | The opponent wins. Section 3.8 states this directly, and section 3.11 orders the revealed line first; the engine implements exactly that priority.                                                                                                  |
| Q3  | Section 3.9, "Include all external stacks in order"                     | Whether the three external stacks of a player are position-relevant, or interchangeable piles of equal value. | Interchangeable. A stack always holds sizes 1..k, so a position is encoded by the remaining counts sorted descending. Two physically identical positions therefore share one key. This makes repetition detection match the physical game.          |
| Q4  | Sections 3.4 to 3.6 and 3.11                                            | No rule covers a player to move who has no legal move (all twelve pieces on the board and every one covered). | The engine reports zero legal moves and no outcome. No generated game has reached such a position. If the match runtime observes one, the intended resolution is a draw and it must be added to the rules and the engine as an explicit rule first. |
| Q5  | Section 3.11, step 9                                                    | Whose turn it is once a match has ended.                                                                      | A terminal state keeps the last mover as the active player, so clients and audit records can attribute the final move without reading the event log.                                                                                                |

Product-level deviations already stated by the specification itself, recorded here for completeness:

- No draw offer control (section 3.9), so mutual-agreement draws are unavailable in the MVP.
- Selection is a preview, not a binding touch (section 3.10).

## Appendix P0 — Phase 0 exit criteria not yet met (recorded, not silently skipped)

Two Phase 0 exit criteria in section 24 need infrastructure that does not exist yet. They
are recorded here so no later phase can treat them as delivered.

| Exit criterion                                   | State                  | Reason and planned closure                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty Tauri shells build on macOS and Windows CI | Deferred               | `apps/desktop` is not scaffolded yet. The decision itself is recorded in [ADR 0004](adr/0004-tauri-v2-desktop-shell.md). The shell needs a Rust toolchain, signing identities and a macOS/Windows CI matrix, all of which belong to Phase 8 (desktop distribution). Scaffolding it now would add an unverifiable build to the repository. |
| Staging health check is reachable                | Blocked on environment | `/health/live` and `/health/ready` exist and are covered by tests, and [`operations.md`](operations.md) defines the staging deployment. No hosting account, DNS or secrets exist yet, so nothing can be deployed or probed.                                                                                                               |

Everything else in the Phase 0 deliverable list is in place: monorepo, package
boundaries enforced by lint, coding standards, Docker Compose for PostgreSQL, CI
skeleton, ADRs, initial docs, environment-variable schema, health endpoints and
`0.1.0` release versioning. `pnpm dev` starts server plus web client, and adds the
database container when Docker is available.

## Appendix P2 — Phase 2 decisions and deviations (recorded, not silently decided)

Section 30 requires every ambiguity and deviation to be recorded here. Each entry names the
specification text, the decision taken, and where the decision is held by a test or a document.

| ID    | Specification text                                      | Decision                                                                                                                                                                                                                                                                                                                                            | Held by                                                                                                              |
| ----- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| P2.1  | Section 7.2, `sentAtClient: string`                     | The field is an integer epoch in milliseconds on the socket surface. It exists for diagnostics only and is never used for clock arithmetic, and every other socket duration is integer milliseconds, so a string would be the only outlier. HTTP bodies keep ISO 8601 strings.                                                                      | `packages/protocol/test/envelope.test.ts`, [`protocol.md` section 5](protocol.md)                                    |
| P2.2  | Sections 4.3 and 8, match status                        | The status vocabulary is `queued`, `active`, `completed`, `aborted`. `queued` covers a created match before both seats are present, `aborted` covers an administrative end with no sporting result. Phase 2 creates matches directly as `active`.                                                                                                   | `packages/db/src/schema.ts`, `packages/protocol/src/constants.ts`, `packages/config/test/protocol-alignment.test.ts` |
| P2.3  | Section 3.8, revealing an opponent line                 | The persisted end reasons include `revealed-line` next to `line`, so an audit can distinguish a win by completing a line from a win handed over by a reveal. The engine already reports the two cases separately.                                                                                                                                   | `packages/db/src/schema.ts`, `apps/server/src/match/state.ts`, `match-runtime.test.ts`                               |
| P2.4  | Section 14.3, match summaries over HTTP                 | Both `GET /v1/matches/:matchId` and `GET /v1/matches/:matchId/snapshot` are participant only, and a non-participant receives the same `not_found` body as an unknown match id. The specification only requires the snapshot to be protected, but leaking the existence and the players of a match through the summary would defeat that protection. | `apps/server/test/http-api.test.ts`, [`protocol.md` section 9.3](protocol.md)                                        |
| P2.5  | Section 7.2, acknowledgement reason codes               | A payload that fails schema validation is reported on `error:recoverable` with the field details, because no acknowledgement reason describes a malformed payload. When the envelope metadata is readable the command is also acknowledged as rejected with `illegal-move`; when it is not, the error event is the only answer.                     | `apps/server/test/socket-gateway.test.ts`, [`protocol.md` section 8.3](protocol.md)                                  |
| P2.6  | Section 12, clock synchronisation                       | `match:snapshot` and `match:move-committed` carry the stored clocks plus `turnStartedAt` and the client applies the formula. `match:clock-sync` carries no turn start, so the server applies the formula to the active side before sending. Both readings are true as of `serverTime`.                                                              | `apps/server/test/clock-broadcaster.test.ts`, [`protocol.md` section 12](protocol.md)                                |
| P2.7  | Section 6, matchmaking                                  | Matchmaking is Phase 4, so Phase 2 creates matches through `POST /v1/dev/matches`. The route is registered only when `APP_ENV=local` or `NODE_ENV=test`, so it cannot exist in a deployed environment.                                                                                                                                              | `apps/server/src/routes/dev-matches.ts`, `apps/server/test/http-api.test.ts`                                         |
| P2.8  | Section 5, guest sessions                               | A guest session token is 32 random bytes, returned once and stored only as a SHA-256 hash with a 30 day expiry. The specification does not describe the storage form, and storing the token itself would turn a database read into account access.                                                                                                  | `apps/server/src/guests/service.ts`, `apps/server/test/http-api.test.ts`                                             |
| P2.9  | Section 8.2, display names                              | Display names are trimmed before validation and bounded to the documented length, so trailing whitespace cannot create two visually identical names.                                                                                                                                                                                                | `packages/protocol/test` display name cases                                                                          |
| P2.10 | Section 20.5, "run server and PostgreSQL in containers" | CI runs PostgreSQL as a `postgres:16-alpine` service container. Locally the same suites run against a native PostgreSQL because this machine has no container runtime, which is the same limitation already recorded for Phase 0. The tests are identical in both places and select the database through `TEST_DATABASE_URL`.                       | `.github/workflows/ci.yml`, `apps/server/test/helpers/test-database.ts`, `.env.example`                              |
| P2.11 | Section 7.1, session handshake                          | A handshake whose `appEnv` differs from the server configuration is refused with a fatal `environment_mismatch`. A client pointed at the wrong deployment would otherwise play matches it can never find again.                                                                                                                                     | `apps/server/test/socket-gateway.test.ts`                                                                            |

## Appendix P3 — Phase 3 change of direction: first-party authentication

This appendix records a change to fixed product decisions, requested during Phase 3: the product
must not depend on an external identity provider. Sections 2.3 and 5.6 name Auth0, Universal
Login, PKCE and five login methods. The decision that replaces them is
[ADR-0017](adr/0017-first-party-email-password-authentication.md), which supersedes
[ADR-0008](adr/0008-auth0-identity.md).

What is delivered instead:

| Specification text                                                 | Delivered                                                                                                                                                                 | Reason                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Section 2.3, 5.6: email and password login                         | Delivered as a first-party credential: `scrypt` hash with per-user salt and stored cost parameters, verified in constant time.                                            | No provider needed.                                                                            |
| Section 2.3, 5.6: passwordless email link                          | **Not delivered.**                                                                                                                                                        | Requires a transactional mail sender, which is an external service.                            |
| Section 2.3, 5.6: Google, Apple, GitHub                            | **Not delivered.**                                                                                                                                                        | Each requires an external identity provider.                                                   |
| Section 5.6: Auth0 Universal Login with PKCE                       | **Not delivered.** Sign-in is a direct API call that returns an opaque session token.                                                                                     | No hosted login page exists to redirect to.                                                    |
| Section 5.6: desktop system browser and deep-link callback         | **Not applicable.** The desktop shell will use the same HTTP API as the web client.                                                                                       | There is no redirect flow to receive.                                                          |
| Section 5.6: account linking between verified identities           | **Not applicable while there is one credential type.** An email address identifies exactly one account, enforced in the database.                                         | Linking exists to merge provider identities, and there are no providers.                       |
| Section 5.6: email verification, verified email before ranked play | The verification token, the `email_verified_at` state and the ranked gate are delivered. Delivery is not: in local and test environments the verification link is logged. | No mail sender exists. The gate is built now so it cannot be forgotten when a sender is added. |
| Section 5.6: server maps subject identifiers to local users        | Delivered as the local user record owning username, email, moderation state and, later, rating.                                                                           | Unchanged by the direction change; product data was never keyed on a provider identifier.      |
| Section 14.2: `POST /v1/guests/claim`                              | Delivered: a guest session is claimed by an account, which rewrites the guest's match participation to the user and marks the guest session claimed.                      | Unchanged.                                                                                     |

Phase 3 exit criteria are affected as follows:

| Exit criterion                                       | State                                                                                                                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All auth methods work in staging                     | Reduced in scope to the one delivered method, and still blocked on environment: no staging exists (see appendix P0). The method is covered end to end by automated tests against PostgreSQL. |
| Desktop PKCE deep-link flow works                    | **Void.** There is no PKCE flow. The desktop shell arrives in Phase 8 and will use the same API as the web client.                                                                           |
| Guest can claim data                                 | Held by automated tests.                                                                                                                                                                     |
| Duplicate username races are handled transactionally | Held by automated tests that race two claims of the same username against a real database.                                                                                                   |
| Suspended account cannot queue                       | Enforced at match creation and at every match command, because matchmaking queues arrive in Phase 4. Held by automated tests.                                                                |

Password reset is not available in this phase, because it requires a mail sender. This is a
product gap, not an oversight: a player who forgets a password cannot recover the account until
delivery exists.
