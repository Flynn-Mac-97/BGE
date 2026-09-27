import * as numbers from './game-maths/numbers.js'
import * as plane from './game-maths/plane.js'
import * as space from './game-maths/space.js'
import * as turns from './game-maths/turns.js'

/**
 * Game Maths: the number, 2D and 3D maths games share, as one service.
 *
 * A game plugin declares `requires: ['game.maths']` and calls
 * `scope.require('game.maths')` in its `onLoad`. The service is one frozen
 * record of pure functions over plain arrays:
 *   numbers at the top    `maths.clamp`, `maths.lerp`, `maths.DEGREES`
 *   `maths.plane`         2D points `[x, y]` (game-maths/plane.js)
 *   `maths.space`         3D points `[x, y, z]` and turns (space.js, turns.js)
 * 2D and 3D share names such as `dot`, so each has its own record. The same
 * maths runs in the browser and headless. A builtin in this checkout imports
 * the files directly, as it ships with them.
 */
const GAME_MATHS = Object.freeze({
  ...numbers,
  plane: Object.freeze({ ...plane }),
  space: Object.freeze({ ...space, ...turns })
})

export default {
  name: 'Game Maths',
  category: 'game',
  lifecycle: 'scoped',
  about: 'Numbers, 2D points, 3D points and turns for game code.',
  provides: ['game.maths'],
  onLoad(context, scope) {
    scope.provide('game.maths', GAME_MATHS)
  }
}
