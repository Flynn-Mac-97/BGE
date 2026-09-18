---
name: glass-skybox
description: The sky of a level: a flat colour or a panorama over a sphere, declared in the level's world block. Use when the background is wrong, black, or should be a picture.
---
<!-- generated from plugins/builtin/skybox.agent.md at server start; edits are lost -->

Read the generated interface in `plugins/builtin/skybox.agent/interface.generated.md`. Plugin edits refresh it while the server runs. This packet command also checks freshness:

```sh
node bin/engine.mjs agent.context '{"task":"…","files":["plugins/builtin/skybox.js"]}'
```

# Skybox

- Owns `sky` and `skyTexture` in a level's `world` block: a flat colour, or a
  panorama mapped over a sphere. Nothing here feeds the simulation.
- The other three keys of that block are World Look's — fog and the global light —
  and are listed below so one block can be written in one go. One more plugin reads
  it: `world.post` is Post Processing's list of passes.
- `world` is a top-level key of the level file, next to `entities`. Every key in it is optional, and
  a key no plugin claims is read by nobody and reported by nobody.

## Detail

Read only the file your task needs.

- `plugins/builtin/skybox.agent/world-block.md` — the level's world block, every key
- `plugins/builtin/skybox.agent/sky-image.md` — the panorama, its format and where it is stored
- `plugins/builtin/skybox.agent/refusals.md` — what it refuses, and what it says instead
- `plugins/builtin/skybox.agent/commands.md` — setting and reading the sky from a terminal
