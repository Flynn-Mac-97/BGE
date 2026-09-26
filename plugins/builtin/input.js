/**
 * Named input actions, contributed onto context by a plugin — proof that context itself
 * is extensible rather than a fixed kernel struct.
 *
 * Game code says context.input.axis('x') and context.input.pressed('jump'), never a
 * keycode, so rebinding is a config change rather than a code change.
 *
 * The keys themselves are the loop's. It records every press against the step it
 * arrived at, so a run can be played again from its own record and `pressed` means
 * one step in both halves. This plugin is the keyboard and the naming — the
 * browser events, the action table — and holds no state of its own.
 *
 * The mouse over the game view is the same: its buttons are key codes,
 * `MouseLeft`, `MouseMiddle` and `MouseRight`, so an action binds a button
 * like a key. `pointer()` is where it is, in viewport pixels — the
 * pixels `renderer.pick` and `renderer.pickNode` take.
 */
const ACTIONS = {
  left:  ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up:    ['ArrowUp', 'KeyW'],
  down:  ['ArrowDown', 'KeyS'],
  jump:  ['Space', 'ArrowUp', 'KeyW'],
  fire:  ['KeyJ', 'KeyZ']
}

/**
 * What each mouse button is called, indexed by `MouseEvent.button`.
 *
 * The DOM numbers them 0 = left, **1 = middle**, **2 = right**, which is not the
 * order anybody says them in. Naming them `Mouse0`, `Mouse1`, `Mouse2` from that
 * index is the bug this table exists to make impossible: a secondary action
 * bound to `Mouse1` would fire on the middle button while the right button did
 * nothing — off by one and silent about it.
 *
 * So the buttons are named for what they are. A code that says `MouseRight`
 * cannot be off by one, and `mouseButtonName` below is the single place a raw
 * DOM index is ever translated.
 */
export const MOUSE_BUTTONS = ['MouseLeft', 'MouseMiddle', 'MouseRight', 'MouseBack', 'MouseForward']

/**
 * The name of one DOM button index. Exported so a test can press what a real
 * click would press, rather than the code string it hopes a click produces.
 *
 * An index past the table is still given a name rather than dropped — a mouse
 * with nine buttons is a real thing, and a button nobody has bound is harmless.
 */
export const mouseButtonName = index => MOUSE_BUTTONS[index] ?? `MouseButton${index}`

/**
 * Follow the pointer over the game view, and press its buttons as key codes.
 * The release is watched on the window, so a drag let go outside the view
 * still ends.
 */
function watchPointer(viewport, keys, pointer) {
  if (!viewport?.addEventListener) return
  const place = event => {
    const rect = viewport.getBoundingClientRect()
    Object.assign(pointer, { x: event.clientX - rect.left, y: event.clientY - rect.top, isOver: true })
  }
  viewport.addEventListener('pointermove', place)
  viewport.addEventListener('pointerleave', () => { pointer.isOver = false })
  // In the capture phase: Mouse Look stops a click there while playing, so the
  // editor under it does not see a shot, and a bubbling listener would miss it.
  viewport.addEventListener('pointerdown', event => { place(event); keys.press(mouseButtonName(event.button)) }, { capture: true })
  addEventListener('pointerup', event => keys.release(mouseButtonName(event.button)))
}

/** Whether any action is bound to this physical key. */
const isBound = code => Object.values(ACTIONS).some(codes => codes.includes(code))

/** The one argument `input.press` and `input.release` take. */
const ACTION_ARGUMENT = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: { action: { type: 'string', description: 'an action name, as input.actions lists it' } }
}

/** The first key an action is bound to, or an error that lists every action. */
function firstCode(context, action) {
  const [code] = context.input.codes(action)
  if (!code) throw new Error(`no action "${action}" — try ${context.input.actions().join(', ')}`)
  return code
}

export default {
  name: 'Keyboard Input',

  category: 'engine',
  onLoad(context) {
    const keys = context.loop.input

    const editing = element => ['INPUT', 'TEXTAREA'].includes(element?.tagName)

    if (typeof addEventListener === 'function') {
      addEventListener('keydown', event => {
        if (editing(event.target)) return
        // While a run plays, a key the game has bound is the game's alone: Tab
        // must not also move focus onto an editor button, where the next Space
        // would press it.
        if (context.loop.running && isBound(event.code)) event.preventDefault()
        keys.press(event.code)
      })
      addEventListener('keyup', event => keys.release(event.code))
      // A page that loses the window never gets the keyup, so everything held is
      // let go of here. It is recorded like any other release, because it really
      // is part of what the run was played with.
      addEventListener('blur', () => keys.releaseAll())
    }

    const held = action => (ACTIONS[action] || []).some(code => keys.isDown(code))

    // Where the pointer is over the game view. A place, not an event, so it is
    // not recorded for replay; a run that needs it replayed binds a button.
    const pointer = { x: 0, y: 0, isOver: false }
    context.bus.on('shell:ready', () => watchPointer(context.shell?.viewport, keys, pointer))

    context.input = {
      held,
      /**
       * Holding and releasing a key, with no event in sight.
       *
       * The keyboard is one way to reach these, not the only way. A test presses a
       * key here directly, so the same code runs whether there is a window to type
       * into or not — and a headless run is not a second, weaker input path.
       */
      press: code => keys.press(code),
      release: code => keys.release(code),
      pressed: action => (ACTIONS[action] || []).some(code => keys.pressed(code)),
      axis: which => which === 'y'
        ? (held('up') ? 1 : 0) - (held('down') ? 1 : 0)
        : (held('right') ? 1 : 0) - (held('left') ? 1 : 0),
      bind: (action, codes) => { ACTIONS[action] = [].concat(codes) },
      actions: () => Object.keys(ACTIONS),
      // Which physical keys an action means. A test presses a real key rather
      // than faking the action, so rebinding is covered by the same test.
      codes: action => [...(ACTIONS[action] || [])],
      /** The pointer over the game view, in viewport pixels: `{ x, y, isOver }`. */
      pointer: () => ({ ...pointer }),
      /** Put the pointer somewhere by hand, as a test does. */
      pointAt: (x, y) => Object.assign(pointer, { x, y, isOver: true })
    }
  },

  // A terminal holds an action down in a live tab as a test does, so a held
  // moment (a bow at full draw) can be looked at. Held until released.
  commands: [
    {
      id: 'input.press',
      label: 'Hold an action down',
      inputSchema: ACTION_ARGUMENT,
      run: (context, options) => {
        context.input.press(firstCode(context, options.action))
        return { held: options.action }
      }
    },
    {
      id: 'input.release',
      label: 'Let an action go',
      inputSchema: ACTION_ARGUMENT,
      run: (context, options) => {
        context.input.release(firstCode(context, options.action))
        return { released: options.action }
      }
    }
  ],

  systems: [{
    // Frame, not fixed: a frame is one look at the world, and a screen that read a
    // key twice within one look would pick twice. Choice Screen clears the keys it
    // has spent on this event.
    phase: 'frame',
    run: (world, seconds, context) => context.bus.emit('step:end')
  }]
}
