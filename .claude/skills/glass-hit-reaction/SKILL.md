---
name: glass-hit-reaction
description: The visible half of being hit: a flash, a shove, and a death that collapses. Use when hits feel weightless, when a death should linger or vanish, or to flash or shove an entity without a hit.
---
<!-- generated from plugins/builtin/hit-reaction.agent.md at server start; edits are lost -->

# Hit Reaction

- The visible half of being hit: a white flash, a shove, and a death that collapses. It changes no number anyone else reads, so a game can turn it off and play identically.
- Listens to `entity:hurt` and `entity:killed`. Nothing calls it directly in the normal case.
- `context.hitReaction.flash(entity, seconds, colour)` and `context.hitReaction.shove(entity, direction, metresPerSecond)` are there for a game that wants one without a hit.
- How hard a hit shoves comes from `knockback` on the damage call, not from here. A weapon owns that number.
- The flash is a tint swapped onto `entity.mesh` and put back afterwards — including removing it again when the mesh never declared one.
- A death spends the `linger` seconds Health gives it: the body squashes, sinks and shrinks, then Health removes it. `linger: 0` means it just vanishes.
- Knockback is written to `velocityX`/`velocityZ`, never to position, so a physics body still stops at a wall.
- Check with `hits.flashing`.
