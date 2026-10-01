/**
 * Mouse Look — turning your head, and the keys that go with it.
 *
 * `Keyboard Input` already owns what a key means, so this extends that surface
 * rather than replacing it. Two input plugins would mean two answers to
 * held('jump'), and the one that lost would be the one you were reading.
 *
 * Three things live here:
 *
 *   pointer lock    a mouse that stops at the edge of the window cannot turn
 *                   you round, so first-person play captures the pointer and
 *                   stop hands it back
 *   the accumulator context.input.look() — radians turned since the last read
 *   the bindings    the first-person action names every other file will use
 *
 * The accumulator is the whole design. A mouse reports movement whenever it
 * feels like it, two hundred times a second on decent hardware, while the
 * simulation runs at exactly sixty. Adding into an accumulator and draining it
 * once per fixed step means the two never have to agree on a rate.
 *
 * It is also the same accumulator `lookBy` adds to, and that is deliberate: a
 * test that turns the player and a bot that aims at someone both go through the
 * mouse's own path. There is no second input route to disagree with the first,
 * which is the same reason `press` exists on the keyboard plugin.
 */
import { MOUSE_BUTTONS, mouseButtonName } from './input.js'

/**
 * Degrees turned per mouse count. 0.022 is m_yaw, the first-person constant
 * that became the de facto default, and the reason a sensitivity carried over
 * from any shooter feels like the same mouse here. It is used for pitch too.
 */
const DEGREES_PER_COUNT = 0.022
const DEFAULT_SENSITIVITY = 2.5

export const radiansPerCount = sensitivity => sensitivity * DEGREES_PER_COUNT * Math.PI / 180

/**
 * Mouse buttons are named in Keyboard Input, which presses them over the game
 * view; this file presses the same names while the pointer is captured.
 * Re-exported, so a test can press what a real click would press.
 */
export { MOUSE_BUTTONS, mouseButtonName }

/**
 * One notch of the wheel, per `WheelEvent.deltaMode`.
 *
 * `deltaY` is not a unit. Chrome reports about 100 per notch in pixel mode,
 * Firefox about 3 in line mode, and a page-mode wheel reports 1 — so an action
 * bound to the raw number (switching weapons, changing tools) scrolls thirty
 * times faster on one browser than another. Dividing by these turns all three
 * into notches.
 */
const WHEEL_NOTCH = [100, 3, 1]

/** Wheel movement in notches, whichever unit the browser chose to report. */
export const wheelNotches = (deltaY, deltaMode = 0) => {
  const perNotch = WHEEL_NOTCH[deltaMode] ?? WHEEL_NOTCH[0]
  const notches = Number(deltaY) / perNotch
  return Number.isFinite(notches) ? notches : 0
}

/**
 * What one mouse movement means, in radians.
 *
 * Pure, and exported, so the two signs everybody notices are checkable without
 * a mouse. Moving the mouse right is a positive movementX and must turn the
 * view right; yaw is measured about +Y, where positive turns left, so turning
 * right lowers it. movementY is positive downward and must look down, while
 * positive pitch looks up. Both are therefore negated.
 */
export const lookFromMouse = (movementX, movementY, sensitivity) => {
  const radians = radiansPerCount(sensitivity)
  return { yaw: -movementX * radians, pitch: -movementY * radians }
}

/**
 * The first-person action set. These names are the contract with every other
 * file in the game — nothing downstream ever names a key, so rebinding stays a
 * one-line change here.
 *
 * `jump` is the one that already existed. It was Space, ArrowUp and KeyW,
 * because in a platformer up is jump; KeyW is now forward, and a player holding
 * forward would otherwise bunny-hop across the map without touching Space. So
 * KeyW comes off jump and the other two stay, which leaves the demo platformer
 * playing exactly as it did.
 */
const FIRST_PERSON = {
  forward:     ['KeyW'],
  back:        ['KeyS'],
  strafeLeft:  ['KeyA'],
  strafeRight: ['KeyD'],
  jump:        ['Space', 'ArrowUp'],
  crouch:      ['ControlLeft', 'KeyC'],
  walk:        ['ShiftLeft'],
  attack:      ['MouseLeft'],
  attack2:     ['MouseRight'],
  reload:      ['KeyR'],
  use:         ['KeyE'],
  buy:         ['KeyB'],
  drop:        ['KeyG'],
  score:       ['Tab'],
  inspect:     ['KeyF'],
  slot1:       ['Digit1'],
  slot2:       ['Digit2'],
  slot3:       ['Digit3'],
  slot4:       ['Digit4'],
  slot5:       ['Digit5']
}

/**
 * Keys the browser would take for itself while you are playing. Tab moves focus
 * out of the game and Space scrolls the page, and both are bound to something
 * here, so they are swallowed — but only while the pointer is captured, or the
 * editor would lose Tab and Space while you were editing.
 */
const HELD_BY_THE_BROWSER = ['Tab', 'Space']

export default {
  name: 'Mouse Look',
  category: 'engine',
  needs: ['Keyboard Input'],

  onLoad(context) {
    const input = context.input
    if (!input) {
      console.error('[mouse-look] Keyboard Input did not load, so there is nothing to extend — no first-person bindings, no look(), and nothing will move. Check plugins.list for why it failed.')
      return
    }

    for (const [action, codes] of Object.entries(FIRST_PERSON)) input.bind(action, codes)

    // Radians and wheel counts since the last read. Kept in one bag so the DOM
    // half below adds to exactly what look() drains.
    const accumulated = { yaw: 0, pitch: 0, wheel: 0 }

    let sensitivity = DEFAULT_SENSITIVITY
    Object.defineProperty(input, 'sensitivity', {
      enumerable: true,
      get: () => sensitivity,
      // Validated here rather than at each caller, because a sensitivity set to
      // "high" would otherwise turn every mouse movement into NaN radians and
      // the only symptom would be a view that never moves again.
      set(value) {
        const wanted = Number(value)
        // Zero is refused with everything else: it is accepted arithmetic and a
        // dead mouse, which is the worst pair of properties a setting can have.
        if (!Number.isFinite(wanted) || wanted <= 0) {
          console.error(`[mouse-look] sensitivity must be a positive number — "${value}" ignored, still ${sensitivity}`)
          return
        }
        sensitivity = wanted
      }
    })

    // Whether the pointer is captured. A plain flag rather than a question for
    // the document, so a headless world answers it too.
    input.locked = false

    Object.assign(input, {
      /** Radians turned since the last call, and clears them. The camera that owns the mouse reads it once per frame or step. */
      look() {
        const turned = { yaw: accumulated.yaw, pitch: accumulated.pitch }
        accumulated.yaw = 0
        accumulated.pitch = 0
        return turned
      },
      /** Aim by hand. The mouse itself comes in this way, and so does a test. */
      lookBy(yaw = 0, pitch = 0) {
        accumulated.yaw += yaw
        accumulated.pitch += pitch
      },
      /**
       * Wheel notches since the last call, and clears them. Whatever the game
       * binds the wheel to — a weapon cycle, a tool change — wants notches
       * rather than the browser's own `deltaY`, so one flick of the wheel is
       * one step of it on every browser.
       */
      mouseWheel() {
        const turned = accumulated.wheel
        accumulated.wheel = 0
        return turned
      }
    })

    // Whatever was accumulated while nobody was reading is not aim, it is
    // history. Starting or stopping play with a stale half-turn in the bag
    // would whip the view round on the first step.
    const forget = () => { accumulated.yaw = 0; accumulated.pitch = 0; accumulated.wheel = 0 }
    context.bus.on('play:started', forget)
    context.bus.on('play:stopped', forget)

    // The mouse needs the canvas, and the canvas belongs to the shell. A world
    // with no screen simply stops here with everything above it working.
    context.bus.on('shell:ready', () => attach(context, accumulated))
  },

  commands: [{
    id: 'mouse.sensitivity',
    label: 'Mouse sensitivity',
    // args: nothing to read it, a number to set it
    run(context, value) {
      const input = context.input
      if (!input) throw new Error('Keyboard Input is not loaded, so there is no sensitivity to read')

      if (value !== undefined && value !== null) {
        input.sensitivity = value
        // The setter refuses what it cannot use and says so on the console;
        // this turns that refusal into an exit code for whoever typed it.
        if (input.sensitivity !== Number(value)) {
          throw new Error(`sensitivity must be a positive number, not "${value}" — still ${input.sensitivity}`)
        }
      }

      return {
        sensitivity: input.sensitivity,
        // Rounded because binary floating point turns 2.5 * 0.022 into
        // 0.05499999999999999, and a terminal reading that learns nothing.
        degreesPerCount: Math.round(input.sensitivity * DEGREES_PER_COUNT * 1e6) / 1e6,
        radiansPerCount: radiansPerCount(input.sensitivity),
        locked: input.locked === true
      }
    }
  }]
}

/**
 * The half that needs a document: capture the pointer, and turn what the mouse
 * does into the same calls a test makes.
 */
function attach(context, accumulated) {
  const input = context.input
  const canvas = context.shell?.canvas

  if (typeof document === 'undefined' || !canvas) {
    console.error('[mouse-look] the shell is ready but there is no canvas to capture the pointer on, so the mouse cannot turn the view. look() and lookBy() still work; a bot or a test can still aim.')
    return
  }

  /**
   * Browsers refuse a lock for reasons that are invisible from here — a
   * sandboxed iframe, a click the browser did not count as a gesture, a lock
   * released moments ago. Say which, and say what to do, because the symptom is
   * a game that ignores the mouse and reports nothing.
   */
  const refused = reason => console.error(
    `[mouse-look] the browser refused to capture the pointer (${reason?.message || reason || 'no reason given'}). ` +
    'Click the viewport again — a lock is only granted from a real click, and never inside a cross-origin iframe or within a moment of the last one being released. Until it is granted the mouse cannot turn the view or fire.')

  /**
   * Ask for the pointer. Nothing here releases it on Escape, because the
   * browser does that itself and will not let a page refuse — the release is
   * handled where it lands, in pointerlockchange below.
   */
  const capture = () => {
    // Never while editing: an editor that swallows your pointer the moment you
    // click a thing is unusable, and there is nothing to look at yet anyway.
    // Asked of the loop rather than mirrored from play:started into a flag here,
    // because a copy of "are we playing" is a copy that can be wrong.
    if (!context.loop.running) return
    // Only a first-person view turns with the mouse. A chase camera never reads
    // look(), and a captured pointer there only hides the cursor the game may
    // want to point with.
    if (context.view?.mode !== 'first-person') return
    if (document.pointerLockElement === canvas) return
    try {
      const request = canvas.requestPointerLock()
      // Newer browsers answer with a promise; older ones fire pointerlockerror.
      if (request?.catch) request.catch(refused)
    } catch (error) {
      refused(error)
    }
  }

  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas
    if (!input.locked) {
      // Escape takes the pointer back without the mouse ever coming up, so a
      // button held at that moment would stay held — and the visible symptom is
      // an action that keeps firing at nothing. Every button, not the two that
      // happened to be bound when this was written: a right button left down
      // holds the scope open forever, and nothing would say why.
      for (const name of MOUSE_BUTTONS) input.release(name)
    }
  })
  document.addEventListener('pointerlockerror', () => refused('pointerlockerror'))

  context.bus.on('play:stopped', () => {
    if (document.pointerLockElement) document.exitPointerLock()
  })

  /**
   * A click while playing is a shot, and nothing else.
   *
   * The editor's transform tool listens for `pointerdown` on the viewport, which
   * is this canvas's parent, so without this a shot also grabs and drags
   * whatever entity was under the crosshair. Taken in the capture phase, before
   * the viewport or the overlay above it see anything, and only while the world
   * is running — editing is untouched.
   *
   * `stopPropagation` and not `preventDefault`: cancelling a pointerdown would
   * also cancel the `mousedown` the browser fires after it, which is the event
   * the game is listening for.
   */
  const viewport = context.shell?.viewport
  if (viewport) {
    viewport.addEventListener('pointerdown', event => {
      if (event.composedPath?.().some(element => element.dataset?.gameUi)) return
      if (context.loop.running) event.stopPropagation()
    }, { capture: true })
  } else {
    console.error('[mouse-look] the shell has no viewport, so a click while playing will also reach the editor\'s transform tool and drag whatever is under the crosshair.')
  }

  canvas.addEventListener('mousedown', event => {
    // The click that takes the pointer must not also fire the action. In every
    // shooter the first click means "give me the mouse", and only the ones
    // after it are shots.
    if (!input.locked) { capture(); return }
    // A mouse button is a key like any other, so held('attack') works with no
    // idea a mouse was involved — through the name table, because the DOM's own
    // index puts the middle button where the right button belongs.
    input.press(mouseButtonName(event.button))
  })

  // On the window rather than the canvas, so a button released anywhere still
  // comes up. A stuck mouse button is indistinguishable from a stuck trigger.
  addEventListener('mouseup', event => input.release(mouseButtonName(event.button)))

  addEventListener('mousemove', event => {
    if (!input.locked) return
    // Through lookBy, exactly as a test aims, and through lookFromMouse, where
    // the signs are stated and tested. An inverted look is the first thing
    // anyone notices, and a comment alone would not have caught it.
    const turned = lookFromMouse(event.movementX, event.movementY, input.sensitivity)
    input.lookBy(turned.yaw, turned.pitch)
  })

  // Only while captured: the editor's own wheel gestures are none of our
  // business, and an action that switched while you were zooming the viewport
  // would be a mystery.
  canvas.addEventListener('wheel', event => {
    if (!input.locked) return
    event.preventDefault()
    // Notches, not deltaY. See wheelNotches: the raw number is about 100 per
    // notch in Chrome, 3 on Firefox's line mode and 1 in page mode, so an
    // action written against the raw number works on exactly one browser.
    accumulated.wheel += wheelNotches(event.deltaY, event.deltaMode)
  }, { passive: false })

  // Right-click aims down the sights; it must not open a menu over the game.
  canvas.addEventListener('contextmenu', event => event.preventDefault())

  addEventListener('keydown', event => {
    if (input.locked && HELD_BY_THE_BROWSER.includes(event.code)) event.preventDefault()
  })
}
