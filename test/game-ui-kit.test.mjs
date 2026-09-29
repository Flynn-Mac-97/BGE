/**
 * Game UI kit: components that read back as controls, events that run on the
 * fixed step, keyboard focus, and one theme for Game UI, Screen and the HUD.
 * All headless: nothing here needs a document.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeBus } from '../engine/bus.js'
import gameUi from '../plugins/builtin/game-ui.js'
import { kit } from '../plugins/builtin/game-ui/components.js'
import { advancePhase, isDue, startLeaving } from '../plugins/builtin/game-ui/records.js'
import { revealedChars } from '../plugins/builtin/game-ui/typewriter.js'
import { sheetText, tokensOf } from '../plugins/builtin/game-ui/theme.js'

const fixedSystem = gameUi.systems.find(system => system.phase === 'fixed')

/** A context with a scripted keyboard: `press('uiDown')` is down for the next fixed step only. */
function loaded(files = {}) {
  const pressedNow = new Set()
  const bound = {}
  const context = {
    bus: makeBus(),
    input: { pressed: action => pressedNow.has(action), actions: () => Object.keys(bound), bind: (action, codes) => { bound[action] = codes } },
    screen: { palette: {} },
    hud: { palette: {} },
    files: { read: async path => { if (!(path in files)) throw new Error('missing'); return files[path] } }
  }
  gameUi.onLoad(context)
  const step = (...actions) => {
    actions.forEach(action => pressedNow.add(action))
    fixedSystem.run(null, 1 / 60, context)
    pressedNow.clear()
  }
  return { context, step, bound }
}

const shop = ({ gold = 5, volume = 0.5, mode = 'a' } = {}) => kit.stack([
  kit.button('Buy <sword>', { action: 'buy', kind: 'primary' }),
  kit.button('Locked', { action: 'locked', isDisabled: true }),
  kit.toggle('Music', { action: 'music', isOn: false }),
  kit.slider('Volume', { action: 'volume', value: volume, min: 0, max: 1, step: 0.25 }),
  kit.select('Mode', { action: 'mode', value: mode, options: ['a', 'b', 'c'] }),
  kit.text(`Gold ${gold}`)
])

test('a component escapes its text and reads back as a control', () => {
  const { context } = loaded()
  context.gameUi.show('shop', { html: shop() })
  assert.equal(context.gameUi.read('shop'), 'Buy <sword> Locked Music Volume 0.5 Mode a b c Gold 5')
  const controls = context.gameUi.controls('shop')
  assert.deepEqual(controls.map(control => [control.kind, control.action, control.isDisabled]), [
    ['button', 'buy', false], ['button', 'locked', true], ['toggle', 'music', false], ['slider', 'volume', false], ['select', 'mode', false]
  ])
  assert.equal(controls[0].label, 'Buy <sword>')
  assert.equal(controls[3].value, 0.5)
  assert.deepEqual(controls[4].options, ['a', 'b', 'c'])
})

test('a click runs its handler on the next fixed step, with the value the control sends', () => {
  const { context, step } = loaded()
  const seen = []
  context.gameUi.show('shop', { html: shop(), on: { buy: (value, event) => seen.push(['buy', value, event.kind]), music: value => seen.push(['music', value]), volume: value => seen.push(['volume', value]) } })
  assert.equal(context.gameUi.click('shop', 'buy'), true)
  assert.equal(context.gameUi.click('shop', 'music', true), true)
  assert.equal(context.gameUi.click('shop', 'volume', 0.75), true)
  assert.deepEqual(seen, [], 'nothing runs between steps')
  step()
  assert.deepEqual(seen, [['buy', '', 'button'], ['music', true], ['volume', 0.75]])
})

test('a disabled control and an unknown action are refused', () => {
  const { context } = loaded()
  context.gameUi.show('shop', { html: shop() })
  assert.equal(context.gameUi.click('shop', 'locked'), false)
  assert.equal(context.gameUi.click('shop', 'nothing'), false)
  assert.equal(context.gameUi.click('missing', 'buy'), false)
})

test('controls sharing an action are told apart by value', () => {
  const { context, step } = loaded()
  const picked = []
  context.gameUi.show('tabs', { html: kit.tabs(['one', 'two'], { action: 'tab', value: 'one' }), on: { tab: value => picked.push(value) } })
  context.gameUi.click('tabs', 'tab', 'two')
  step()
  assert.deepEqual(picked, ['two'])
})

test('a handler that throws is skipped and the next one still runs', () => {
  const { context, step } = loaded()
  const quiet = console.error
  console.error = () => {}
  const seen = []
  context.gameUi.show('shop', { html: shop(), on: { buy: () => { throw new Error('no') }, music: () => seen.push('music') } })
  context.gameUi.click('shop', 'buy')
  context.gameUi.click('shop', 'music', true)
  step()
  console.error = quiet
  assert.deepEqual(seen, ['music'])
})

test('menu keys move focus over enabled controls, wrap, and confirm', () => {
  const { context, step } = loaded()
  const seen = []
  context.gameUi.show('shop', { isInteractive: true, html: shop(), on: { buy: () => seen.push('buy'), music: value => seen.push(['music', value]), back: () => seen.push('back') } })
  const focused = () => context.gameUi.controls('shop').find(control => control.isFocused)?.action
  assert.equal(focused(), 'buy', 'the first enabled control starts focused')
  step('uiDown')
  assert.equal(focused(), 'music', 'the disabled one is skipped')
  step('uiConfirm')
  step('uiUp')
  step('uiUp')
  assert.equal(focused(), 'mode', 'up from the first wraps to the last')
  step('uiDown')
  step('uiConfirm')
  step('uiBack')
  assert.deepEqual(seen, [['music', true], 'buy', 'back'])
})

test('left and right step a slider and a select', () => {
  const { context, step } = loaded()
  const seen = []
  let volume = 0.5
  let mode = 'a'
  context.gameUi.show('settings', {
    isInteractive: true,
    html: () => shop({ volume, mode }),
    on: { volume: value => { volume = value; seen.push(['volume', value]) }, mode: value => { mode = value; seen.push(['mode', value]) } }
  })
  step('uiDown', 'uiDown')
  step('uiDown')
  assert.equal(context.gameUi.controls('settings').find(control => control.isFocused).action, 'volume')
  step('uiRight')
  step('uiLeft')
  step('uiLeft')
  step('uiDown')
  step('uiLeft')
  assert.deepEqual(seen, [['volume', 0.75], ['volume', 0.5], ['volume', 0.25], ['mode', 'c']])
})

test('only an interactive panel takes the menu keys, and the last one shown wins', () => {
  const { context, step } = loaded()
  const seen = []
  context.gameUi.show('bar', { html: kit.button('Skill', { action: 'skill' }), on: { skill: () => seen.push('skill') } })
  step('uiConfirm')
  assert.deepEqual(seen, [], 'a panel that lets clicks through leaves the keys to the game')
  context.gameUi.show('lower', { isInteractive: true, html: kit.button('A', { action: 'a' }), on: { a: () => seen.push('a') } })
  context.gameUi.show('upper', { isInteractive: true, html: kit.button('B', { action: 'b' }), on: { b: () => seen.push('b') } })
  step('uiConfirm')
  assert.deepEqual(seen, ['b'])
})

test('menu actions are bound once, and never over a game that bound them', () => {
  const { context, step, bound } = loaded()
  context.input.bind('uiConfirm', ['KeyE'])
  context.gameUi.show('shop', { isInteractive: true, html: shop() })
  step()
  assert.deepEqual(bound.uiConfirm, ['KeyE'])
  assert.deepEqual(bound.uiUp, ['ArrowUp'])
})

test('a theme file sets tokens; :root becomes :host so a panel can use it', () => {
  const css = ':root { --ui-accent: #ff0066; --ui-radius: 2px }\n.ui-button { border-width: 3px }'
  assert.equal(tokensOf(css).accent, '#ff0066')
  assert.equal(tokensOf(css).ink, '#ffffff', 'a token the file leaves out keeps its default')
  const sheet = sheetText(css)
  assert.match(sheet, /:host \{ --ui-accent: #ff0066/)
  assert.ok(sheet.indexOf('.ui-button { border-width: 3px }') > sheet.indexOf('.ui-button {'), 'the game rules come after the kit rules')
})

test('a theme colours Screen and the HUD through their palettes', async () => {
  const { context } = loaded({ 'assets/ui/theme.css': ':root { --ui-accent: #00ff88; --ui-ink: #eeeeee }' })
  await context.gameUi.theme.load()
  assert.equal(context.screen.palette.accent, '#00ff88')
  assert.equal(context.hud.palette.ink, '#eeeeee')
  assert.equal(context.gameUi.theme.kind(), 'file')
})

test('a level load reads a file theme again but keeps a theme given as text', async () => {
  const { context } = loaded({ 'assets/ui/theme.css': ':root { --ui-accent: #111111 }' })
  context.bus.emit('level:loaded', 'main')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(context.gameUi.theme.tokens().accent, '#111111')
  context.gameUi.theme.use(':root { --ui-accent: #222222 }')
  context.bus.emit('level:loaded', 'main')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(context.gameUi.theme.tokens().accent, '#222222')
})

test('a project with no theme file keeps the defaults', async () => {
  const { context } = loaded()
  context.bus.emit('level:loaded', 'main')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(context.gameUi.theme.kind(), 'default')
  assert.equal(context.gameUi.theme.tokens().accent, '#ffd166')
})

test('every component takes class and style, and the caller wins over the kit', () => {
  const html = kit.button('Go', { action: 'go', class: 'big', style: 'color: red' })
  assert.match(html, /class="big ui-button"/)
  assert.match(html, /style="color: red"/)
  assert.match(kit.stack(['x'], { gap: 2, style: 'margin: 0' }), /style="--gap:2;margin: 0"/)
  assert.match(kit.text('a', { class: 'q"uote' }), /class="q&quot;uote ui-text"/, 'a class name is escaped, not trusted')
})

test('kit.element is any tag with any attributes, and refuses a tag name that is not one', () => {
  assert.equal(kit.element('hi', { as: 'section', attributes: { 'data-x': 1 } }), '<section data-x="1">hi</section>')
  assert.equal(kit.element('hi', { as: 'div onclick=x' }), '<div>hi</div>')
})

test('a target raises the game\'s own event on the DOM events it names, and handlers can be typed', () => {
  const { context, step } = loaded()
  const seen = []
  context.gameUi.show('bag', {
    html: kit.target('<b>Sword</b>', { action: 'item', value: 'sword', triggers: ['click', 'contextmenu', 'pointerover'] }),
    on: {
      item: (value, event) => seen.push(['any', value, event.type]),
      'item:contextmenu': (value, event) => seen.push(['menu', value, event.type])
    }
  })
  assert.deepEqual(context.gameUi.controls('bag')[0].triggers, ['click', 'contextmenu', 'pointerover'])
  assert.equal(context.gameUi.click('bag', 'item', 'sword'), true, 'the first trigger by default')
  assert.equal(context.gameUi.click('bag', 'item', 'sword', 'contextmenu'), true)
  assert.equal(context.gameUi.click('bag', 'item', 'sword', 'dblclick'), false, 'a trigger the control does not name is refused')
  step()
  assert.deepEqual(seen, [['any', 'sword', 'click'], ['menu', 'sword', 'contextmenu']])
})

test('a panel asked every third frame is asked on the first frame and then every third', () => {
  const panel = { lastHtml: null, every: 3, stagger: 0 }
  const due = []
  for (let frame = 1; frame <= 7; frame++) {
    if (isDue(panel, frame)) { due.push(frame); panel.lastHtml = 'x' }
  }
  assert.deepEqual(due, [1, 3, 6])
})

test('a takesKeys panel is navigated by the menu keys without taking the whole pointer', () => {
  const { context, step } = loaded()
  const seen = []
  context.gameUi.show('card', { takesKeys: true, html: kit.button('A', { action: 'a' }), on: { a: () => seen.push('a') } })
  step('uiConfirm')
  assert.deepEqual(seen, ['a'])
})

test('a class key replays an animation: a changed key is a different element in the HTML', () => {
  assert.match(kit.text('Hit', { class: 'ui-shake', key: 3 }), /class="ui-shake ui-text" data-key="3"/)
})

test('a record opens the frame after its element appears, and leaves after its leave seconds', () => {
  const record = { phase: 'entering', element: null, drawnFrame: -1, leave: 0.25, leaveLeft: 0 }
  assert.equal(advancePhase(record, 1, 0.016), false)
  assert.equal(record.phase, 'entering', 'no element yet, so it stays entering')
  record.element = {}
  record.drawnFrame = 2
  advancePhase(record, 2, 0.016)
  assert.equal(record.phase, 'entering', 'the frame the element appeared on')
  advancePhase(record, 3, 0.016)
  assert.equal(record.phase, 'open')
  startLeaving(record)
  assert.deepEqual([advancePhase(record, 4, 0.1), advancePhase(record, 5, 0.1), advancePhase(record, 6, 0.1)], [false, false, true])
})

test('hide with no element on the page removes at once; with one, it waits out its leave time and takes no clicks', () => {
  const { context } = loaded()
  context.gameUi.show('a', { html: kit.button('A', { action: 'a' }), leave: 0.25 })
  assert.equal(context.gameUi.hide('a'), true)
  assert.equal(context.gameUi.isShowing('a'), false, 'never drawn, so nothing to animate out')
  const root = { addEventListener() {}, contains: () => false, childNodes: [], append() {} }
  const element = { dataset: {}, style: {}, isConnected: true, attachShadow: () => root }
  const unmounted = []
  context.ui = { mount() {}, unmount: item => unmounted.push(item) }
  const saved = { document: globalThis.document, sheet: globalThis.CSSStyleSheet }
  globalThis.document = { createElement: name => (name === 'template' ? { content: { childNodes: [] } } : element) }
  globalThis.CSSStyleSheet = class { replaceSync() {} }
  const frameSystem = gameUi.systems.find(system => system.phase === 'frame')
  const frame = seconds => frameSystem.run(null, seconds, context)
  context.gameUi.show('b', { html: kit.button('B', { action: 'b' }), leave: 0.25, on: { b: () => {} } })
  frame(0.1)
  assert.equal(element.dataset.phase, 'entering')
  frame(0.1)
  assert.equal(element.dataset.phase, 'open')
  context.gameUi.hide('b')
  assert.equal(context.gameUi.isShowing('b'), false)
  assert.equal(context.gameUi.click('b', 'b'), false, 'a leaving panel takes no clicks')
  frame(0.1)
  assert.equal(element.dataset.phase, 'leaving')
  assert.deepEqual(unmounted, [], 'still on the page while it animates out')
  frame(0.2)
  assert.deepEqual(unmounted, [element], 'and taken off when its time is up')
  Object.assign(globalThis, { document: saved.document, CSSStyleSheet: saved.sheet })
})

test('a bar carries its fraction once, on the track, and has a trail unless asked not to', () => {
  const html = kit.bar(30, { max: 120, label: 'HP', kind: 'health' })
  assert.match(html, /class="ui-bar-track" style="--fraction:0.25"/)
  assert.match(html, /ui-bar-trail/)
  assert.doesNotMatch(kit.bar(1, { trail: false }), /ui-bar-trail/)
  assert.match(kit.bar(500, { max: 100 }), /--fraction:1"/, 'clamped to a full bar')
})

test('drag and drop: sources and zones read back, and a drop reaches the zone action with both sides', () => {
  const { context, step } = loaded()
  const seen = []
  context.gameUi.show('bag', {
    html: kit.row([
      kit.slot({ glyph: 'S', action: 'slot', value: 'sword', drag: 'sword', drop: 'move', dropValue: 0 }),
      kit.slot({ glyph: '', drop: 'move', dropValue: 1 }),
      kit.target('bin', { action: 'noop', drop: 'discard' })
    ]),
    on: { 'move:drop': value => seen.push(['move', value]), discard: value => seen.push(['discard', value]) }
  })
  assert.deepEqual(context.gameUi.drags('bag'), ['sword'])
  assert.deepEqual(context.gameUi.drops('bag'), [{ action: 'move', value: '0' }, { action: 'move', value: '1' }, { action: 'discard', value: '' }])
  assert.equal(context.gameUi.drop('bag', 'move', 'sword', 1), true)
  assert.equal(context.gameUi.drop('bag', 'discard', 'sword'), true)
  assert.equal(context.gameUi.drop('bag', 'move', 'sword', 9), false, 'no such zone')
  step()
  assert.deepEqual(seen, [['move', { drag: 'sword', drop: '1' }], ['discard', { drag: 'sword', drop: '' }]])
})

test('drag and drop attributes are escaped', () => {
  assert.match(kit.text('x', { drag: 'a"b' }), /data-drag="a&quot;b"/)
})

test('a typewriter reveals characters by time, pausing on punctuation, and skip shows all', () => {
  assert.equal(revealedChars('Hello', 0), 0)
  assert.equal(revealedChars('Hello', 0.05, 30), 1)
  assert.equal(revealedChars('Hello', 10, 30), 5)
  assert.equal(revealedChars('Wait. Go', 0.2, 30), 4, 'the full stop holds the next word back')
  assert.equal(revealedChars('anything', Infinity), 8)
})

test('gameUi.typewriter follows engine time and can be skipped or restarted', () => {
  const { context } = loaded()
  context.time = 5
  const line = context.gameUi.typewriter('Hello there', { speed: 10 })
  assert.equal(line.chars(), 0)
  context.time = 5.35
  assert.equal(line.chars(), 3)
  assert.equal(line.isDone(), false)
  line.skip()
  assert.equal(line.isDone(), true)
  line.restart('Again')
  assert.equal(line.text, 'Again')
  assert.equal(line.chars(), 0)
})

test('a dialogue shows typed text, hides the rest, and offers choices only once the text is complete', () => {
  const partial = kit.dialogue({ speaker: 'Elder', text: 'Help us <please>', chars: 4, choices: [{ label: 'Yes', value: 'y' }] })
  assert.match(partial, /<span class="ui-typed">Help<\/span>/)
  assert.match(partial, /<span class="ui-untyped"> us &lt;please&gt;<\/span>/)
  assert.doesNotMatch(partial, /data-action="choose"/, 'no choices while it types')
  const { context, step } = loaded()
  const seen = []
  context.gameUi.show('talk', { html: kit.dialogue({ speaker: 'Elder', text: 'Hi', choices: [{ label: 'Yes', value: 'y' }] }), on: { advance: () => seen.push('advance'), choose: value => seen.push(value) } })
  assert.deepEqual(context.gameUi.controls('talk').map(control => control.action), ['advance', 'choose'])
  context.gameUi.click('talk', 'advance')
  context.gameUi.click('talk', 'choose', 'y')
  step()
  assert.deepEqual(seen, ['advance', 'y'])
})
