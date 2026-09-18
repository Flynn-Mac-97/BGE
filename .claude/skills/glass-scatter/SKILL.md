---
name: glass-scatter
description: Bulk placement declared in the level: this many of these types over this area, this far apart, out of named circles and corridors. Use to fill a field, forest or crowd of props without writing placements by hand.
---
<!-- generated from plugins/builtin/scatter.agent.md at server start; edits are lost -->

Read the generated interface in `plugins/builtin/scatter.agent/interface.generated.md`. Plugin edits refresh it while the server runs. This packet command also checks freshness:

```sh
node bin/engine.mjs agent.context '{"task":"…","files":["plugins/builtin/scatter.js"]}'
```

# Scatter

- Bulk placement, declared in the level: **this many of these types, over this
  area, this far apart, out of these circles and corridors**. Use it instead of
  writing a build script that emits placements.
- A scatter is an **entity**, `type: "scatter"`. The type is registered by this
  plugin, not by a file in `types/`, so it is not in the Project panel and cannot
  be dragged in — type it into the level, or `run place.at '["scatter", 0, 0]'`.
- **The field grows when the clock does** — on play and on `simulate` — and is
  never written into a level file. `scatter.preview` grows it in the editor;
  `scatter.expand` writes it out as real placements and removes the marker.

```json
{ "type": "scatter", "id": "tufts", "at": [0, 0, 0],
  "properties": {
    "of": "tuft, stone",
    "density": 0.08,
    "apart": 1.2,
    "width": 60, "depth": 60,
    "clear": [{ "at": [0, 0], "radius": 3.2 }, { "type": "landmark", "radius": 2.5 }],
    "corridors": [{ "path": [[-16, -11], [-1, 3], [7, 16]], "width": 2.8 }],
    "scale": [0.8, 1.3]
  } }
```

## Detail

Read only the file your task needs.

- `plugins/builtin/scatter.agent/every-key.md` — every key a scatter reads, with its default
- `plugins/builtin/scatter.agent/determinism.md` — what makes a field repeat exactly
- `plugins/builtin/scatter.agent/commands.md` — preview, expand, list and clear
- `plugins/builtin/scatter.agent/refusals.md` — what it refuses, and what it says instead
- `plugins/builtin/scatter.agent/from-code.md` — growing a field from a plugin or a test
