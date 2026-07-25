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

### Notes

- No public release yet. The first public milestone is the polished MVP described
  in `docs/product-spec.md`.
- Two Phase 0 exit criteria remain open (empty Tauri shells in CI, reachable staging
  health check) and are recorded in appendix P0 of `docs/product-spec.md`.
