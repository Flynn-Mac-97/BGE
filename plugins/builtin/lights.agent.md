# Lights

- A light is an entity of type `light`. This plugin registers the type, so it is
  not in the Project panel and cannot be dragged in — write it into the level, or
  `run place.at '["light", 4, 3]'`.
- `at` is `[x, y, z]` in metres; `z` defaults to 0. `rotation` and `scale` are not
  read — a light aims with `direction`.
- Every `properties` key is optional and merges over the defaults below.
- A light draws a small unlit marker box while editing, hidden while the clock runs.

## One light entity, in full

```json
{
  "type": "light",
  "id": "lamp-4",
  "at": [4, 3, -2],
  "properties": {
    "kind": "point",
    "color": "#ffb060",
    "intensity": 2.4,
    "range": 12,
    "decay": 1,
    "direction": [0, -1, 0],
    "angle": 45,
    "penumbra": 0.3,
    "width": 2,
    "height": 1,
    "groundColor": "#3a3f46",
    "shadow": true,
    "fade": 0,
    "static": true
  }
}
```

## Every property

| key | shape and unit | default | absent, or wrong |
| --- | --- | --- | --- |
| `kind` | `point` `spot` `directional` `area` `hemisphere` | `point` | any other word → `point`, reported |
| `color` | `#rgb` or `#rrggbb`, or a CSS colour name | `#ffffff` | anything else → the default, reported. Use only these two hex widths: a `#rgba` or `#rrggbbaa` value passes this plugin's check, as does any unknown colour word, and three then refuses it and leaves the light white |
| `intensity` | number, 0 and up | `2` | negative is clamped to 0 in silence; not a number → default, reported |
| `range` | metres to full falloff; `0` never falls off | `10` | point and spot; also sizes a shadow camera |
| `decay` | falloff power; `2` is real inverse square | `1` | point and spot only |
| `direction` | `[x, y, z]` world space, not all zero | `[0, -1, 0]` | spot, directional, area; bad value → default, reported |
| `angle` | degrees, half the cone, clamped at 90 | `45` | spot only |
| `penumbra` | 0–1, how soft the cone edge is | `0.3` | spot only |
| `width` `height` | metres of the rectangle | `2` `1` | area only |
| `groundColor` | colour bounced up off the ground | `#3a3f46` | hemisphere only |
| `shadow` | literal `true` only | `false` | any other value is `false`, unreported |
| `fade` | seconds to fade out over, then the entity destroys itself; `0` stays | `0` | fades on `(1 - progress)²`, and only while the clock runs |
| `static` | `false` marks a light that moves | `true` | read by `lights.bake` and nothing else |

What each kind reads: **point** colour, intensity, range, decay — **spot** those plus
direction, angle, penumbra — **directional** colour, intensity, direction (range only
sizes its shadow box) — **area** colour, intensity, width, height, direction —
**hemisphere** colour, groundColor, intensity; its position and direction are ignored,
so two of them only add intensities.

## The level's `lightmaps` block

Beside `entities`, not inside `world`. Baked light per named entity; the entity needs
an explicit `id` and a `mesh`. Applied only when something is drawing.

```json
"lightmaps": {
  "intensity": 1,
  "directory": "maps",
  "maps": { "brush-12": "brush-12-lightmap.png" }
}
```

`intensity` defaults to 1, `directory` to none (a bare file name then resolves under
`project/assets/`), `maps` to none. Each entry becomes `mesh.lightmap` and
`mesh.lightmapIntensity` on that entity, so a level saved while they are applied
writes the same values back onto each placement — harmless, and the block stays the
authority. The bake itself happens offline; nothing here computes one, and
`lights.bake` writes the manifest for it.

## What it refuses, and says

- `[Lights] lamp-4: "lamp" is not a light kind — one of point, spot, directional, area, hemisphere. Using point.`
- `[Lights] lamp-4 (point) intensity: "bright" is not a number — using 2`
- `[Lights] lamp-4 (spot): a direction is three numbers that are not all zero — got [0,0,0]`
- One shadow-casting light per level. `[Lights] 3 lights ask for shadows and this engine draws 1 — lamp-2, lamp-3 will light the scene but cast nothing.` The refused ones still light; the first light the world added wins.
- `[Lights] an area light only reaches standard and physical materials.` Give the surface `material: "standard"`, or use a spot.
- `[Lights] lightmaps.maps["x"] must be the name of one image file`, and one line naming every id that has no entity or no mesh.
- `lights.flash` throws `needs the clock running` in edit mode. Every message is said once.

## Driving it

- `run lights.list` — every light, resolved, plus which are drawn, fading or casting.
- `run lights.bake '{"surfaces":true}'` — the manifest an offline baker needs: static surfaces and static lights, metres, Y up.
- `run lights.flash '{"at":[4,2,-2],"color":"#ffd9a0","intensity":6,"range":9,"seconds":0.5}'` — a one-shot fading light; defaults `#ffd9a0`, 6, 9 m, 0.06 s, point.
- In code: `context.lights.flash(options)`, `.list()`, `.report()`, `.bake(options)`, `.shadowCap`.
- Headless, lights are resolved and reported but nothing is attached and no lightmap is loaded.
