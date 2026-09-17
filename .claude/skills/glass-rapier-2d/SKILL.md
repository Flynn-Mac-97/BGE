---
name: glass-rapier-2d
description: Rigid body physics in 2D solved by Rapier — rotation, mass, friction, sleeping and a provable replay. Use when boxes must tip or roll in a side-on game, when a scene has hundreds of bodies, or when two runs have to come out identical.
---
<!-- generated from plugins/builtin/rapier-2d.agent.md at server start; edits are lost -->

# Rapier 2D

- **Same contract as Physics 2D.** The collider shape still decides who owns an
  entity: two numbers in the box, or a circle, and it is ours.
- **Only one may run.** This stands down while Physics 2D is enabled.
- **What it adds:** rotation, mass, friction, resting contacts and sleeping.

## Switching

```sh
run rapier2d.use                          # Rapier on, Physics 2D off
run rapier2d.use '{"on":false}'           # back to the built-in solver
run plugins.enable '["Rapier 2D", true]'  # the way back once it is off
```

The choice is written to `game.json`, so a reload keeps it. Turning Rapier off
takes `rapier2d.use` with it, because a disabled plugin contributes nothing.

## What changes when you switch

- **A dynamic body's `rotation` is now written every step**, in degrees. A
  sprite that relied on staying upright will spin.
- **`collider.circle` is a real circle.** The built-in solver reduces it to a
  box of the same size, so a ball that should roll only slides.
- **A rotated solid is a real slope.**
- **`physics.gravity` belongs to the built-in solver.** Gravity here is the
  Rapier world's, and `properties.gravity` on a body scales it.

## Provable replay

Rapier's WebAssembly build is cross-platform deterministic. The same world,
stepped the same number of times, gives the same bytes on any machine.

It is compiled before the world is handed over, so a run never begins without it.

```sh
run rapier2d.snapshot     # bytes, steps, and a sha256 of the world
```

Two runs that agree have the same hash. Two that disagree have diverged, and
the snapshot is the evidence.

The solver hands those bytes to a checkpoint, so `context.capture()` and
`context.restore()` bring the bodies back with the entities. Each world builds its
own Rapier world; only the compiled WebAssembly is shared between them.

**A level reload starts the solver again from nothing**, so a level played,
reloaded and played again is the level played once.

## Commands

- `rapier2d.use` — switch solver, and write the choice to `game.json`.
- `rapier2d.bodies` — every dynamic body: position, velocity, spin, grounded,
  asleep.
- `rapier2d.snapshot` — the hash two runs are compared by.

## Detail

The engine-facing half of both dimensions is one file,
`plugins/builtin/rapier/bridge.js`. Read it before changing either plugin.
