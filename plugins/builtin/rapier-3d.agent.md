---
description: Rigid body physics in 3D solved by Rapier — rotation, mass, friction, sleeping and a provable replay. Use when boxes must tip, stack or roll, when a scene has hundreds of bodies, or when two runs have to come out identical.
---
# Rapier 3D

- **Same contract as Physics 3D.** It claims the same entities, reads the same
  keys and writes the same ones back, so a level plays under either solver.
- **Only one may run.** This stands down while Physics 3D is enabled, and says
  so rather than fighting over the entities.
- **What it adds:** rotation, mass, friction, resting contacts and sleeping.
  A crate tips instead of sliding; a settled pile costs nothing.

## Switching

```sh
run rapier3d.use                          # Rapier on, Physics 3D off
run rapier3d.use '{"on":false}'           # back to the built-in solver
run plugins.enable '["Rapier 3D", true]'  # the way back once it is off
```

The choice is written to `game.json`, so a reload keeps it. Turning Rapier off
takes `rapier3d.use` with it, because a disabled plugin contributes nothing —
`plugins.enable` is then the only way back.

## What changes when you switch

- **A dynamic body's `rotation` is now written every step**, as `[x, y, z]`
  degrees. A type that relied on its rotation staying put will turn.
- **A rotated solid is a real slope.** The built-in solver treats every solid
  as axis-aligned, so a ramp is a wall to it.
- **A body never steps up.** `properties.stepHeight` does nothing here; a
  character that walked over a doorway lip needs a ramp or a character
  controller, which this does not have yet.
- **`collider.circle` is a real circle**, not a box of the same size.

## Provable replay

Rapier's WebAssembly build is cross-platform deterministic. The same world,
stepped the same number of times, gives the same bytes on any machine.

```sh
run rapier3d.snapshot     # bytes, steps, and a sha256 of the world
```

Two runs that agree have the same hash. Two that disagree are not flaky, they
have diverged, and the snapshot is the evidence. A world restored from a
snapshot carries on exactly as the original would have, which is what makes
hot reload safe.

## What it costs

Rapier is faster than the built-in solver everywhere except very small scenes,
where the WebAssembly call overhead shows. 300 bodies cost 0.58 ms against
2.15 ms. Measure with `run profile.steps`.

## Commands

- `rapier3d.use` — switch solver, and write the choice to `game.json`.
- `rapier3d.bodies` — every dynamic body: position, velocity, grounded, asleep.
- `rapier3d.snapshot` — the hash two runs are compared by.
- `rapier3d.raycast` — nearest hit, the same shape Physics 3D answers in.

`context.raycast` and `context.canStand` follow whichever solver is chosen, so
game code never names one.
