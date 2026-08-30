# Kitten Survivors

## The art direction is generated, and lives in `art/`

Three subjects, each with its own brief, references, rulings and bible:

- `art/world/` — the arena, its props and its creatures
- `art/effects/` — weapons, hits, pickups, damage numbers
- `art/interface/` — HUD, level-up cards, buttons

Read `art/<subject>/bible.md`. Never edit one: they are written by `art.bible`
from the three JSON files beside them. Change a rule with `art.rule` and
regenerate. `node bin/engine.mjs run art.status` says where each subject stands.

Check a frame against a subject:

```sh
node bin/engine.mjs run see.capture '{"marks":false,"ui":false,"name":"look"}'
node bin/engine.mjs run art.check '{"subject":"world","frame":"agent-runs/see/look.png"}'
```

## The level and the textures are generated too

`levels/meadow.json` is written by `tools/make-kitten-survivors-meadow.mjs` and
the textures in `assets/meadow/` by `tools/make-kitten-survivors-textures.mjs`.
Both are seeded, so a re-run with nothing changed rewrites the same bytes. The
level file holds ordinary placements the editor can select and drag, and the
next run of the tool overwrites whatever was saved there — so change the tool,
not the level.

`assets/models/kitten.glb` is built by
`tools/blender/make-kitten-survivors-kitten.py`, which runs inside Blender.
