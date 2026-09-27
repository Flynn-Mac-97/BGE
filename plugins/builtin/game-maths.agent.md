---
description: Shared maths for 2D and 3D game code - clamp and lerp, 2D points, 3D points, quaternion turns and Euler rotations in the renderer's order - as the game.maths service. Use before writing a dot, cross, clamp, angle, quaternion or rotation helper in a game or plugin.
triggers: maths, math, vector, 2d, 3d, quaternion, rotation, euler, angle, dot product, cross product, clamp, lerp, turn
match: ["plugins/builtin/game-maths.js", "plugins/builtin/game-maths/**"]
category: gameplay
---
# Game Maths

- In a game plugin: declare `requires: ['game.maths']`, then `const maths = scope.require('game.maths')` in `onLoad`.
- A pure file with no `scope` gets `maths` passed in, or reads it from one small file the plugin sets in `onLoad`.
- A builtin imports `plugins/builtin/game-maths/<file>.js` directly.
- Numbers, at the top: `DEGREES`, `clamp`, `lerp` (`numbers.js`).
- `maths.plane`, 2D points `[x, y]`, angles counter-clockwise from +x: `add`, `subtract`, `scaled`, `dot`, `cross` (a number), `lengthOf`, `unit`, `turnedBy(point, angle)`, `angleOf` (`plane.js`).
- `maths.space`, 3D points `[x, y, z]`: `add`, `subtract`, `scaled`, `dot`, `cross`, `lengthOf`, `unit` (`space.js`). Turns, a unit quaternion `[x, y, z, w]`: `multiply`, `inverse`, `rotate(turn, point)`, `turnAbout(axis, angle)`, `fromYawPitchRoll(x, y, z)`, `yawPitchRollOf(turn)`, `turnBetween`, `blendTurns` (`turns.js`). A rotation `[x, y, z]` is radians applied Y, then X, then Z, as the renderer turns a node or attachment.
- Add a helper here at its second real use in any game, not in the game. A new kind of maths is a new file and record, not more names in one.
