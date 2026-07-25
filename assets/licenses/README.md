# Asset licence register

Every runtime asset that is not first-party work needs a row in the table below before it is
committed. That is a review gate: an asset without a row does not merge
([product specification section 13.2](../../docs/product-spec.md),
[ADR-0005](../../docs/adr/0005-threejs-react-three-fiber.md)).

Layout, once binary assets exist:

| Directory          | Contents                                                    |
| ------------------ | ----------------------------------------------------------- |
| `assets/models`    | glTF or GLB models shipped to the runtime                   |
| `assets/textures`  | KTX2 or Basis compressed textures shipped to the runtime     |
| `assets/sources`   | Blender and other source files, never bundled at runtime     |
| `assets/licenses`  | This register, plus a copy of every licence text it names     |

## Current state

No third-party asset is in use. The board, the pieces and the sounds are generated in code:
procedural Three.js geometry and Web Audio synthesis, both first-party and both placeholders
([ADR-0022](../../docs/adr/0022-procedural-placeholder-assets.md)).

| Asset | Kind | Source | Licence | Attribution required | Notes |
| ----- | ---- | ------ | ------- | -------------------- | ----- |
| none  | -    | -      | -       | -                    | -     |

## Release blockers

Public launch requires all of the following, and none of them is satisfied yet:

- Approved production board and piece models, with textures, replacing the procedural placeholders.
- Approved production sounds for the ten events in section 13.5, replacing the synthesised tones.
- Authorised Gobblet identity assets supplied by the rights holder, including the logo.
- A row in this register for each of them, with the licence text stored beside it.
