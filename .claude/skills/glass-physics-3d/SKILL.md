---
name: glass-physics-3d
description: Solid bodies, collision, gravity, step-up and raycasts in 3D. Use when things fall through the floor, walk through walls, need to stand on something, or when you need to know what a line of sight or a shot hits.
---
<!-- generated from plugins/builtin/physics-3d.agent.md at server start; edits are lost -->

Read the generated interface in `plugins/builtin/physics-3d.agent/interface.generated.md`. Plugin edits refresh it while the server runs. This packet command also checks freshness:

```sh
node bin/engine.mjs agent.context '{"task":"…","files":["plugins/builtin/physics-3d.js"]}'
```

# Physics 3D

- **There is a second solver.** Rapier 3D fills this same contract and adds
  rotation, mass, friction and sleeping. `run rapier3d.use` switches. Read
  `plugins/builtin/rapier-3d.agent.md` before choosing.
- **The collider shape decides who owns an entity.** A `collider.box` of three
  numbers is 3D and belongs here; two numbers belongs to Physics 2D. Nothing to
  configure, and no flag anyone can forget to set.
- Runs on the fixed step, so `onCollide` fires deterministically and a ray sees
  the same world on every replay.
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
and `entity.grounded` when pushed out of the top of a solid.

A body only steps up while already grounded, so stepping is not a way to climb
through the air.

## Verbs on context

- `context.raycast(origin, direction, maxDistance, { ignore })` — the nearest
  hit, as `{ entity, distance, point, normal }`, or nothing.
- `context.canStand(entity, height)` — is there room to stand that tall.

## Contacts

Reported **once, on the step a contact begins**, through `world.hook`, so a
behaviour can answer `onCollide` rather than every type carrying the rule. A
level reload forgets them.

## What it refuses, and why

- A vector with a component that is not a finite number is **refused, never
  repaired**. A zeroed coordinate returns a confident, precise, wrong answer at
  the world origin.
- `canStand` with a height that is not positive refuses, rather than standing a
  player inside a ceiling on room nobody measured.
- `ignore` takes an entity, an id, or a list of either.
- A ray fired from an entity id skips it, so a shooter never hits itself.

## Commands

- `physics3d.raycast` — a sightline in one call. Takes a point or an entity id
  at each end.

## What it costs

0.5 ms for 200 dynamic bodies, 6.4 ms for 2000, over budget past that. Solids
and triggers are near free. A raycast scans every 3D collider, so cast for a
shot, not for every bot every step. Measure with `run profile.steps`.

## Detail

- `plugins/builtin/physics-3d.agent/raycast.md` — every raycast argument, and
  what each command replies
- `plugins/builtin/physics-3d.agent/cost.md` — the measured cost of bodies,
  solids, triggers and rays, and where the time goes
