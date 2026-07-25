# ADR-0013: CSS Modules with design tokens instead of Tailwind

## Status

Accepted

## Date

2026-07-24

## Context

The client has three styling surfaces that must look like one product: conventional web UI (lobby,
profiles, leaderboards, settings), overlay UI drawn on top of the 3D board (clocks, player cards,
confirmations), and the 3D scene itself, whose materials and lighting need colour values that match
the interface palette (see [ADR-0005](0005-threejs-react-three-fiber.md)).

Styling is also consumed from more than one package. UI lives in `apps/web` and in the shared
`@gobblet/game-ui` package, and the same build is embedded in the desktop shell (see
[ADR-0004](0004-tauri-v2-desktop-shell.md)). Whatever mechanism is chosen must work identically
across package boundaries and must not require the styling toolchain to scan sibling workspace
packages to discover which styles to emit.

The third-party value that matters most here is theming. A single source of truth for colour,
spacing, radius, typography and motion must be readable by CSS and by JavaScript, because the 3D
layer needs the same values as numbers and colours in code, not as class names.

Status: planned (Phase 5). No design system implementation exists today.

## Decision

Styling uses CSS Modules with design tokens defined as CSS custom properties in
`@gobblet/design-system`.

- `@gobblet/design-system` owns the token layer: colour, spacing, radius, typography, elevation,
  motion durations and easing, exposed as CSS custom properties and as a typed JavaScript export of
  the same values.
- Component styles are authored as CSS Modules colocated with their components, referencing tokens
  through `var(--token-name)` rather than literal values.
- `apps/web`, `@gobblet/game-ui` and the 3D overlay all consume the identical token layer. Nothing
  redefines a palette locally.
- The 3D scene reads the JavaScript token export for material colours and motion timing, so scene
  materials and interface elements cannot drift apart.
- Tailwind CSS is not used anywhere in the project.
- Global CSS is limited to resets, token declarations, and root-level theme selection.

## Consequences

### Positive

- One token layer serves web UI, overlay UI and 3D materials, so a palette change propagates
  everywhere including the scene graph.
- No content scanning across workspace packages. CSS Modules are compiled from the files that import
  them, so styles in `@gobblet/game-ui` work the same whether consumed by `apps/web` or by any future
  consumer, without configuring a scanner to look into sibling packages.
- Class name scoping is automatic and collision free, which matters when overlay UI and page UI
  coexist.
- Tokens as CSS custom properties support theming (including reduced motion and contrast
  adjustments) at runtime without rebuilds.
- No styling framework upgrade treadmill affecting every component's markup.

### Negative

- More files and more naming work than utility classes: each component carries a stylesheet, and
  contributors must name classes.
- No utility vocabulary means small layout adjustments are written as CSS rather than composed from
  existing classes, which is slower for quick iteration.
- Discipline is required to prevent literal values from creeping in instead of tokens; this is a
  review concern, not a compiler error.
- Dead style rules are less obvious than unused utility classes.

### Neutral

- Token names become a shared vocabulary that must be documented in the design system package.
- Duplicated CSS across components is possible and is addressed by extracting shared primitives into
  `@gobblet/game-ui` or the design system, not by a utility layer.
- The decision does not preclude a small internal utility class set built from tokens if one proves
  necessary.

## Alternatives considered

### Tailwind CSS

Rejected on two concrete grounds. First, Tailwind discovers which classes to emit by scanning source
content, which in a monorepo means configuring content globs that reach into sibling workspace
packages (`@gobblet/game-ui`, and later others); that coupling breaks the clean package boundary the
project is organised around and produces subtle missing-style failures when a glob is wrong. Second,
theme values would live in Tailwind's configuration while the 3D layer needs the same values as
JavaScript for materials and lighting, so the palette would be defined twice and would drift. The
utility-class ergonomics do not outweigh duplicating the token source of truth for a project whose
visual centre is a 3D scene.

### styled-components or Emotion

Rejected on runtime cost and fit. Runtime style injection adds work on every render in an
application that is already rendering a 3D scene each frame, and dynamic style generation during
gameplay is exactly the wrong place to spend main-thread time. Static CSS Modules cost nothing at
runtime.

### Vanilla Extract or another zero-runtime CSS-in-TypeScript library

Rejected as a close alternative rather than a bad one. It would give typed tokens with zero runtime,
but it adds a build-time abstraction and a new authoring language for a project that needs plain CSS
custom properties anyway (for runtime theming and for reading values from the 3D layer).

### Plain global CSS with a naming convention

Rejected because collision avoidance becomes manual, and overlay UI layered over the board is
precisely where accidental global selector overlap causes hard-to-find bugs.

## References

- [`../architecture.md`](../architecture.md)
- [ADR-0003](0003-react-vite-web-client.md), [ADR-0005](0005-threejs-react-three-fiber.md)
- [`../product-spec.md`](../product-spec.md)
