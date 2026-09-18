---
description: Light a scene: point, spot, directional, area and hemisphere lights, placed as entities in a level. Use when a scene is too dark or flat, when adding a lamp, sun or torch, or when shadows and light falloff are wrong.
category: presentation
---
# Lights

- A light is an **entity**, `type: "light"`, placed in the level like anything else. The type is registered here, not by a file in `types/`, so it never appears in the Project panel and cannot be dragged in — type it into the level or use `run place.at`.
- Five kinds: `point` `spot` `directional` `area` `hemisphere`.

```json
{ "type": "light", "id": "lamp", "at": [4, 3, -2],
  "properties": { "kind": "point", "color": "#ffb060", "intensity": 2.4,
                  "range": 12, "decay": 1, "shadow": false } }
```

- **One shadow. `SHADOW_CAP` is 1**, and it is a constant rather than a setting. A directional or spot shadow is a second render of the map every frame; a point light's is six. Map is 1024², so a directional light's texel is `range / 1024` metres — at `range: 96` that is 9 cm. A prop smaller than a few texels casts nothing at all.
- **`mesh: { shadow: false }` on a placement or a type casts nothing and still receives.** Anything flat and lying on the ground needs it: a mown patch, a rut, a scorch mark is a thin box, and a thin box under a low sun throws a hard offset shadow of its own outline across the surface it is meant to be part of.
- **Aim a shadow-casting key from the SIDE.** Aimed away down the view axis it throws every shadow directly behind the thing that cast it: full cost, nothing visible.
- `world.sun` in the level's `world` block is a separate directional light that **cannot cast a shadow**. Use it as fill and make the light entity the key.
- Also reads the level's top-level `lightmaps` block, and writes `mesh.lightmap` onto the entities it names. Nothing here bakes — `run lights.bake '{"surfaces":true}'` emits the manifest for an external bake.

## Detail

Read only the file your task needs.

- `plugins/builtin/lights.agent/every-key.md` — every key a light reads, with its default
