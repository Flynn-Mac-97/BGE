---
name: glass-scatter
description: Scatter — Bulk placement, declared in the level: **this many of these types, over this area, this far apart, out of these circles and corridors**. Use it instead of writing a build script that emit...
---
<!-- generated from plugins/builtin/scatter.agent.md at server start; edits are lost -->

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

## Every key

| key | shape | units | default | what it does |
| --- | --- | --- | --- | --- |
| `of` | `"tuft"`, `"tuft, stone"`, or a list whose entries are a name or `{ type, weight, mesh, properties }` | type names | `""` | what gets placed. `weight` is how often that entry comes up, relative to the others. `mesh` and `properties` are copied onto every placement of that entry. A name no type answers to is dropped and reported |
| `count` | number | placements | `0` | exactly this many. Wins over `density` |
| `density` | number | placements per square metre | `0` | a count worked out from the area's own size |
| `area` | `"box"`, `"disc"` or `"ring"` | — | `"box"` | which shape points are drawn from, centred on the scatter's own `at` |
| `width` `depth` | number | metres | `20` `20` | box only: the full span, so `60` reaches 30 m either side |
| `radius` | number | metres | `10` | disc and ring: the outer edge |
| `inner` | number | metres | `0` | ring only: the hole. Larger than `radius` swaps the two |
| `apart` | number | metres | `0` | least distance between two centres. `0` lets them touch |
| `clear` | list of `{ at: [x, z], radius }` or `{ type, radius }` | metres, world plan coordinates | `[]` | circles nothing may land in. The `type` form makes one circle around **every** entity of that type in the level |
| `corridors` | list of `{ path: [[x, z], …], width }` | metres, world plan coordinates | `[]` | lanes nothing may land in. `width` is the full lane, so `2.8` keeps 1.4 m off the centre line. A one-point path is a point |
| `yaw` | number or `[least, most]` | degrees about Y | `[0, 360]` | drawn per placement. **Rotation is drawn and not collided** — a turned solid still blocks its axis-aligned box |
| `scale` | number or `[least, most]` | multiplier | `1` | drawn per placement |
| `y` | number or `[least, most]` | metres | `0` | height above the scatter's own `at[1]`, drawn per placement |
| `sit` | `true` / `false` | — | `true` | lift each placement by half its own box height, so it stands on that height instead of being centred on it. Inert on a type with no `mesh.box` |
| `tries` | number | attempts per placement | `30` | how hard rejection sampling works before it gives up on one placement |

## Determinism

- Every number comes from `context.random`, which a level load reseeds from the
  level's `seed`. **The same seed grows the same field, for ever.**
- It is the level's one simulation stream, so adding or retuning a scatter moves
  every draw made after it, in level order. Two scatters in one level are grown
  in the order the entities appear in the file.
- Sampling costs two draws per attempt and four more per placement, so the draw
  count depends on the rule and nothing else.

## Commands

- `run scatter.list` — every scatter, what its rule resolves to, how many it
  placed, and how much of it is standing. This is the answer to "why is my field
  empty".
- `run scatter.preview '{"id":"tufts"}'` — grow it in the editor to look at. No
  id grows all of them, in level order, which is exactly what play would grow.
  **It marks the world simulated**, so the kernel refuses to save while a preview
  is up; without that an edit would write the whole field into the level file.
- `run scatter.clear` — every preview down, and the save refusal lifted.
- `run scatter.expand '{"id":"tufts"}'` — write the field out as real
  placements, remove the scatter marker, and save. A field already previewed is
  reused, so what you looked at is what is written. Needs the clock stopped.
  From then on the placements are ordinary entities you can select and nudge.

## What it refuses, and says

- `[Scatter] tufts: no type "tuftt" — nothing of it is placed`
- `[Scatter] tufts: a clear circle needs a radius in metres — {"at":[0,0]} keeps nothing clear`
- `[Scatter] tufts: a corridor needs a path of [x, z] points and a width in metres`
- `[Scatter] tufts placed 140 of 200 — 30 tries each is not enough at apart 1.2
  in this area. Widen the area, lower the count, or lower apart.` A short field
  is the spacing rule and the area disagreeing, not a bug.
- `scatter.expand` throws while the clock runs, and while the world is simulated
  by anything other than a preview.

## Driving it from code

`context.scatter.grow(entity)` · `.rule(entity)` · `.preview(id)` · `.clear()` ·
`.expand(entity)` · `.list()`. `growField(rule, random)` and
`readRule(entity, world)` are exported from `scatter.js` and are pure — a test
resolves and grows a field with no world and no renderer.
