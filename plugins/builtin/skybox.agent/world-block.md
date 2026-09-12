# The level's `world` block, in full

```json
"world": {
  "sky": "#b6c6d8",
  "skyTexture": "counter-strike/sky.png",
  "fog": [0.011, "#c9c0a8"],
  "ambient": { "intensity": 0.72, "color": "#bdb49f" },
  "sun": { "direction": [-0.45, -1, -0.35], "intensity": 1.5, "color": "#fff1cf" }
}
```

| key | shape | default when absent | owner |
| --- | --- | --- | --- |
| `sky` | `#rgb` or `#rrggbb`, a CSS colour name, or a number | nothing — the page shows through; `#6d7f96` as soon as `skyTexture` is set | Skybox |
| `skyTexture` | one image name; a bare name resolves under `project/assets/` | none, so the flat colour is the whole sky | Skybox |
| `fog` | `0.02` density, `"#8a94a3"` colour, `[density, colour]`, `{ density, color }`, `true` for the defaults, `false` or `null` for none | off. Written at all: density `0.014`, colour `#93a7c4` | World Look |
| `ambient` | `0.6` intensity, `"#93a7c4"` colour, `[intensity, colour]`, or `{ intensity, color }` | `{ intensity: 0.55, color: "#93a7c4" }` | World Look |
| `sun` | `1.2` intensity, `"#fff2d8"` colour, `{ intensity, color, direction }`, or a bare `[x, y, z]` — which on the sun **is** its direction, never `[intensity, colour]` | `{ direction: [-0.4, -1, -0.3], intensity: 0.9, color: "#fff2d8" }` | World Look |

`color` and `colour` are both read on `fog`, `ambient` and `sun`. Fog is
exponential-squared per metre: half of a surface is washed out at `0.83 / density`
metres, so `0.011` is half gone at about 76 m.

Every colour in this block is `#rgb`, `#rrggbb` or a CSS colour name. A four- or
eight-digit hex passes the check here and is then refused by the renderer, which
says `[render] setSky: cannot read colour "#11223344"` and drops it: the sky then
shows nothing, fog falls back to `#8a94a3`, and ambient and sun keep the colour they
already had.
