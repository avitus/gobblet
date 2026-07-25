# ADR-0002: TypeScript monorepo with pnpm workspaces and Turborepo

## Status

Accepted

## Date

2026-07-24

## Context

Gobblet Online consists of a web client, a desktop shell, an authoritative server, a rules
engine, a wire protocol definition, a design system and shared test utilities. Two constraints
dominate the structure:

- The rules engine must be one implementation shared by client and server, so the client can
  render optimistic feedback that matches server truth exactly (see
  [ADR-0012](0012-pure-shared-rules-engine.md)).
- The wire protocol must be defined once and consumed by both sides, so an envelope or reason
  code cannot drift between client and server (see
  [ADR-0011](0011-versioned-idempotent-commands.md)).

Both constraints require atomic cross-cutting changes: a protocol change touches the protocol
package, the server and the client in one commit. The project is also maintained by a very small
team, so per-package release ceremony and cross-repository coordination are pure overhead.

At the same time, sharing code must not become sharing everything. The rules engine must stay
dependency free, and the client must never reach into persistence. Boundaries need to be
enforceable, not merely conventional.

## Decision

The project is a single Git repository containing one TypeScript monorepo, managed with pnpm
workspaces and orchestrated by Turborepo.

- One language, TypeScript in strict mode, across client, desktop, server, engine and protocol.
- pnpm workspaces defined in [`../../pnpm-workspace.yaml`](../../pnpm-workspace.yaml), covering
  `apps/*` and `packages/*`. Internal packages are named `@gobblet/<directory-name>` and are
  referenced by workspace protocol, never by published version.
- Turborepo owns the task graph in [`../../turbo.json`](../../turbo.json) with the tasks
  `build`, `typecheck`, `lint`, `test`, `test:coverage`, `test:properties:nightly` and `dev`.
  Non-`dev` tasks declare `dependsOn: ["^build"]` so a package always compiles against built
  dependency output, and results are cached by content.
- Package boundaries are explicit and enforced. The allowed dependency direction is documented
  in [`../architecture.md`](../architecture.md) and the purity of `@gobblet/game-core` is
  enforced by ESLint `no-restricted-imports`, `no-restricted-globals` and `no-restricted-syntax`
  rules in [`../../eslint.config.mjs`](../../eslint.config.mjs).
- `pnpm verify` runs `typecheck`, `lint`, `test:coverage` and `build` and is the gate a pull
  request must pass.
- Internal packages are ESM only and built with tsup (see
  [ADR-0016](0016-esm-tsup-internal-packages.md)).

## Consequences

### Positive

- A protocol or rules change lands as one reviewable, atomically testable commit across every
  consumer.
- One type system spans the wire boundary, so an envelope mismatch is a compile error rather
  than a runtime surprise.
- Turborepo caching keeps the full verification loop fast enough to run on every pull request
  even as package count grows.
- pnpm's strict node_modules layout prevents accidental use of undeclared transitive
  dependencies, which is exactly what the `game-core` purity rule needs.
- One toolchain, one lint configuration, one formatter for the whole system.

### Negative

- Monorepo tooling has its own failure modes: stale caches, task graph mistakes, and confusing
  errors when a dependency was not built.
- Nothing physically prevents a careless import across a boundary. Discipline is delegated to
  lint rules that must be maintained as packages are added.
- Continuous integration must be filtered or cached carefully, otherwise every change pays the
  cost of the whole workspace.
- Contributors must understand workspace resolution before their first change.

### Neutral

- Everything ships from one repository, so versioning is per release of the product rather than
  per package.
- Node 22 or newer and pnpm 10 are required, pinned via [`../../.nvmrc`](../../.nvmrc) and the
  `packageManager` field.
- Adding a package means adding it to the workspace globs, giving it a `build` task and, if it
  sits below an existing layer, extending the boundary lint rules.

## Alternatives considered

### Multiple repositories, one per deliverable

Rejected because the rules engine and the protocol must change together with both consumers. A
multi-repository layout forces publish-and-bump cycles for every protocol tweak, and it makes an
atomic "engine plus protocol plus client plus server" change impossible to review or test as one
unit.

### npm or Yarn workspaces without a task orchestrator

Rejected on caching and dependency isolation. npm and Yarn classic hoist dependencies, which
weakens the guarantee that `@gobblet/game-core` truly has no dependencies, and neither provides
a content-addressed task cache, so verification time grows linearly with the workspace.

### Nx

Rejected as heavier than needed. Nx offers generators, executors and plugin-managed
configuration that mostly duplicate what a small, hand-written pnpm plus tsup setup already
does, while adding a plugin abstraction over builds that the team would then have to learn and
debug. Turborepo provides the one feature actually required, a cached task graph.

### Bazel or a similar hermetic build system

Rejected as disproportionate. Hermetic builds pay off with many languages, large binary
artifacts and large teams. Here they would add substantial configuration surface and slow the
development loop for a small TypeScript-only codebase.

### One flat application with no package boundaries

Rejected because it makes the central architectural rule unenforceable. Without a package
boundary there is nothing to stop the rules engine from importing a database client or a React
hook, and the engine must stay reusable unchanged by a future AI opponent and a future mobile
client.

## References

- [`../architecture.md`](../architecture.md)
- [ADR-0012](0012-pure-shared-rules-engine.md)
- [ADR-0016](0016-esm-tsup-internal-packages.md)
- [`../../turbo.json`](../../turbo.json), [`../../pnpm-workspace.yaml`](../../pnpm-workspace.yaml)
