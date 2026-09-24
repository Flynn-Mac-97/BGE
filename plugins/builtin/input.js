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
 */
const ACTIONS = {
  left:  ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up:    ['ArrowUp', 'KeyW'],
  down:  ['ArrowDown', 'KeyS'],
  jump:  ['Space', 'ArrowUp', 'KeyW'],
  fire:  ['KeyJ', 'KeyZ']
}

/** Whether any action is bound to this physical key. */
const isBound = code => Object.values(ACTIONS).some(codes => codes.includes(code))

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
      codes: action => [...(ACTIONS[action] || [])]
    }
  },

  systems: [{
    // Frame, not fixed: a frame is one look at the world, and a screen that read a
    // key twice within one look would pick twice. Choice Screen clears the keys it
    // has spent on this event.
    phase: 'frame',
    run: (world, seconds, context) => context.bus.emit('step:end')
  }]
}
