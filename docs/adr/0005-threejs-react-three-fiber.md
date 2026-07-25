# ADR-0005: Three.js via React Three Fiber

## Status

Accepted

## Date

2026-07-24

## Context

Gobblet is a physical game whose central mechanic is vertical: larger pieces gobble smaller ones,
and the piece underneath still exists and still matters. A flat presentation has to invent
notation or badges to communicate stacking, which is exactly the information a player needs at a
glance. The product requires a genuinely three-dimensional board so that covering, uncovering and
piece size read naturally.

At the same time the board is a 4x4 grid played from a seated position. Free orbiting adds
disorientation and no information, and an extreme camera angle can hide which piece covers which.
The presentation therefore has to be 3D in rendering but constrained in camera behaviour.

The renderer must run inside the same React component tree as the surrounding UI (see
[ADR-0003](0003-react-vite-web-client.md)), and inside the operating system web views used by the
desktop shell (see [ADR-0004](0004-tauri-v2-desktop-shell.md)), which means WebKit on macOS and
WebView2 on Windows, plus a wide range of browser and GPU combinations on the web.

Status: planned (Phase 5). No renderer exists today.

## Decision

The board is rendered with Three.js, driven declaratively through React Three Fiber, using drei
helpers where they remove boilerplate.

- The camera is constrained to a near-2.5D presentation: a fixed, slightly elevated view with
  limited rotation and limited zoom, plus a board-flip for playing the dark side. There is no
  free orbit.
- 3D assets are authored and shipped as glTF or GLB. Textures are compressed as KTX2 or Basis so
  the download and GPU memory cost stay bounded.
- A quality fallback tier reduces effects (shadow quality, post-processing, texture resolution,
  antialiasing) on weak hardware and honours reduced-motion preferences, so the game stays
  playable rather than becoming a slideshow.
- Rendering is presentation only. The scene reads from the authoritative snapshot plus the local
  optimistic overlay and never holds match truth, and no rule logic is implemented in the scene
  graph (see [ADR-0012](0012-pure-shared-rules-engine.md)).
- Overlay UI (clocks, player cards, action confirmations) uses the shared design tokens so it
  matches the rest of the client, rather than being drawn inside the 3D scene (see
  [ADR-0013](0013-css-modules-design-tokens.md)).
- Assets and their license records live in `assets/models`, `assets/textures` and
  `assets/licenses`.

## Consequences

### Positive

- Stacking, covering and piece size are communicated by geometry instead of notation, which is
  the clearest possible representation of the core mechanic.
- React Three Fiber puts the scene in the same component tree as the rest of the UI, so board
  state, selection preview and overlays share React state flow without a bridge layer.
- drei covers common needs (loaders, controls, environment, helpers) without hand-writing them.
- Three.js is the most widely deployed WebGL engine, so device-specific problems tend to be known
  problems with known workarounds.
- A constrained camera removes an entire class of usability complaints and keeps the visual
  language predictable for animations.

### Negative

- 3D adds real cost: asset pipeline, bundle size, GPU compatibility testing, and performance work
  on low-end hardware.
- React Three Fiber's reconciler behaviour has to be understood to avoid re-creating scene
  objects on every render, which is a subtle performance trap.
- The desktop web views add two more rendering targets to verify, and they lag browser releases.
- Compressed textures require a build step and a transcoder, which is extra tooling.

### Neutral

- A quality tier means the product must define what the minimum acceptable experience is, and
  test it.
- Accessibility cannot rely on the 3D scene alone; the client needs keyboard-operable controls and
  clear non-visual state, which is a client requirement rather than a renderer one.
- Asset licensing must be recorded per asset in `assets/licenses`.

## Alternatives considered

### 2D canvas or SVG board

Rejected because the product requires a 3D board. A 2D presentation must encode stack contents as
symbols or numbers, which turns the game's central mechanic into something the player has to read
rather than see. This is a product requirement, not a rendering preference.

### Babylon.js

Rejected on integration fit. Babylon.js is a capable engine with strong built-in tooling, but its
React integration is less mature than React Three Fiber, and the project needs the scene to live
inside the React tree with minimal glue. Babylon's advantages (editor, physics, larger built-in
feature set) target needs this game does not have.

### Unity or another engine exported to WebGL

Rejected on payload and integration. An engine export produces a large download, an isolated
runtime that does not share the DOM UI, and an awkward path for the surrounding React application
and the Tauri shell. It also introduces a second toolchain and language for a board game that
needs no physics simulation.

### Pre-rendered sprites simulating 3D

Rejected because every camera adjustment, animation and piece combination would need new art, and
the result still cannot show arbitrary stack states convincingly.

## References

- [`../architecture.md`](../architecture.md)
- [ADR-0003](0003-react-vite-web-client.md), [ADR-0013](0013-css-modules-design-tokens.md)
- [`../rules.md`](../rules.md), [`../product-spec.md`](../product-spec.md)
