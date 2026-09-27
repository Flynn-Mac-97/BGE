import * as turns from './game-maths/turns.js'
import * as vectors from './game-maths/vectors.js'

/**
 * Game Maths: the vector, turn and number maths games share, as one service.
 *
 * A game plugin declares `requires: ['game.maths']` and calls
 * `scope.require('game.maths')` in its `onLoad`. The service is one frozen
 * record of pure functions over plain arrays (`game-maths/vectors.js`,
 * `game-maths/turns.js`), so the same maths runs in the browser and headless.
 * A builtin in this checkout imports those two files directly, as it ships
 * with them.
 */
const GAME_MATHS = Object.freeze({ ...vectors, ...turns })

export default {
  name: 'Game Maths',
  category: 'game',
  lifecycle: 'scoped',
  about: 'Vectors, turns and number helpers for game code.',
  provides: ['game.maths'],
  onLoad(context, scope) {
    scope.provide('game.maths', GAME_MATHS)
  }
}
