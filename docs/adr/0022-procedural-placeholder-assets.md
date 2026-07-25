# ADR-0022: Ship procedural geometry and synthesised sound until licensed assets exist

## Status

Accepted

## Date

2026-07-25

## Context

Phase 5 must deliver a wooden board, four piece sizes, physical materials, studio lighting and ten
named sounds ([sections 13.1, 13.2 and 13.5](../product-spec.md)). The repository contains no
models, no textures and no audio, and the specification is explicit about the terms on which assets
may exist: every asset needs a recorded licence, and "placeholder assets are acceptable during
early phases as long as they are tracked and replaced before public launch"
([section 13.2](../product-spec.md)).

Two facts follow. First, no asset may be introduced without a licence record, which rules out
pulling models or sound effects from the internet during implementation. Second, the phase cannot
wait for an artist, because the interaction, the animation timing and the exit criterion do not
depend on final art.

The technical shape of the eventual pipeline is already decided: glTF or GLB models with KTX2 or
Basis textures ([ADR-0005](0005-threejs-react-three-fiber.md)). Nothing in this decision changes
that; it decides what stands in until the files arrive.

## Decision

Phase 5 renders and sounds entirely from code. No binary asset enters the repository.

- Board and pieces are procedural Three.js geometry: a plated board with inset squares, and
  cylindrical cups with a rounded lip in four sizes, distinguished by radius, height and material
  parameters rather than by mesh detail. Colour, roughness and metalness come from the design
  tokens so the placeholder still looks deliberate.
- Materials are physically based and lit by a small studio rig built in code (a key light, a fill
  light and an ambient term) with soft shadows on the highest rendering tier. No environment map
  file, no post-processing stack.
- Sounds are synthesised at runtime with the Web Audio API: short oscillator and filtered-noise
  envelopes, one generator per named sound in [section 13.5](../product-spec.md). Volume control
  is real, with independent master, game and communication channels, because the control surface is
  product behaviour rather than asset behaviour.
- Both are reached through one seam each. `BoardAssets` describes the meshes and materials the
  scene consumes; `SoundEngine` describes `play(name)` and the channel volumes. Replacing the
  placeholders means providing a different implementation of these two interfaces, and no call site
  changes.
- The KTX2 or Basis texture pipeline is not built in Phase 5, because there is no texture to
  compress. It arrives with the first real texture, as part of the asset work
  ([ADR-0005](0005-threejs-react-three-fiber.md) remains the governing decision).
- `assets/licenses/README.md` records the current state: no third-party asset is in use, and every
  future asset needs a row before it is committed. Procedural placeholders are first-party and need
  no licence.
- The public launch checklist keeps "replace placeholder board, pieces and sounds with licensed
  assets" as a release blocker, so the placeholder cannot survive by inertia.

## Consequences

### Positive

- The phase can be finished, tested and reviewed without waiting for art, and the exit criterion is
  about playability rather than beauty.
- Nothing enters the repository with an unclear licence, which is the risk that unlicensed
  placeholder art actually carries.
- Procedural geometry has no download cost, so the first playable build stays small and starts fast.
- The two seams make the eventual replacement a contained change with an obvious test: the same
  scene and the same sound calls, different implementations.

### Negative

- The placeholder look is plainly a placeholder: no wood grain, no bevel detail, no felt. Visual
  judgements about the final presentation cannot be made from this build.
- Synthesised sounds are functional, not pleasant. They confirm that the channels, the mute
  behaviour and the timing work, and they will not survive a listening test.
- Procedural geometry is written twice in effect: once now and once as a loader for the real
  models, although only behind the `BoardAssets` seam.

### Neutral

- Because materials read design tokens, a token change moves the board's appearance, which is the
  same coupling the rest of the interface has ([ADR-0013](0013-css-modules-design-tokens.md)).
- The asset directories stay in the repository structure with their licence register, empty of
  binaries but not of intent.

## Alternatives considered

### Source free-licence models and sound effects now

Rejected for Phase 5: choosing and recording licences for a dozen assets is asset work with a legal
component, it would be done twice once the real art exists, and it puts unreviewed third-party
files into the repository at the moment the interaction is still moving.

### Flat coloured shapes with no material work

Rejected: the phase must prove that stacking and piece size read at a glance, which depends on
shading and shadows. A flat look would leave the central question of the presentation untested.

### Silence in Phase 5, sound with the real assets

Rejected: the mixing behaviour (independent channels, the mute state, sounds arriving with server
events rather than with local input) is logic, and logic postponed is logic untested. Synthesised
tones exercise it now.

### Commission or generate assets as part of this phase

Rejected as out of scope: it is neither an engineering task nor on the critical path for a playable
match, and [section 13.2](../product-spec.md) explicitly permits tracked placeholders.

## References

- [`../product-spec.md`](../product-spec.md) sections 13.1, 13.2, 13.4, 13.5
- [ADR-0005](0005-threejs-react-three-fiber.md), [ADR-0013](0013-css-modules-design-tokens.md)
- [`../architecture.md`](../architecture.md)
