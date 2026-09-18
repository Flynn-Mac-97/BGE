---
description: Switches an outline on and off round one thing — the standard feedback for hover, selection, a target, or what a player can act on. Works on a 3D solid and on a flat sprite, at one width in screen pixels. Use when something has to be picked out of a frame without moving or recolouring it.
---

# Outline

- The line is the renderer's keyline: a hull grown by a fixed number of **screen
  pixels**, so it is the same width on a crate two metres away and on a tower
  fifty. This plugin owns **when** it is on.
- **Never saved.** An outline is about the moment, not about the level. Nothing
  here writes to disk, and reloading clears every one.
- Works on both kinds of shape. A solid grows along its own normals, which is
  its silhouette. A flat quad grows away from its centre, because a sprite's
  normals all point at the camera and have no screen direction at all.

## Commands

| command | does |
|---|---|
| `outline.show <id>` | outline one entity, a type's live instances, or a JSON list. No argument outlines the selection |
| `outline.hide [<id>]` | take it off. No argument takes off every one |
| `outline.toggle <id>` | switch it, per entity |
| `outline.list` | what is outlined, and at what width and colour |

```sh
node bin/engine.mjs run outline.show '["chest","door"]'
node bin/engine.mjs run outline.show chest '{"colour":"#54f0d0","width":4}'
node bin/engine.mjs run outline.hide
```

## From a game

`context.outline` carries the same verbs, so a behaviour and a terminal reach
one thing:

```js
context.outline.show(entity.id)            // hover
context.outline.hide(entity.id)            // left
context.outline.toggle('chest')
context.outline.style({ colour: '#54f0d0', width: 4 })   // the game's own look, set once
context.outline.shown()                    // ids, as an array
```

`show` and `toggle` take `{ width, colour }`; anything left out uses the style.
Defaults are 3 pixels and `#ffd34d`.

## Panel

Docked right. **Follow the selection** outlines whatever is picked and drops it
again, which is what the feedback looks like in a game. The slider changes every
outline that is already on.

## What it will not do

- **It does not outline what a level declared.** A `keyline` written on a mesh
  is the level's, and hiding gives that back rather than deleting it.
- **It has no hover of its own.** A game says when, from its own input.
- **An outlined entity leaves its merge batch**, so a field of five hundred
  outlined tufts costs five hundred draw calls. Outline the few things a player
  is looking at.
