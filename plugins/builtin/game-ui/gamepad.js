/**
 * Game UI gamepad: a pad's buttons and left stick as key codes.
 *
 * Each frame the pads are read and every change becomes `input.press` or
 * `input.release` of a code such as `GamepadA` or `GamepadUp`. Those go through
 * the same input the keyboard does, so a run records them and replays them, and
 * a game binds them like any key: `input.bind('jump', ['Space', 'GamepadA'])`.
 * The menu actions are bound to them by default (menu.js). Browser only.
 */

/** Standard-mapping button index -> code. A button not listed is ignored. */
const BUTTON_CODES = {
  0: 'GamepadA', 1: 'GamepadB', 2: 'GamepadX', 3: 'GamepadY', 4: 'GamepadLB', 5: 'GamepadRB',
  8: 'GamepadBack', 9: 'GamepadStart', 12: 'GamepadUp', 13: 'GamepadDown', 14: 'GamepadLeft', 15: 'GamepadRight'
}

/** How far the left stick leans before it counts as a direction. */
const STICK_THRESHOLD = 0.5

/** A held direction repeats, like a held key in a menu: after `delay` seconds, then every `every`. */
const REPEAT = { delay: 0.4, every: 0.1 }
const REPEATING = new Set(['GamepadUp', 'GamepadDown', 'GamepadLeft', 'GamepadRight'])

/** The codes held on any of the pads, as a Set. */
export function heldPadCodes(pads) {
  const held = new Set()
  for (const pad of pads) {
    if (!pad) continue
    pad.buttons.forEach((button, index) => { if (button.pressed && BUTTON_CODES[index]) held.add(BUTTON_CODES[index]) })
    const [x = 0, y = 0] = pad.axes
    if (x < -STICK_THRESHOLD) held.add('GamepadLeft')
    if (x > STICK_THRESHOLD) held.add('GamepadRight')
    if (y < -STICK_THRESHOLD) held.add('GamepadUp')
    if (y > STICK_THRESHOLD) held.add('GamepadDown')
  }
  return held
}

/** Press what became held, release what was let go, and repeat a held direction. `seconds` is the frame's length. */
export function pollGamepad(context, state, pads, seconds) {
  const held = heldPadCodes(pads)
  for (const [code] of state.padHeld) {
    if (held.has(code)) continue
    context.input.release(code)
    state.padHeld.delete(code)
  }
  for (const code of held) {
    const entry = state.padHeld.get(code)
    if (!entry) {
      context.input.press(code)
      state.padHeld.set(code, { seconds: 0, repeatAt: REPEAT.delay })
      continue
    }
    entry.seconds += seconds
    if (!REPEATING.has(code) || entry.seconds < entry.repeatAt) continue
    context.input.release(code)
    context.input.press(code)
    entry.repeatAt += REPEAT.every
  }
}
