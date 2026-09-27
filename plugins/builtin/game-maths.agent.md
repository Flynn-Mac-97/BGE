---
description: Shared maths for game code - points, quaternion turns, Euler rotations in the renderer's order, clamp and lerp - as the game.maths service. Use before writing a dot, cross, clamp, quaternion or rotation helper in a game or plugin.
triggers: maths, math, vector, quaternion, rotation, euler, dot product, cross product, clamp, lerp, turn
match: ["plugins/builtin/game-maths.js", "plugins/builtin/game-maths/**"]
category: gameplay
---
# Game Maths

- In a game plugin: declare `requires: ['game.maths']`, then `const maths = scope.require('game.maths')` in `onLoad`.
- A pure file with no `scope` gets `maths` passed in, or reads it from one small file the plugin sets in `onLoad`.
- A builtin imports `plugins/builtin/game-maths/vectors.js` and `turns.js` directly.
- Plain arrays: a point is `[x, y, z]`, a turn is a unit quaternion `[x, y, z, w]`, a rotation is `[x, y, z]` radians applied Y, then X, then Z, as the renderer turns a node or attachment.
- Numbers: `DEGREES`, `clamp`, `lerp`. Points: `add`, `subtract`, `scaled`, `dot`, `cross`, `lengthOf`, `unit`.
- Turns: `multiply`, `inverse`, `rotate(turn, point)`, `turnAbout(axis, angle)`, `fromYawPitchRoll(x, y, z)`, `yawPitchRollOf(turn)`, `turnBetween(from, onto)`, `blendTurns(from, onto, amount)`.
- Add a helper here at its second real use in any game, not in the game.
