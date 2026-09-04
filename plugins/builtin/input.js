/**
 * Named input actions, contributed onto context by a plugin — proof that context itself
 * is extensible rather than a fixed kernel struct.
 *
 * Game code says context.input.axis('x') and context.input.pressed('jump'), never a
 * keycode, so rebinding is a config change rather than a code change.
 */
const ACTIONS = {
  left:  ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up:    ['ArrowUp', 'KeyW'],
  down:  ['ArrowDown', 'KeyS'],
  jump:  ['Space', 'ArrowUp', 'KeyW'],
  fire:  ['KeyJ', 'KeyZ']
}

export default {
  name: 'Keyboard Input',

  category: 'engine',
  onLoad(context) {
    const down = new Set()
    const justPressed = new Set()

    const editing = element => ['INPUT', 'TEXTAREA'].includes(element?.tagName)

    /**
     * Holding and releasing a key, with no event in sight.
     *
     * The keyboard is one way to reach these, not the only way. A test presses a
     * key here directly, so the same code runs whether there is a window to
     * type into or not — and a headless run is not a second, weaker input path.
     */
    const press = code => {
      if (!down.has(code)) justPressed.add(code)
      down.add(code)
    }
    const release = code => down.delete(code)

    if (typeof addEventListener === 'function') {
      addEventListener('keydown', event => {
        if (editing(event.target)) return
        press(event.code)
      })
      addEventListener('keyup', event => release(event.code))
      addEventListener('blur', () => down.clear())
    }

    const held = action => (ACTIONS[action] || []).some(c => down.has(c))

    context.input = {
      held,
      press,
      release,
      pressed: action => (ACTIONS[action] || []).some(c => justPressed.has(c)),
      axis: which => which === 'y'
        ? (held('up') ? 1 : 0) - (held('down') ? 1 : 0)
        : (held('right') ? 1 : 0) - (held('left') ? 1 : 0),
      bind: (action, codes) => { ACTIONS[action] = [].concat(codes) },
      actions: () => Object.keys(ACTIONS),
      // Which physical keys an action means. A test presses a real key rather
      // than faking the action, so rebinding is covered by the same test.
      codes: action => [...(ACTIONS[action] || [])]
    }

    // `pressed` must mean "this step only", so clear after every fixed step
    context.bus.on('step:end', () => justPressed.clear())
  },

  systems: [{ phase: 'frame', run: (world, seconds, context) => context.bus.emit('step:end') }]
}
