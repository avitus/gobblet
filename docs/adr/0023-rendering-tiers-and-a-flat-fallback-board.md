# ADR-0023: Three rendering tiers, with a flat board that is always playable

## Status

Accepted

## Date

2026-07-25

## Context

The product requires a three-dimensional board, and [ADR-0005](0005-threejs-react-three-fiber.md)
commits to Three.js with "a quality fallback tier" for weak hardware. Phase 5 has to turn that
sentence into something specific, because two of its deliverables depend on it: "rendering
fallback" and "reduced motion support" ([section 13](../product-spec.md)).

The situation the fallback exists for is not hypothetical. WebGL is absent or refused in enough
real environments to matter: virtual machines and remote desktops, drivers on the browser's
blocklist, hardware acceleration switched off by policy, older integrated graphics, and Safari with
a lost context after a long sleep. A player already in a rated match cannot be told to install a
driver; the clock is running.

There is also a correctness argument. If the 3D scene is the only way to submit a move, then the
scene owns the interaction rules, and every accessibility requirement (keyboard operation, screen
reader state, focus order from [section 15](../product-spec.md)) has to be reimplemented inside a
canvas that has no DOM. Separating what the player is allowed to do from how it is drawn is
cheaper than reproducing the interaction twice.

## Decision

The client renders the same match through one interaction layer and three presentation tiers, and
the lowest tier requires no WebGL at all.

- `full`: WebGL2, physically based materials, soft shadows, the full animation set, device pixel
  ratio capped at 2.
- `reduced`: WebGL without shadows or antialiasing, a simplified light rig, pixel ratio capped at
  1.5, shorter animations. This is the tier for weak hardware and for a context that reports
  itself as slow.
- `flat`: no WebGL. A DOM board of sixteen squares and six reserve stacks, rendered with the design
  tokens, showing piece size by scale and owner by colour.
- Every tier renders only what is visible on the physical board: the top piece of a stack. A
  covered piece is never drawn, never named and never described in the accessible output, even
  though the snapshot contains it, because the specification requires hidden pieces to stay hidden
  ([sections 2.7 and 22](../product-spec.md)). Derived warnings are the one permitted use of that
  data: the interaction layer may tell the player that a destination loses by reveal without
  showing what would be revealed.
- The tier is chosen once when the client starts, by asking for a WebGL2 then a WebGL1 context and
  reading the result. A player may override the choice in settings, and the override is persisted
  with the other settings. A lost and unrecoverable WebGL context downgrades the running client to
  `flat` without losing the match view, because the match view holds the snapshot, not the scene
  ([ADR-0020](0020-client-match-state-is-the-server-snapshot.md)).
- One interaction layer sits above all three tiers. It owns selection, the set of legal
  destinations, the reveal-loss warning, the input lock while a command is pending, and the
  submission gesture; it computes them from the snapshot with `@gobblet/game-core`. A tier is a
  view over that layer and contributes no rule.
- Keyboard operation belongs to the interaction layer, so it works in every tier rather than only in
  the flat one, and it is the model [section 13.3](../product-spec.md) specifies: `Tab` steps
  through the movable pieces, arrow keys or `WASD` move a square cursor, `Enter` selects the focused
  piece and then submits at the cursor, `Escape` clears an unsubmitted selection. In the WebGL tiers
  the focus stops are transparent DOM elements positioned over the canvas, so assistive technology
  sees the same structure the flat tier exposes.
- Reduced motion is orthogonal to the tier. When the operating system asks for reduced motion, or
  the player sets it explicitly, positional animation is replaced by a cross-fade in every tier,
  and no animation ever delays a state change ([section 13.4](../product-spec.md)).
- The flat tier is a first-class target: the end-to-end suite plays a complete match in it
  ([ADR-0021](0021-playwright-browser-end-to-end-tests.md)), so it cannot rot into an unusable
  path.

## Consequences

### Positive

- A player without WebGL can still play, which turns an entire class of support failures into a
  degraded but complete experience.
- Accessibility is implemented once, above the renderer, so the keyboard path cannot diverge from
  the pointer path.
- The flat tier is testable in jsdom, which gives the interaction rules fast unit coverage that a
  canvas could not provide.
- A lost WebGL context becomes a downgrade rather than a lost match.

### Negative

- Two visual implementations of the board exist and both must be kept correct as the rules
  presentation evolves.
- The flat tier cannot show that a piece stands on another at all, since drawing the stack would
  leak hidden information, so a player there relies more on memory and on the reveal warning.
- Three tiers multiply the manual verification matrix, even though only the two WebGL tiers differ
  in scene setup.

### Neutral

- Tier detection is a startup capability check, not a benchmark. Frame-rate-driven downgrade needs
  telemetry and is deferred to the performance phase ([section 19](../product-spec.md)).
- The interaction layer becomes the natural home for later input work (drag and drop, touch),
  which keeps those changes out of the scene graph.

## Alternatives considered

### One tier and an error page when WebGL is missing

Rejected: it makes an environmental limitation into an inability to play, and it would abandon a
player who is already in a rated match with a running clock.

### Automatic downgrade from measured frame rate

Attractive and deferred rather than rejected: it needs client telemetry to be trustworthy, and a
naive implementation oscillates between tiers. The capability check covers the case that actually
prevents play today.

### A software WebGL implementation as the fallback

Rejected: a CPU rasteriser is far slower than a DOM board and produces a worse experience than the
flat tier for the same result.

### Reduced motion implemented as the lowest tier

Rejected: a player who wants no movement does not necessarily want no depth. Conflating the two
would deny a legitimate preference the presentation they can otherwise run.

## References

- [`../product-spec.md`](../product-spec.md) sections 13.1, 13.3, 13.4, 15
- [ADR-0005](0005-threejs-react-three-fiber.md), [ADR-0013](0013-css-modules-design-tokens.md),
  [ADR-0014](0014-selection-is-preview-not-touch-move.md),
  [ADR-0020](0020-client-match-state-is-the-server-snapshot.md)
- [`../architecture.md`](../architecture.md)
