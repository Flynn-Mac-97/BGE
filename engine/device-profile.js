/**
 * Kernel: the screen shape a game declares.
 *
 * `game.json` names under `device` the screen a game is drawn for, once.
 * Everything that needs a screen shape reads it here: the viewport every camera
 * clamps against, and the size `see.capture` draws at.
 */

/**
 * The screen a game is drawn for, when the game declares none.
 *
 * The camera clamps to level bounds using the viewport size, so without a fixed
 * default the same level would frame differently in a small window than in a
 * large one — and a headless run would disagree with both. Declaring it means a
 * camera position is reproducible, which is the whole promise of `simulate()`.
 */
const DEFAULT_DEVICE = { width: 1280, height: 720, pixelRatio: 1, orientation: 'landscape' }

/**
 * A declared number only when it is finite and positive, else null.
 *
 * @param {number} value The number a game declared.
 * @returns {number|null} The number, or null when it cannot be used.
 */
const positive = value => (Number.isFinite(value) && value > 0 ? value : null)

/**
 * The target device a game declares under `device` in game.json, filled in
 * from the default.
 *
 * One declaration, read by everything that needs a screen shape: the viewport
 * every camera clamps against, and the size `see.capture` draws at. A game that
 * declares a shape nothing reads gets art measured at the wrong shape.
 *
 * @param {object} game The parsed `game.json`, or an empty object.
 * @returns {object} `width`, `height`, `pixelRatio` and `orientation`.
 */
export function readDevice(game) {
  const declared = game?.device || {}
  const width = positive(declared.width) ?? DEFAULT_DEVICE.width
  const height = positive(declared.height) ?? DEFAULT_DEVICE.height
  return {
    width,
    height,
    fit: declared.fit === 'screen' ? 'screen' : 'contain',
    pixelRatio: positive(declared.pixelRatio) ?? DEFAULT_DEVICE.pixelRatio,
    orientation: declared.orientation || (height > width ? 'portrait' : 'landscape')
  }
}
