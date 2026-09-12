---
name: glass-editor-markers
description: Hides marker entities — spawn points, patrol nodes, camera hints — while a run plays, and shows them again when it stops. Use when an editing aid is visible during play, when a marker never comes back after stopping, or when adding a type that should only be seen while building.
---
<!-- generated from plugins/builtin/editor-markers.agent.md at server start; edits are lost -->

# Editor Markers

- A spawn point, a patrol node, a trigger volume or a camera hint is a real
  entity the level contains. It must be visible and draggable while building
  and invisible while playing. This plugin owns that switch.
- A type declares it once and says nothing else:

```js
// types/spawn-point.js
marker: true,
```

- On `play:started` every marker is hidden. On `play:stopped` the ones this
  plugin hid are shown again.
- Only `entity.hidden` changes. **The collider stays**, so a trigger volume
  still reports the player standing in it while invisible.
- It remembers which entities it hid. A level that hid something for its own
  reasons stays hidden after play stops.
- A marker spawned during a run — a round manager placing a spawn point —
  arrives already hidden, so it never appears in front of a player.

## Commands

- `markers.list` — every marker id, and how many are hidden right now.
- `markers.reveal` — show markers during play. Takes `true` or `false`,
  defaults to `true`. It is the one thing worth having while debugging a spawn.

## Where it does not reach

- It decides nothing about drawing beyond `hidden`. Shape, colour and material
  come from the type.
- A type without `marker: true` is never touched, whatever it is called.
