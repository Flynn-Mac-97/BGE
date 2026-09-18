---
description: Keeps a .blend file in the project and builds the .glb a type uses from it. Use when a model should stay editable in Blender, when a model looks out of date, or when an import fails.
triggers: blend, blender file, reimport, import model, source model
---

# Blender Assets

A `.blend` in the project is the source. The `.glb` beside it is built from it.
A type references the `.glb` as always:

```js
mesh: { model: 'kitten.glb', anchor: 'feet' }
```

## The loop

1. Put or build `assets/models/kitten.blend` in the project.
2. `node bin/engine.mjs --headless run blender.import '{"all":true}'`
3. The `.glb` is written beside the `.blend`. Hot reload swaps it into the open
   editor, because the engine already watches `.glb`.

Edit the `.blend` and run the import again. Nothing watches `.blend` files:
Blender is a program, and only a headless run can start one.

## Commands

| command | what it does |
|---|---|
| `blender.check` | names the Blender it will use, and its version |
| `blender.list` | every `.blend`, and whether its `.glb` is current |
| `blender.inspect '{"file":"..."}'` | each character's armature, meshes, height, `collection` and `scaleForPerson` |
| `blender.import '{"file":"..."}'` | builds one; `{"all":true}` every stale one; `"force":true` fresh ones too |
| `blender.settings '{"file":"...","scale":0.01}'` | writes an import setting |

The panel is called **Blender** and shows state only, for the same reason.

## What it writes

- `kitten.glb` — built by Blender, beside the source.
- `kitten.import.json` — the settings an author may edit, and a `built` receipt
  the importer writes. Never edit `built`; it is how staleness is decided.

## Materials

Values and image textures survive the `.glb`. A node graph does not, and every
import names the materials it lost. Each import also writes
`<model>.shaders.json` — the whole node graph — which the **Blender Shaders**
plugin rebuilds as a live TSL shader. Set `"bake": true` to flatten a graph to
a texture instead.

## Settings

`scale`, `applyModifiers`, `collection`, `bake`, `bakeSize`, `bakeSamples`,
`textureSize`, `imageFormat`, `occlusion`, `occlusionSamples`, `shaders`.

`"occlusion": true` bakes blocked sky light into the `_occlusion` attribute,
which dims environment light only: use it where a hat or hair covers skin.
Changing a setting makes the model stale.

## What it refuses

- No Blender found. Set `ENGINE_BLENDER` to the executable, or install Blender.
- A `collection` name that is not in the file.
- An export that produced no file. The failure carries Blender's own last lines.

## What it does not do

- It does not turn a Blender scene into a level. One `.blend` makes one model.
- It does not watch `.blend` files, and never reads one in the browser.

## Detail

- `plugins/builtin/blender-assets.agent/settings.md` — every setting, the receipt
  fields, and what to do when an import fails or a model looks wrong.
- `plugins/builtin/blender-assets.agent/materials.md` — what a material carries,
  measured; when to bake and when to write a shader instead.
