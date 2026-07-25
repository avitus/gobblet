# ADR-0016: ESM-only internal packages built with tsup

## Status

Accepted

## Date

2026-07-24

## Context

The workspace contains internal packages consumed by three different kinds of consumer: a Vite
bundled browser application, a Node server process, and the test runner. Two of those consumers have
incompatible expectations if the packages are shipped carelessly.

Node resolves relative imports in ESM strictly and requires explicit file extensions, so
source-only packages that use extensionless relative imports cannot be consumed directly by Node
even though a bundler handles them fine. Bundlers, on the other hand, are happy with extensionless
imports and often prefer to consume TypeScript source directly.

`@gobblet/game-core` sits at the centre of this problem. It must run unchanged in the browser (for
optimistic client evaluation), in Node (for the authoritative server), and in the test runner, and it
must be usable by a future AI opponent package or any plain Node script without a bundler (see
[ADR-0012](0012-pure-shared-rules-engine.md)).

There is also a build-graph requirement. Turborepo caches tasks and orders them with
`dependsOn: ["^build"]`, which only works if each package produces a build artifact that its
consumers actually type check against.

Status: implemented (Phase 0) for the packages that exist today.

## Decision

Internal packages are ESM only and are built with tsup into `dist/`, and consumers use only the
published `exports` surface.

- Every internal package sets `"type": "module"` and has no CommonJS output. There is no dual
  publishing.
- tsup produces ESM JavaScript plus generated `.d.ts` declarations into `dist/`.
- Each package declares an `exports` map pointing at `dist/`. Consumers import
  `@gobblet/<name>` (or a declared subpath) and never reach into `src/` or into internal file
  paths.
- Turborepo's `build` task uses `dependsOn: ["^build"]`, and `typecheck`, `lint`, `test` and
  `test:coverage` also depend on `^build`, so a package is always analysed against its dependencies'
  built declarations. Outputs are cached on `dist/**` (see
  [`../../turbo.json`](../../turbo.json)).
- Inside a package, relative imports are written without file extensions, and TypeScript is
  configured with bundler-style module resolution. tsup resolves and emits correct ESM, so the
  published artifact is valid for Node without extensions being hand-written in source.
- `@gobblet/game-core` is consumable unchanged from Node and from browsers because its built output
  is plain ESM with no dependencies and no Node built-ins.

## Consequences

### Positive

- One module format everywhere removes the entire class of dual-package hazards: no divergent
  CommonJS and ESM copies of the same module, no conditional exports subtleties, no instance
  duplication.
- Consumers see a real package boundary. Because only `exports` is reachable, refactoring internal
  file layout is not a breaking change.
- Type checking against built declarations catches boundary breakage that source-only consumption
  would hide behind a bundler.
- Turborepo can cache builds by content, so unchanged packages are not rebuilt and CI stays fast.
- The built artifact is directly runnable by Node, which is what makes a plain script, a future AI
  opponent package or a non-bundled consumer possible.
- Extensionless relative imports keep authoring ergonomic while the emitted output stays
  Node-correct.

### Negative

- A build step sits between editing a package and seeing the change in a consumer, so watch mode or
  an explicit build is needed during development.
- ESM-only excludes any hypothetical CommonJS consumer. That is acceptable for internal packages but
  is a real constraint if a package is ever published publicly.
- Two module resolution mental models coexist (bundler-style in source, strict ESM in output), which
  can confuse contributors until they see that tsup bridges them.
- Every new package needs its build task, `exports` map and tsup configuration set up correctly, which
  is boilerplate that must stay consistent.

### Neutral

- `dist/` is generated output and is not committed.
- Subpath exports are allowed where a package genuinely has separable entry points, but they must be
  declared explicitly.
- Tests run against the same resolution as consumers, since test tasks also depend on `^build`.

## Alternatives considered

### `tsc --build` with TypeScript project references

Rejected on authoring cost. Project references work, but emitting Node-valid ESM with `tsc` requires
writing `.js` extensions on every relative import in TypeScript source, which is a persistent
papercut and a frequent source of mistakes. tsup gives the same correct output without that
requirement, and it is faster.

### Source-only internal packages, with consumers compiling the TypeScript

Rejected because it breaks plain-Node consumption. A bundler can consume TypeScript source, but Node
cannot, so `@gobblet/game-core` would stop being usable from a script or a future non-bundled
consumer. It also weakens the boundary, since consumers can reach any file, and it makes type errors
appear in the consumer's build rather than in the owning package.

### Dual CommonJS and ESM output

Rejected as unnecessary risk. Every consumer here is ESM capable, and dual publishing introduces the
dual-package hazard, larger build configuration and a second output to test for no benefit.

### A single bundled application with no package boundaries

Rejected because it removes the enforcement point for the dependency rules. The purity of
`@gobblet/game-core` and the layering between protocol, database and client packages depend on those
packages being separate resolution units.

### Publishing internal packages to a registry

Rejected because it adds version coordination to every cross-package change, which is exactly what
the monorepo decision avoids (see [ADR-0002](0002-typescript-monorepo-pnpm-turborepo.md)).

## References

- [`../architecture.md`](../architecture.md), [`../../turbo.json`](../../turbo.json)
- [ADR-0002](0002-typescript-monorepo-pnpm-turborepo.md), [ADR-0012](0012-pure-shared-rules-engine.md)
