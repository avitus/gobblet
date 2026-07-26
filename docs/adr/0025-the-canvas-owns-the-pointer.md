# ADR-0025: The canvas owns the pointer, and the focus stops are projected

## Status

Accepted

## Date

2026-07-25

## Context

[ADR-0023](0023-rendering-tiers-and-a-flat-fallback-board.md) puts one interaction layer above
three presentation tiers and states that "in the WebGL tiers the focus stops are transparent DOM
elements positioned over the canvas, so assistive technology sees the same structure the flat tier
exposes". It does not say which surface receives a pointer event, and the first implementation of
Phase 5 answered that question badly: the stops were laid out as a uniform four-by-four CSS grid
over the canvas and took the clicks.

That is wrong for a perspective camera. The board is drawn foreshortened, so a square occupies a
trapezium whose position and size depend on the row, while a CSS grid divides the canvas into equal
rectangles. The two only agree near the middle of the board. The review of Phase 5 found exactly the
symptoms this predicts:

- A piece "does not land on the square selected", because the cell the pointer was in was not the
  square drawn under it.
- A piece "sometimes cannot be selected", because the near reserve row projected below the bottom
  edge of the overlay, so no cell covered it at all.

Both defects were invisible to the unit suite, which asserts what the interaction layer does with a
square once a square has been named, and both were invisible to the browser suite, which played its
moves on the flat tier where a square is a real DOM element.

An overlay could be made to agree with the drawing by computing each square's projected quadrilateral
and clipping the elements to it, but a quadrilateral cannot be expressed as a DOM hit area without
`clip-path` per element, and pieces would still be wrong: a piece is a solid body that occludes the
squares behind it, which no flat overlay can express.

## Decision

In the WebGL tiers the canvas owns the pointer and the DOM stops are the keyboard and assistive
surface only.

- Pointer events are handled by the meshes. A click reaches the interaction layer through the
  Three.js hit test, so whatever the player sees under the cursor, be it a square, a piece standing
  on it, or a piece in a reserve row, is what is acted upon.
- The overlay elements are `pointer-events: none`. They remain real focusable buttons carrying the
  same roles, labels and disabled state the flat tier exposes, so `Tab`, the arrow-key cursor and
  screen readers behave identically in every tier.
- Each stop is positioned where the camera projects its square or reserve stack, and is sized to
  one square pitch at that depth, so a focus ring lands on the thing it names. The projection is a
  pure function of the camera placement in `@gobblet/game-ui`, not a measurement of the canvas, and
  is therefore unit-testable without a graphics context.
- Because the scene container fixes its aspect ratio in CSS, the projection needs no layout
  measurement: one camera placement produces one set of stop boxes for every viewport size.
- After a pointer gesture on the canvas, the client moves focus to the stop for the square that was
  acted upon, so the keyboard continues from where the pointer left off.
- The camera's orbit range is bounded so that every square and every reserve piece stays inside the
  frame at every allowed azimuth and zoom. A piece the camera has cropped cannot be picked up, and
  the pointer surface being correct is worth nothing if the target is off screen.
- The browser suite plays at least one pointer move in the `full` tier and asserts the piece lands
  on the clicked square, since neither the unit suite nor the flat-tier specifications can see this
  class of defect.

## Consequences

### Positive

- What the player clicks is what the player gets, including a piece that occludes a square behind
  it, which is the behaviour a three-dimensional board implies.
- The keyboard and assistive surface stays in the DOM, so accessibility is still implemented once,
  above the renderer.
- A focus ring now coincides with the square it names, which it did not when the overlay was a
  uniform grid.
- Where geometry is a pure function, a browser defect can be turned into a unit test: the framing
  and stop-placement invariants are asserted without a graphics context.

### Negative

- Pointer behaviour in the WebGL tiers can now only be proved in a browser, so the suite of
  [ADR-0021](0021-playwright-browser-end-to-end-tests.md) carries a specification that needs a real
  graphics context.
- The projection duplicates, in a small pure module, knowledge that Three.js also holds. The two are
  kept in step by using the same camera constants and the same `PerspectiveCamera` class.
- The orbit range is narrower than it might otherwise be, because it is bounded by what keeps every
  piece in frame.

### Neutral

- Hover is now a mesh event, so it follows the drawn silhouette of a piece rather than a rectangle.
- Touch input, when it arrives, inherits the same hit test rather than needing a second overlay.

## Alternatives considered

### Keep the overlay and clip each cell to the projected quadrilateral

Rejected: it solves only squares. A piece standing on a square would still be unreachable except
through the cell beneath it, and `clip-path` per cell would have to be recomputed for every camera
change while still being unable to express occlusion.

### Draw the board with an orthographic camera so a uniform grid is correct

Rejected: it contradicts [section 13.1](../product-spec.md), which asks for a constrained
perspective camera, and it would flatten the depth cue that tells a player which row a piece is on.

### Move all interaction into the canvas, including keyboard focus

Rejected: it reimplements focus order, roles and labels inside a canvas, which is precisely what
[ADR-0023](0023-rendering-tiers-and-a-flat-fallback-board.md) chose not to do.

### Measure the canvas at runtime and place the stops from the measurement

Rejected as unnecessary: the container's aspect ratio is fixed, so the placement is already
determined by the camera. Measuring would make the stop positions untestable outside a browser and
would add a resize observer to a hot path.

## References

- [`../product-spec.md`](../product-spec.md) sections 13.1, 13.3, 15, appendices P5.17 and P5.18
- [ADR-0021](0021-playwright-browser-end-to-end-tests.md),
  [ADR-0022](0022-procedural-placeholder-assets.md),
  [ADR-0023](0023-rendering-tiers-and-a-flat-fallback-board.md)
- [`../architecture.md`](../architecture.md)
