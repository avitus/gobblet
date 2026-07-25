# ADR-0024: Browser-only user interface packages are consumed as TypeScript source

## Status

Accepted

## Date

2026-07-25

## Context

[ADR-0016](0016-esm-tsup-internal-packages.md) builds every internal package with tsup into `dist/`
and has consumers import only the `exports` surface. Its two reasons were that
`@gobblet/game-core` must be consumable by plain Node without a bundler, and that a built artifact
makes the package boundary real. Both reasons hold for the packages that existed when it was
written, all of which are plain TypeScript consumed by Node, by the browser or by both.

Phase 5 adds two packages that are unlike those: `@gobblet/design-system` (design tokens and
interface primitives) and `@gobblet/game-ui` (the board scene and the match interface). Their
modules are JSX components, CSS Modules and Three.js material code. Nothing in them can run in Node
without a bundler, and nothing outside a browser bundle will ever import them.

Building them with tsup is possible but adds a second bundler configuration whose only job is to
reproduce what Vite already does: CSS Modules would have to be either injected into JavaScript at
runtime or emitted as a stylesheet whose generated class names must stay in step with the emitted
modules, and the React and Three.js dependencies would have to be externalised consistently in both
tools. That is real configuration risk for no consumer benefit, because the only consumer is Vite.

## Decision

Packages that only ever run inside a browser bundle are consumed as TypeScript source, and every
other package continues to follow [ADR-0016](0016-esm-tsup-internal-packages.md) unchanged.

- The rule for which packages these are is mechanical: a package whose public surface contains JSX,
  CSS or a rendering dependency is browser only. Today that is `@gobblet/design-system` and
  `@gobblet/game-ui`. `game-core`, `protocol`, `config`, `auth` and `db` are unaffected and keep
  their tsup builds.
- A browser-only package has no `build` task. Its `exports` map points at `src/index.ts` and, where
  it ships stylesheets, at the specific `.css` files it wants consumers to load.
- The `exports` map remains the boundary. Consumers import `@gobblet/design-system` or a declared
  subpath; reaching into `src/` by path is forbidden and ESLint blocks `@gobblet/*/src/*` imports
  everywhere.
- A browser-only package may be imported only by browser targets. `apps/server` may not import
  React, Three.js, `@gobblet/game-ui` or `@gobblet/design-system`, and ESLint enforces that, which
  is what previously made the built artifact useful as a guard.
- Each browser-only package keeps its own `typecheck`, `lint` and `test` tasks, so a type error
  surfaces in the package that owns the code and not only in the application that bundles it.
- Because there is no build step, a change in these packages is visible in the running client
  immediately, which is the behaviour a component library wants during interface work.

## Consequences

### Positive

- One bundler configuration for browser code instead of two, and CSS Modules keep working exactly as
  they do inside the application.
- Editing a primitive updates the client without a rebuild, which shortens the loop for the phase
  with the most interface iteration.
- No duplicated externalisation rules for React and Three.js, so there is no way to end up with two
  React instances from a mis-set `external` list.
- Turborepo's graph gets simpler for these packages: nothing to build, nothing to cache, nothing to
  invalidate.

### Negative

- The boundary is enforced by lint and by the `exports` map rather than by the absence of the source,
  so a deliberate deep import is easier to write. It is still caught by lint.
- Type errors in a browser-only package are reported twice: once by its own `typecheck` and once by
  the consumer's, because the consumer compiles the same source.
- Two publishing models now exist in the repository, which a contributor must understand before
  adding a package. The rule above is the test.

### Neutral

- If either package ever needs a non-bundler consumer, it gains a tsup build and returns to
  [ADR-0016](0016-esm-tsup-internal-packages.md) without any change to its callers.
- The desktop shell is unaffected: it packages the built web application, which contains these
  packages compiled by Vite ([ADR-0004](0004-tauri-v2-desktop-shell.md)).

## Alternatives considered

### Build both packages with tsup, injecting CSS at runtime

Rejected: runtime style injection changes the cascade order relative to the application's own
stylesheets, which makes overrides depend on import timing, and it puts CSS in JavaScript for a
target that already has a bundler.

### Build both packages with tsup, emitting a separate stylesheet

Rejected: it requires the class name mapping produced by the CSS build to match the one baked into
the emitted modules, which is exactly the kind of configuration coupling that breaks silently after
a tool upgrade.

### Avoid CSS Modules in packages and ship a single global stylesheet

Rejected: [ADR-0013](0013-css-modules-design-tokens.md) chose CSS Modules precisely so component
styles are locally scoped, and a package of primitives is the place where that scoping matters most.

### Keep all interface code inside `apps/web`

Rejected: [`../architecture.md`](../architecture.md) already places `design-system` and `game-ui` as
separate packages, and their separation is what keeps rendering code out of the application shell and
lets ESLint state the dependency direction.

## References

- [ADR-0013](0013-css-modules-design-tokens.md), [ADR-0016](0016-esm-tsup-internal-packages.md),
  [ADR-0003](0003-react-vite-web-client.md), [ADR-0005](0005-threejs-react-three-fiber.md)
- [`../architecture.md`](../architecture.md) section 6
