# World-space anchors

`gameUi.anchor(id, options)`:

| option | meaning |
|---|---|
| `to` | an entity id, an entity, `[x, y, z]`, or a function returning one (null hides it) |
| `offset` | world units added to the point, e.g. `[0, 2, 0]` for above a head |
| `pivot` | the part of the box on the point; `[0.5, 1]` is bottom centre |
| `html` | a string, or `entity => string` when `to` names an entity |
| `maxDistance` | culled beyond this many world units from the view |
| `scaleByDistance` | `d`: scaled by `d / distance`, kept between 0.4 and 1.6 |
| `on`, `every`, `isInteractive` | as for a panel |

- An entity id that stops existing removes its anchor. A function target never does.
- Position is `renderer.toScreen`, so it works in the flat and the 3D view. There is no anchor with no renderer, but `read`, `controls` and `click` still work.

## Cost

- All anchors share one shadow root and one adopted stylesheet.
- Each frame projects every anchor first, then touches the DOM only for the ones drawn. An anchor behind the camera, off screen or past `maxDistance` gets no `html` call and no DOM work.
- `gameUi.world.limit` (default 48) is the most drawn at once; the nearest to the view win.
- A move is one `transform` write, only when the rounded pixel changed. No layout.
- Give a busy label `every: 4` so its `html` is asked less often.
- The view is the one the frame's camera set; a camera that moves after this system draws one frame late.

## Floating text

`gameUi.float(text, { at, life, offset, tone, class })` shows a damage number or a pickup at a point, then removes it.

- `at` is an entity id, an entity or `[x, y, z]`, read once: the text stays where the hit happened. Answers the id, or `''` when `at` names nothing.
- It rises and fades over `life` seconds (default 1) of game time, using the `ui-rise` keyframes. `tone` is `danger`, `good` or `accent`.
- Restyle it in `theme.css` on `.ui-floating`, or add a `class` (a critical: `.ui-floating.crit { font-size: 1.6em }`).
- At most 200 live at once; the oldest go first. Text is escaped. Pass `html` for markup.
