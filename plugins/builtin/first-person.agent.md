---
description: The weapon in the player's hands, drawn in its own pass with its own camera and key light. Use to hold a model in first person, to add weapon sway or kick, or when a held model clips into walls.
category: presentation
---

# First Person

A first-person weapon sits about half a metre from the eye. In the shared world
depth buffer it pushes into every wall you stand near, and there is no fix in
the world pass — pulling it closer only moves the wall it clips through. So the
weapon is a pass of its own, drawn after the world over a cleared depth buffer,
through a narrower camera (54 degrees against the world's 90). It carries its
own key light, so a rifle reads the same in a tunnel as in the open.

## Driving it

```js
context.viewmodel.set({
  model: 'weapons/ak47.glb',
  position: { x: 0.2, y: -0.15, z: -0.4 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: 1,
  attachments: { hands: 'hands.glb' }
})
context.viewmodel.offset({ x: 0.01, y: -0.02, z: 0.03 }, { x: 0.02, y: 0, z: 0 })
context.viewmodel.set(null)
```

- `set` holds one model. Calling it again with the same `model` is a move, not
  a reload, so it is safe to call every frame.
- `position` and `rotation` are in view space: -Z is straight ahead, +X right,
  +Y up, the origin at the eye.
- `attachments` hangs a model off a named node of `model`, the same declaration
  an entity carries. A pair of hands and a weapon compose with one entry.
- `offset` adds bob, sway and kick on top of the declared pose, and is
  overwritten on every call. `set` resets it to zero.
- `set(null)` puts the weapon away.

## What it owns

The model spec and its attachments, the sway offsets, the pass and its camera,
and the pass's ambient and key lights. The kernel owns the pass graph and the
`depth: 'clear'` option the pass declares.

## Where the pass runs

After `scene`, before `ui`. A post chain grades the world first, so the weapon
draws on top of the graded picture; anything that draws after this pass draws
over the weapon.

## In a world with no card

Headless still answers `context.viewmodel`, so a game holds and moves a weapon
and only the draw is skipped.

## Switching it off

`plugins.enable '["First Person", false]'` removes the pass and unpublishes
`context.viewmodel`. A post chain that ordered itself before this pass then has
one fewer label and reports the missing edge; it still draws.
