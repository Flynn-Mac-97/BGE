/**
 * The plugin is imported for its live input surface, not for a copy of it.
 *
 * A test is handed a `test` object and no context, and `context.input` is where
 * looking and the mouse buttons live. Rebuilding an accumulator here would let
 * this test pass while the one the game reads was broken, so it reaches the
 * real one — the same object `player.js` and the camera see.
 */
import { mouseLook, radiansPerCount, lookFromMouse, mouseButtonName, wheelNotches } from '../../plugins/builtin/mouse-look.js'

export default {
  name: 'looking, and the mouse buttons, arrive through the one input path',
  level: 'level1',

  run(test) {
    const input = mouseLook.input
    if (!test.ok(input, 'Mouse Look loaded and published the input surface it extends')) return

    // ------------------------------------------------------------ accumulating
    input.look()                                  // drain anything left by boot
    input.lookBy(0.5, 0.25)
    input.lookBy(0.25, -0.5)

    const turned = input.look()
    test.near(turned.yaw, 0.75, 1e-9, 'two turns of the yaw add up')
    test.near(turned.pitch, -0.25, 1e-9, 'and so do two of the pitch')

    const again = input.look()
    test.is(again.yaw, 0, 'reading the accumulator cleared the yaw')
    test.is(again.pitch, 0, 'and the pitch — a step never reads the same turn twice')

    input.lookBy(0.1, 0)
    test.near(input.look().yaw, 0.1, 1e-9, 'and it accumulates again from zero')

    // ------------------------------------------------------------------- signs
    // Mouse right must turn the view right, which lowers a yaw measured about
    // +Y; mouse down must look down, which lowers pitch.
    const right = lookFromMouse(10, 0, input.sensitivity)
    const down = lookFromMouse(0, 10, input.sensitivity)
    test.ok(right.yaw < 0, 'moving the mouse right turns right, so yaw goes down')
    test.ok(down.pitch < 0, 'moving the mouse down looks down, so pitch goes down')

    // The game's own maths: sensitivity times m_yaw, in radians.
    test.is(input.sensitivity, 2.5, 'the default sensitivity is the one the game ships with')
    test.near(radiansPerCount(2.5), 2.5 * 0.022 * Math.PI / 180, 1e-12, 'radians per count is sensitivity * m_yaw')

    // -------------------------------------------------------- mouse as buttons
    /**
     * Pressed through `mouseButtonName(event.button)` — the DOM index a real
     * click carries — and never through the code string the binding table
     * happens to use.
     *
     * This test used to press `'Mouse1'` and assert `held('attack2')`, which
     * only re-tested `bind`: it passed the whole time right-click was pressing a
     * name nothing was listening for, because the DOM numbers the middle button
     * 1 and the right button 2. Going through the mapping is the only way the
     * test can fail for the reason it exists.
     */
    const LEFT = 0, MIDDLE = 1, RIGHT = 2

    test.ok(!input.held('attack'), 'nothing is being fired to begin with')
    input.press(mouseButtonName(LEFT))
    test.ok(input.held('attack'), 'the button the DOM calls 0 — the left one — is attack')
    input.release(mouseButtonName(LEFT))
    test.ok(!input.held('attack'), 'and releasing it stops')

    input.press(mouseButtonName(RIGHT))
    test.ok(input.held('attack2'), 'the button the DOM calls 2 — the right one — is attack2, the scope and the silencer')
    test.ok(!input.held('attack'), 'and right-clicking is not also a primary attack')
    input.release(mouseButtonName(RIGHT))
    test.ok(!input.held('attack2'), 'releasing the right button lets the scope go')

    // The middle button is the one the old mapping put attack2 on. It must be
    // bound to neither, or scrolling-with-a-click fires the secondary attack.
    input.press(mouseButtonName(MIDDLE))
    test.ok(!input.held('attack2'), 'the middle button is not attack2')
    test.ok(!input.held('attack'), 'nor attack')
    input.release(mouseButtonName(MIDDLE))

    test.is(input.codes('attack'), [mouseButtonName(LEFT)], 'attack is bound to the name a left click produces')
    test.is(input.codes('attack2'), [mouseButtonName(RIGHT)], 'attack2 is bound to the name a right click produces')

    // -------------------------------------------------------------- the wheel
    // One notch, whichever unit the browser reports it in: about 100 in Chrome's
    // pixel mode, about 3 on Firefox's lines, 1 for a page.
    test.near(wheelNotches(100, 0), 1, 1e-9, 'a Chrome notch is one notch')
    test.near(wheelNotches(3, 1), 1, 1e-9, 'a Firefox line-mode notch is the same one notch')
    test.near(wheelNotches(1, 2), 1, 1e-9, 'and so is a page-mode notch')
    test.near(wheelNotches(-100, 0), -1, 1e-9, 'scrolling the other way is negative')
    test.is(wheelNotches(undefined, 0), 0, 'a wheel event with no delta is no movement, not NaN')

    // ------------------------------------------------------- sensitivity zero
    // A sensitivity of zero is arithmetic that works and a mouse that is dead,
    // so it is refused like any other bad value.
    const had = input.sensitivity
    input.sensitivity = 0
    test.is(input.sensitivity, had, 'a sensitivity of 0 is refused — it would silently kill the mouse')
    input.sensitivity = -1
    test.is(input.sensitivity, had, 'and so is a negative one')
    input.sensitivity = 'fast'
    test.is(input.sensitivity, had, 'and a word')

    // ------------------------------------------------------- the first-person set
    test.is(input.codes('forward'), ['KeyW'], 'forward is W')
    test.is(input.codes('back'), ['KeyS'], 'back is S')
    test.is(input.codes('strafeLeft'), ['KeyA'], 'strafing left is A')
    test.is(input.codes('strafeRight'), ['KeyD'], 'strafing right is D')
    test.is(input.codes('crouch'), ['ControlLeft', 'KeyC'], 'crouch answers to either key')
    test.is(input.codes('slot1'), ['Digit1'], 'the weapon slots are the number row')
    for (const action of ['walk', 'reload', 'use', 'buy', 'drop', 'score', 'inspect', 'slot5']) {
      test.ok(input.codes(action).length > 0, `${action} is bound to something`)
    }

    // ------------------------------------------------- the platformer, undisturbed
    test.is(input.codes('left'), ['ArrowLeft', 'KeyA'], 'left is still what it was')
    test.is(input.codes('right'), ['ArrowRight', 'KeyD'], 'and so is right')
    test.is(input.codes('up'), ['ArrowUp', 'KeyW'], 'and up')
    test.is(input.codes('down'), ['ArrowDown', 'KeyS'], 'and down')
    test.is(input.codes('fire'), ['KeyJ', 'KeyZ'], 'and fire')
    // KeyW left jump when it became forward — holding forward must not launch
    // you — but Space, which is what the demo and the jump test press, stayed.
    test.is(input.codes('jump'), ['Space', 'ArrowUp'], 'jump is still Space, and no longer W')

    // The runner presses a real key rather than faking an action, so this
    // throws outright if a platformer binding stopped resolving — the table
    // above says what the bindings are, and this says they still work.
    test.tap('right')
    const [rightKey] = input.codes('right')
    input.press(rightKey)
    test.ok(input.held('right'), 'a real key still reaches the action it is bound to')
    input.release(rightKey)
  }
}
