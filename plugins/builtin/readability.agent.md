---
description: Draws the arcade readability marks over a moving thing — a keyline of constant screen width, a soft contact shadow, and a ground ring round the followed actor. Use when something moving must read against its background, or one thing must be told from a crowd.
category: presentation
---

# Readability

Three marks, all drawn beside an entity rather than by it, so a model's own
materials are never touched. This plugin owns them; the renderer only holds the
`marks` registry they register into.

| mark | what it is | who gets it |
|---|---|---|
| `keyline` | a dark line of constant **screen width** round a silhouette | anything that has moved since it appeared |
| `contactShadow` | one soft ellipse on the ground | the same |
| `groundRing` | a coloured band on the floor | the actor the rule names |

## Declaring one

A level overrides the rule per entity, on `mesh`:

```json
{ "id": "guard", "type": "guard", "mesh": { "box": [0.8, 1.8, 0.8], "keyline": 3, "shadow": 1.2, "ring": 2, "ringColour": "#ffd34d" } }
```

| key | means |
|---|---|
| `keyline` | width in screen pixels. `0` turns it off |
| `keylineColour` | colour of this one's line |
| `shadow` | `true`, `false`, or a radius in metres |
| `shadowStrength` | how dark it presses |
| `ring` | `true`, or a radius in metres |
| `ringColour`, `ringStrength` | the band's colour and weight |

## The defaults

Written on `renderer.readability`, or `context.readability`, in place:

```js
context.readability.keyline = 3          // screen pixels
context.readability.shadow = false       // all contact shadows
context.readability.ring = 'player'      // 'followed' | entity id | type name | false
context.readability.groundY = 0          // where the floor is
```

The full set is in `readability/marks.js`. A changed `keyline` or
`keylineColour` rebuilds every outline already drawn; the rest reach the next
mark built.

## Switching it off

Render owns the look and switches all three off at once:

```sh
node bin/engine.mjs run render.set '{"readability":"off"}'
```

Use it for a realistic look; the contact shadow otherwise reads as a dark smudge
on a lit floor.

## In a game

```js
context.readability.keyline = 1.4
context.readability.ring = 'boss'
```

Outline overrides one entity's `keyline` when a hover or a selection has to show
without moving or recolouring it.

## Detail

- `readability/marks.js` — the defaults and the three registrations.
- `readability/keyline.js`, `contact-shadow.js`, `ground-ring.js` — one mark
  each, its geometry and its cache.
- `readability/hull.js` — the geometry a keyline grows from.
- `readability/floor-mark.js`, `ground-band.js` — the instanced floor quad both
  floor marks share.
