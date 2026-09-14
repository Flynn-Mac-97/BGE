# Settings, the receipt, and what to do when an import fails

## The settings file

One file per `.blend`, beside it: `kitten.blend` → `kitten.import.json`.

```json
{
  "scale": 1,
  "applyModifiers": true,
  "collection": null,
  "bake": false,
  "bakeSize": 1024,
  "bakeSamples": 16,
  "built": {
    "source": "kitten.blend",
    "modified": 1757721600,
    "size": 812344,
    "settings": { "scale": 1, "applyModifiers": true, "collection": null, "bake": false, "bakeSize": 1024, "bakeSamples": 16 },
    "blender": "4.3.2",
    "model": "assets/models/kitten.glb"
  }
}
```

| setting | effect |
|---|---|
| `scale` | multiplies every exported size. Use `0.01` for a file built in centimetres. |
| `applyModifiers` | export shapes as modifiers leave them, not the base mesh. |
| `collection` | export only this collection. `null` exports the whole file. |
| `bake` | bake procedural material colour to a texture first. See `materials.md`. |
| `bakeSize` | the baked image's width and height in pixels. Default 1024. |
| `bakeSamples` | Cycles samples per bake. Default 16; colour alone needs few. |
| `textureSize` | largest texture width or height in the export, e.g. `2048`. `null` keeps full size. Set it for any file with 4K or 8K maps: an 8K map takes 256 MB of GPU memory. |
| `imageFormat` | `auto`, `jpeg` or `webp`. `webp` makes the smallest `.glb` and keeps alpha. |
| `occlusion` | bake, per vertex, how much sky light reaches each point, and dim environment light by it in the engine. Use for characters and props with overhangs: a hat over a face, hair over a neck, folds in cloth. Worked out in the saved pose; it does not follow animation. Adds a Cycles bake of about 10–20 s. |
| `occlusionSamples` | rays per vertex for that bake. Default 64; 128 is smooth on a character. |
| `shaders` | write `<model>.shaders.json` and a `.textures` folder for Blender Shaders. Set `false` for plain PBR materials, because the folder repeats every texture as PNG. |

Write one with `blender.settings '{"file":"assets/models/kitten.blend","scale":0.01}'`,
or edit the file. A missing file means the defaults above.

## The receipt

`built` is written by the importer and read to decide staleness. A model is
stale when the `.blend`'s modified time or size differs from the receipt, when
the settings differ, or when the `.glb` is gone.

`modified` is in WHOLE SECONDS. The node half stats the file; the panel reads
`Last-Modified` from the dev server, which carries seconds. Storing
milliseconds would call every file stale in the browser.

## When an import fails

The error carries Blender's own last lines. Read those first.

| message | cause |
|---|---|
| `no Blender found` | set `ENGINE_BLENDER` to the executable path. |
| `no collection named "x"` | the `collection` setting does not match the file. |
| `Blender could not export …` | the export script raised. Blender's lines say why. |

Blender is searched for in this order: `ENGINE_BLENDER`, `blender` on PATH,
then the platform's install directory, with the highest version winning.

## When the model appears but looks wrong

The importer changes nothing about the mesh. A model that comes in at the wrong
size, facing, or origin was built that way, and the fix is in Blender:

- Wrong size — apply scale in Blender, or set `scale` here.
- Facing the wrong way — the engine's forward is glTF `-Z`, which the exporter
  maps from Blender `+Y`. Build the front of the model towards `+Y`.
- Floating or sunk — the type says where the origin is: `mesh: { anchor: 'feet' }`.

Ask the See plugin what is actually on screen rather than guessing from the
`.blend`.
