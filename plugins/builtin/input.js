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

  onLoad(context) {
    const down = new Set()
    const justPressed = new Set()

    const editing = element => ['INPUT', 'TEXTAREA'].includes(element?.tagName)

    addEventListener('keydown', event => {
      if (editing(event.target)) return
      if (!down.has(event.code)) justPressed.add(event.code)
      down.add(event.code)
    })
    addEventListener('keyup', event => down.delete(event.code))
    addEventListener('blur', () => down.clear())

    const held = action => (ACTIONS[action] || []).some(c => down.has(c))

    context.input = {
      held,
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
