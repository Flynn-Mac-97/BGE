---
name: glass-damage-numbers
description: The figure that lifts off a hit, drifts and fades. Use to show damage, heals, misses or any short word over an entity, and to check headless that a hit landed and for how much.
---
<!-- generated from plugins/builtin/damage-numbers.agent.md at server start; edits are lost -->

# Damage Numbers

- The figure that lifts off a hit, drifts, and fades. Automatic: it listens to `entity:hurt` and shows `dealt`, rounded.
- `context.damageNumbers.show({ at, text, colour, size, life, rise, critical })` for anything else — a word, a heal, a miss.
- `context.damageNumbers.defaults` — `size`, `life`, `rise`, `drift`. Set once from a game plugin and every number follows, the automatic ones included. The right size is a fact about your camera: about eight percent of what it sees top to bottom.
- `critical: true` makes it bigger, gold and slower. Plain hits are white with a dark outline so they read over any floor.
- Numbers are records, not entities: nothing can target them and they never enter the Scene tree. A hundred at once is normal.
- Drawn as camera-facing sprites, one cached canvas per distinct string and colour. Headless records them and draws nothing.
- Oldest are dropped past 240 live.
- Check with `damage.numbers` — it answers "did that land, and for how much" with no screen at all. Show one by hand with `damage.number '[[0,1,0], 42]'`.
