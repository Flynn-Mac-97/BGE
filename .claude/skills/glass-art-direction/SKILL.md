---
name: glass-art-direction
description: Set a game's visual direction from gathered references instead of taste — measure the references, turn what they agree on into rulings with numbers, generate the art bible, and check a real frame against it. Use before making art for a new game or subsystem, when redesigning a UI or a level's look, and whenever an art rule needs evidence behind it.
---
<!-- generated from plugins/builtin/art-direction.agent.md at server start; edits are lost -->

# Art Direction

An art document written from nothing is one agent's taste in the shape of a
law. Nothing sourced it, no command tests it, and the game drifts away from it
while it goes on claiming otherwise. This plugin makes a rule carry its
evidence: which references produced it, which field it is measured on, and what
bound it sets. Then `art.check` measures a frame with the same code that
measured the references and names every rule the game breaks.

It never reaches the network. Searching is your job; this owns the shelf, the
measuring and the document.

## Detail

Read only the file your task needs.

- `plugins/builtin/art-direction.agent/setting-up.md` — gathering references and turning them into rulings
- `plugins/builtin/art-direction.agent/checking-the-game.md` — holding a real frame against the bible
- `plugins/builtin/art-direction.agent/measured-fields.md` — every field a reference measure returns
- `plugins/builtin/art-direction.agent/refusals.md` — what it refuses, and what it says instead
- `plugins/builtin/art-direction.agent/files.md` — where the bible and the references are written
