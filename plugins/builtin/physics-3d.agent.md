---
description: Solid bodies, collision, gravity, step-up and raycasts in 3D. Use when things fall through the floor, walk through walls, need to stand on something, or when you need to know what a line of sight or a shot hits.
---
# Physics 3D

- **The collider shape decides who owns an entity.** A `collider.box` of three
  numbers is 3D and belongs here; two numbers belongs to Physics 2D. Nothing to
  configure, and no flag anyone can forget to set.
- Runs on the fixed step, so `onCollide` fires deterministically and a ray fired
  from an update hook sees the same world on every replay.
- Everything is metres, converted once here: gravity is `-20.32`, a step
  is `0.46`.

## What an entity declares

```js
{ collider: { box: [0.8, 1.8, 0.8] },
  properties: { body: 'dynamic', stepHeight: 0.46 } }
```

| `properties.body` | means |
|---|---|
| `dynamic` | falls, is pushed out of solids, can step up |
| `solid` | blocks and never moves |
| `trigger` | reports contacts and pushes nothing |
| anything else | a collider that only reports contacts |

`collider.box` is `[width, height, depth]` in metres, times `entity.scale`.
`properties.stepHeight` overrides how high this body climbs without jumping.

## What it writes back

`entity.velocityX`, `velocityY`, `velocityZ`, zeroed on the axis it resolved,
and `entity.grounded` when the body was pushed out of the top of a solid.

A body only steps up while it is already grounded, so stepping is not a way to
climb through the air.

## Verbs on context

- `context.raycast(origin, direction, maxDistance, { ignore })` — the nearest
  hit, as `{ entity, distance, point, normal }`, or nothing.
- `context.canStand(entity, height)` — is there room to stand that tall.

## Contacts

Reported **once, on the step a contact begins**, through `world.hook`, so a
behaviour can answer `onCollide` and the rule need not be written into every
type. A level reload forgets them, so the new level gets its own first one.

## What it refuses, and why

- A vector with a component that is not a finite number is **refused, never
  repaired**. There is no safe default for where a shot came from; a zeroed
  coordinate returns a confident, precise, wrong answer at the world origin.
- `canStand` with a height that is not a positive number refuses, rather than
  standing a player inside a ceiling on room nobody measured.
- `ignore` takes an entity, an id, or a list of either. A bare id string is the
  shape everyone types first and it works.
- A ray fired from an entity id skips it, so a shooter never hits itself.

## Commands

- `physics3d.raycast` — a sightline in one call. Takes a point or an entity id
  at each end.
- `physics3d.bodies` — what is being simulated right now.

## What it costs

0.5 ms for 200 dynamic bodies, 6.4 ms for 2000, over budget past that. Solids
and triggers are near free. A raycast scans every 3D collider, so cast for a
shot, not for every bot every step. `run profile.steps` measures it.

## Detail

- `plugins/builtin/physics-3d.agent/raycast.md` — every raycast argument, and
  what each command replies
- `plugins/builtin/physics-3d.agent/cost.md` — the measured cost of bodies,
  solids, triggers and rays, and where the time goes
