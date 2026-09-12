---
description: Solid bodies, collision and gravity in a 2D side-on or top-down game. Use for platformer movement, landing on ground, walls that block, and any 2D collision that is not behaving.
---
# Physics 2D

- **There is a second solver.** Rapier 2D fills this same contract and adds
  rotation, mass, friction and sleeping. `run rapier2d.use` switches. Read
  `plugins/builtin/rapier-2d.agent.md` before choosing.
- **The collider shape decides who owns an entity.** A `collider.box` of two
  numbers is 2D and belongs here; three numbers is 3D and belongs to Physics
  3D. Two plugins, disjoint sets of entities, nothing to configure.
- Runs on the fixed step, so `onCollide` fires deterministically and game code
  never has to learn what a fixed step is.

## What an entity declares

```js
{ collider: { box: [1, 2] },        // or { circle: 0.5 }
  properties: { body: 'dynamic', gravity: -22 } }
```

| key | meaning |
|---|---|
| `properties.body` | `'dynamic'` falls and is pushed out of solids; `'solid'` blocks and never moves. Anything else is a collider that only reports contacts |
| `collider.box` | `[width, height]` in metres, multiplied by `entity.scale` |
| `collider.circle` | radius in metres, multiplied by `entity.scale` |
| `properties.gravity` | metres per second per second, default `-22`. Negative falls |

## What it writes back

- `entity.velocityX` and `entity.velocityY`, zeroed on the axis it resolved.
- `entity.grounded` — `true` on any step the entity was pushed out of the top
  of a solid. That is what standing on something means.

## Contacts

- A contact is reported **once, on the step it begins**, through `world.hook`,
  so a behaviour can answer `onCollide` and the rule need not be written into
  every type that wants it.
- Both sides are told: `a.onCollide(b)` and `b.onCollide(a)`.
- Two solids never report a contact with each other.
- Circle against box reduces to a box test at this fidelity.

## Command

- `physics.gravity <n>` — set gravity on every 2D entity. It skips 3D entities,
  so it cannot quietly reset a map Physics 3D owns. A value that is not a
  finite number is **refused and nothing is changed**, because a NaN velocity
  stops a body being simulated at all.

## What it costs

Both passes bin entities on a 4 m grid, so neither is quadratic in the entity
count. `run profile.steps` measures it, headless, and names the system.

| dynamic bodies | step ms |
|---|---|
| 50 | 0.12 |
| 200 | 0.47 |
| 800 | 1.9 |

Bodies crowded into one cell cost most: they really do all touch, so the count
in one place is the number to keep down.
