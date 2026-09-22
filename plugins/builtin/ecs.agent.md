---
description: A second entity model beside the engine's — component tokens, per-type stores, snapshot queries and systems run as an explicit ordered array on the engine's fixed step. Use when a game wants data-oriented composition instead of a behaviour per entity, and to opt in by requiring the `ecs` service.
category: engine
---

# ECS

A separate entity model, not a replacement for the engine's. An engine entity is
a flat record with behaviours; an ECS entity is a numeric handle that owns
component values, and a system is a function over a query. The two never touch:
`world.entities` is untouched. Nothing draws, collides or appears in a level
until a game writes that bridge.

## Opt in

- A scoped plugin declares `requires: ['ecs']` and calls `scope.require('ecs')`.
- Legacy plugins and game code read `context.ecs`, which this plugin sets in
  `onLoad` and clears on dispose.
- Loading the plugin costs nothing. Using it costs one of those lines.

## The surface

`context.ecs` and the `ecs` service are the same object.

- `defineComponent(name)` — an identity token. Define each type once and share
  the token; two calls with one name are two types. The plugin records the
  token so a checkpoint can find its values.
- `defineSystem(name, run)` — a unit of behavior. `run(world, { deltaSeconds })`.
- `systems` — the ordered array `runSchedule` walks. Order in it is order.
- `runSchedule(systems, world, frame)` — run them, in order.
- `createEntity()`, `destroyEntity`, `isAlive`, `addComponent`, `getComponent`,
  `hasComponent`, `removeComponent`, `query(types)`, `liveEntityCount` — the
  world, with the same contracts as upstream. `query([])` returns every live
  entity. `world` is the unbound object behind them.

```js
const ecs = context.ecs
const Position = ecs.defineComponent('Position')
const Velocity = ecs.defineComponent('Velocity')
ecs.systems.push(ecs.defineSystem('move', (world, { deltaSeconds }) => {
  for (const entity of world.query([Position, Velocity])) {
    const at = world.getComponent(entity, Position)
    const by = world.getComponent(entity, Velocity)
    at.x += by.x * deltaSeconds
  }
}))
```

## The clock

- The plugin contributes one `fixed` system, `ecs.step`. It runs the schedule
  with `{ deltaSeconds: seconds }`, the engine's own fixed step.
- Never give the ECS a second clock or `Math.random`. Step it from the engine's
  clock and draw from `context.random`, or a headless `simulate` diverges.
- `fixed` runs while playing and on `simulate`; edit mode runs neither.

## Checkpoints and limits

- The world is written into a rewind moment. An empty world is left out.
- Entity handles change across a restore, because the library exposes no way to
  set a slot's generation. Read handles from a query after a rewind.
- Components hold arbitrary values; one that cannot be deep-copied is reported
  among the moment's losses.
- No ECS entity is on screen, in a level, or in a physics solver. That bridge is
  a later step and belongs to the game that needs it.
