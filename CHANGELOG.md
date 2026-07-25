# Changelog

All notable user-visible changes are documented here. This project uses semantic
versioning for desktop releases; the web client tracks the same version number.

## [Unreleased]

### Added

- Phase 0 delivery skeleton: pnpm/Turborepo monorepo, package boundaries, coding
  standards, local Docker Compose database, CI skeleton and `pnpm dev` as the single
  local start command.
- Phase 0 `@gobblet/config`: the typed environment variable schema that every server
  process validates at startup, mirrored by `.env.example`.
- Phase 0 `@gobblet/server`: Fastify application with `/health/live`, `/health/ready`
  (pluggable dependency probes) and the public `/v1/config` document.
- Phase 0 `@gobblet/web`: Vite and React client shell with the design tokens, an API
  reachability indicator and the shared rules engine running in the browser.
- Phase 0 documentation set: product specification, formal rules restatement,
  architecture, protocol, operations and the initial architecture decision records.
- Phase 1 `@gobblet/game-core`: the authoritative, dependency-free 4x4 Gobblet
  rules engine with move enumeration, terminal evaluation, canonical position
  keys, invariant assertions, unit tests and property-based tests.
- Phase 2 `@gobblet/protocol`: the wire contract as Zod schemas, shared between
  server and clients, including the command envelope, acknowledgements, snapshots,
  socket events and HTTP bodies.
- Phase 2 `@gobblet/db`: PostgreSQL schema and migrations for guest sessions,
  matches and the append-only match event log, with row-locking repositories.
- Phase 2 `@gobblet/server`: the authoritative match runtime (versioned idempotent
  commands, server-owned clocks, resignation, timeout, restart recovery), guest
  sessions, the Phase 2 HTTP surface and the Socket.IO gateway that lets two
  clients play a full match through the server.

### Notes

- No public release yet. The first public milestone is the polished MVP described
  in `docs/product-spec.md`.
- Two Phase 0 exit criteria remain open (empty Tauri shells in CI, reachable staging
  health check) and are recorded in appendix P0 of `docs/product-spec.md`.
- Phase 2 decisions and deviations, including the development only match creation
  route and the native PostgreSQL used locally instead of a container, are recorded
  in appendix P2 of `docs/product-spec.md`.
