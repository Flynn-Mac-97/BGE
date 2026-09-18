---
description: Frame animation for sprite sheets: clips declared on the type, chosen by assigning entity.animation each step. Use for any 2D sprite that walks, idles, attacks or plays a one-shot clip, and when a clip does not advance or shows the wrong frame.
category: gameplay
---

# Sprite Animation

- Owns one job: on every fixed step it reads `entity.animation`, finds that clip on the type, and writes `entity.frame`. It draws nothing — `render.js` maps `frame` onto `sprite.sheet`.
- Clips are data on the type, beside the sheet they index:

```js
// project/types/player.js
sprite: { sheet: 'player.png', size: [16, 16], width: 0.9, height: 0.9 },
animation: {
  idle: 0,                                        // one frame, held
  walk: { frames: [1, 2], framesPerSecond: 8 },   // a cycle
  jump: { frames: [3], loop: false }
},
defaultAnim: 'idle',

update(entity) {
  entity.animation = entity.grounded ? (entity.velocityX ? 'walk' : 'idle') : 'jump'
}
```

A clip may be written three ways, and each widens to the same shape:

| written as | frames | framesPerSecond | loop |
|---|---|---|---|
| `4` (a number) | `[4]` | `1` | `true` |
| `[1, 2, 3]` (a list) | as given | `8` | `true` |
| `{ frames, framesPerSecond, loop }` | `frames`, default `[0]` | `8` | `true` unless `loop: false` |

| key | where | default | meaning |
|---|---|---|---|
| `animation` | type | none | the clip table. No table, and this plugin skips the entity |
| `defaultAnim` | type | first clip in the table | used when `entity.animation` is not set |
| `sprite.sheet` | type or placement | none | the strip. Read by the renderer, not here |
| `sprite.size` | type or placement | the whole image | `[cellWidth, cellHeight]` in pixels. Columns come from the image |
| `entity.animation` | game code | — | **assign** the clip name; there is no `play()` |
| `entity.frame` | written here | — | the cell index the renderer shows |
| `entity.animationDone` | written here | `false` | true once a non-looping clip reaches its last frame |

- Command: `animation.list` — every type that declares clips, each as `walk: 1,2 @8framesPerSecond`.
- Assignment, not `play()`: setting the same name every frame does nothing, so an update hook can state what the entity *is* doing without tracking what it was doing. Changing the name restarts the clip at time zero.
- A non-looping clip holds its last frame and sets `animationDone`. A looping one wraps with `%`.
- **An unknown clip name does nothing and says nothing** — `entity.frame` keeps its last value. Check the spelling against `animation.list`.
- It runs on the fixed step, so a walk cycle advances the same number of frames in a headless `simulate()` as on screen.
