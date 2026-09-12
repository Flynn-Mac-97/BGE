---
name: glass-decals
description: Marks stuck to world surfaces: bullet holes, blood, scorch. Use for anything left behind on a wall or floor after a hit, and when decals pile up, float, or do not appear.
---
<!-- generated from plugins/builtin/decals.agent.md at server start; edits are lost -->

# Decals

- Owns `context.decals`: one capped wall of marks stuck to world surfaces — bullet holes, blood, scorch. A decal is **not an entity**: it is not in `world.entities`, has no collider, and nothing can hit it.
- One call, with the point and face a raycast returned:

```js
context.decals.place({
  at: hit.point,                    // { x, y, z } or [x, y, z]
  normal: hit.normal,               // the face the ray came in through
  size: 0.09,                       // metres, or [width, height]
  texture: 'decals/bullet-hole.png',
  tint: '#b9b2a4',
  rotation: context.random() * Math.PI * 2,
  life: 0                           // 0 = stays until the cap recycles it
})
```

Returns the decal, or `null` when it refuses. Every option, with its default:

| key | default | meaning |
|---|---|---|
| `at` | **required** | world metres. Missing means nothing is placed and the refusal is reported once |
| `normal` | `{x:0,y:1,z:0}` | normalised here. A zero-length normal falls back to up |
| `size` | `0.25` | metres. One number is a square, `[width, height]` a rectangle. A negative number is refused; a scalar `0` falls back to the default, a `[0, 0]` pair is refused |
| `texture` | `''` | resolved by `assetURL`, the same path a texture takes. No texture draws a tinted quad |
| `tint` | `'#ffffff'` | `#rgb` or `#rrggbb` only, converted to linear. An unreadable colour warns once and uses white |
| `rotation` | `0` | radians about the normal. The caller rolls it — use `context.random()`, never `Math.random` |
| `life` | `0` | seconds of engine time. `0` is permanent. A decal with a life fades out over its last quarter |

- Read it back: `context.decals.recent(n)` (default 20, oldest first), `.state` → `{ cap, alive, placed, recycled, revision }`, `.count`, `.all`, `.alpha(decal)`, `.clear()`.
- Commands: `decals.recent` · `decals.state` · `decals.clear`.
- **Emits no events.** Listens for `level:loaded` (wipes the wall — old marks would be at coordinates that now mean somewhere else) and `shell:ready` (starts drawing). Combat Effects is what turns `weapon:hit` and `entity:killed` into `place` calls, and it takes the pictures from `context.particles.art.bulletHole` and `.art.blood`, which the game sets.
- **The cap is 300 and it is a constant.** Placement 301 overwrites the oldest, silently. `state.recycled` counts it.
- Each mark is lifted **1 mm along the normal** so it does not fight the wall for depth. `decal.point` keeps the raw hit, so a test asserts the offset rather than recomputing it.
- Life is measured on `context.time`, the fixed clock — a headless `simulate()` expires a decal at exactly the same moment the browser does.
- Headless records but does not draw: three is imported only after `shell:ready`, so `decals.recent` answers "did that shot mark the wall" with no browser.
