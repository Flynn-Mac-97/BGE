---
description: Draw a full game screen — a title card, pause menu, level-up choice, game-over card. Use for anything the player reads that is not the HUD and not an editor panel. Use HUD for values that sit over live play, and Choice Screen for a row of cards to pick from.
---
# Screen

- Draws **game** screens — a title card, a pause menu, a level-up choice, a
  result card. `ui.*` builds editor panels and cannot do any of this.
- `context.screen.show(id, () => items)` puts one up; `hide(id)` takes it down.
  `draw` runs every frame, so a screen shows live values with nothing pushed at it.
- Items are plain data: `{ dim }` `{ panel, at, size }` `{ text, at, size, anchor }`
  `{ bar: 0..1, at, size }`. **Screen Card** adds `{ card }`.
- `screen.painter(kind, { draw, describe })` adds an item kind. Add a painter;
  never add an escape hatch. `describe` is what `read` says, so a new kind is
  legible headless the day it is added.
- Coordinates are in a design box — `screen.design`, 1280x720 — scaled to fit
  the viewport, never stretched. The box then **grows** to the viewport's shape
  instead of letterboxing, so read `screen.box` when you need the live width: a
  bar anchored across the top is on both edges in every window.
- `at` positions a box's own corner from the corner `anchor` names:
  `anchor: 'top-right', at: [-24, 24]` is 24 in from the top right. Anchors are
  `top|center|bottom` crossed with `left|center|right`.
- `screen.read` / `node bin/engine.mjs run screen.read` answers with what the
  screen says, in words. That is how a headless run checks a screen came up.
- Needs no document. With no canvas every item is still built and still readable.
- Screens are cleared on `level:loaded` and `play:stopped`. It refuses nothing else.
- `screen.list` — every screen registered, and which one is showing.
