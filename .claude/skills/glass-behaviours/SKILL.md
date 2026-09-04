---
name: glass-behaviours
description: Attach a shared trait to an entity — a behaviour file that runs alongside its type. Use when several types need the same movement, patrol, floating or reaction, and when deciding whether logic belongs in a type or in a behaviour.
---
<!-- generated from plugins/builtin/behaviours.agent.md at server start; edits are lost -->

# Behaviours

- This plugin owns the **verbs only** — attach, detach, list. The runtime is the kernel, `engine/world.js`, because the world is what runs hooks.
- A behaviour is one file, `project/behaviours/<name>.js`, shaped like a type with no art:

```js
// project/behaviours/float.js
export default {
  about: 'bob up and down around where it started',
  properties: { speed: 2, amplitude: 0.3 },
  start(entity, context, self) { self.base = entity.y },
  update(entity, seconds, context, self) {
    entity.y = self.base + Math.sin(context.time * self.speed) * self.amplitude
  }
}
```

The four hooks, and there are no others. Each takes one extra argument a type's does not: `self`.

| hook | signature | called by |
|---|---|---|
| `start` | `(entity, context, self)` | every entity in the world, when a run starts |
| `update` | `(entity, seconds, context, self)` | every fixed step |
| `onCollide` | `(entity, other, context, self)` | Physics 2D and Physics 3D, once on the step a contact begins |
| `onDestroy` | `(entity, context, self)` | `world.destroy` |

- `self` is this behaviour's own bag on the entity: `properties` to start with, plus whatever running state it writes. It is also `entity[name]`, which is how the inspector shows it. **Keep state in `self`, never on the entity** — then two behaviours can never collide over a name.
- Attach from a type or a placement. `behaviours: ['float']` takes the defaults, `{ float: { speed: 3 } }` changes them, and `{ float: false }` on a **placement** takes off one its type declared.
- Commands: `behaviour.attach '["crate-1", "float", {"speed": 4}]'` · `behaviour.detach '["crate-1", "float"]'` · `behaviour.list` (name, about, properties, hooks, usedBy, error, from the project index).
- Attach and detach **write the level file and redraw**. Both refuse once the world has been simulated: they return `{ skipped: 'simulated' }` and warn, because a level records starting state and the change would be lost on the next stop.
- They throw on: no such entity, no such behaviour file, already attached, and detaching one that is not there.
- A name that is already an entity field is refused at attach time — `id` `type` `x` `y` `z` `rotation` `scale` `sprite` `mesh` `collider` `properties` `overrides` `behaviours` `hidden` `play` `note` `velocityX` `velocityY` `velocityZ` `grounded` `animation` `frame` `flip` `animationDone`.
- Hooks run in the type's declared order, then anything the placement added, then the type's own hook last, so a type can correct what it composed. A throw is caught and reported as `[type:behaviour] hook`; the rest still run.
- A behaviour **cannot query another behaviour** and cannot find its own name. Two that must agree do it through plain fields on the entity.
- A missing or broken file keeps the attachment, marked with the reason, so the next save does not delete it.
