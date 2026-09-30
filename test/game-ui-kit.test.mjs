/**
 * Game UI kit: components that read back as controls, events that run on the
 * fixed step, keyboard focus, and one theme for Game UI, Screen and the HUD.
 * All headless: nothing here needs a document.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeBus } from '../engine/bus.js'
import gameUi from '../plugins/builtin/game-ui.js'
import { keyName, kit } from '../plugins/builtin/game-ui/components.js'
import { advancePhase, isDue, startLeaving } from '../plugins/builtin/game-ui/records.js'
import { BASE_CSS } from '../plugins/builtin/game-ui/base-css.js'
import { heldPadCodes, pollGamepad } from '../plugins/builtin/game-ui/gamepad.js'
import { menuPlacement, radialPlacement } from '../plugins/builtin/game-ui/popup.js'
import { soundOfEvent } from '../plugins/builtin/game-ui/sounds.js'
import { makeTipState, tipHooks, tipHtml, tipPlacement, runTooltip } from '../plugins/builtin/game-ui/tooltip.js'
import { revealedChars } from '../plugins/builtin/game-ui/typewriter.js'
import { DEFAULT_TOKENS, sheetText, tokensOf } from '../plugins/builtin/game-ui/theme.js'

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
  assert.deepEqual(bound.uiUp, ['ArrowUp', 'GamepadUp'], 'the keyboard, and the pad as virtual codes')
})

test('a theme file sets tokens; :root becomes :host so a panel can use it', () => {
  const css = ':root { --ui-accent: #ff0066; --ui-radius: 2px }\n.ui-button { border-width: 3px }'
  assert.equal(tokensOf(css).accent, '#ff0066')
  assert.equal(tokensOf(css).ink, DEFAULT_TOKENS.ink, 'a token the file leaves out keeps its default')
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
  assert.equal(context.gameUi.theme.tokens().accent, DEFAULT_TOKENS.accent)
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

test('a ring carries its fraction and label, and a cooldown sweeps while it has time left', () => {
  assert.match(kit.ring(3, { max: 4, label: '3/4', size: 80 }), /--fraction:0.75;--size:80px/)
  assert.match(kit.ring(1, { max: 4 }), /25%/)
  const cooling = kit.cooldown(kit.button('Fire', { action: 'fire' }), { remaining: 2.26, total: 5 })
  assert.match(cooling, /data-cooling/)
  assert.match(cooling, /--fraction:0.452/)
  assert.match(cooling, /ui-cooldown-text">2.3</)
  assert.match(kit.cooldown('x', { remaining: 12.2, total: 20 }), />13</, 'a long wait shows whole seconds')
  const ready = kit.cooldown('x', { remaining: 0, total: 5 })
  assert.doesNotMatch(ready, /data-cooling|ui-cooldown-text/)
})

test('pips fill up to the value', () => {
  const html = kit.pips(2, { max: 4 })
  assert.equal((html.match(/data-full/g) ?? []).length, 4)
  assert.equal((html.match(/data-full="true"/g) ?? []).length, 2)
})

test('click never presses another control of the same action when the one asked for is disabled', () => {
  const { context, step } = loaded()
  const seen = []
  context.gameUi.show('bar', {
    html: kit.row([kit.slot({ glyph: 'F', action: 'skill', value: 'fire', isDisabled: true }), kit.slot({ glyph: 'I', action: 'skill', value: 'ice' })]),
    on: { skill: value => seen.push(value) }
  })
  assert.equal(context.gameUi.click('bar', 'skill', 'fire'), false)
  assert.equal(context.gameUi.click('bar', 'skill', 'ice'), true)
  assert.equal(context.gameUi.click('bar', 'skill'), true, 'with no value, the first enabled one')
  step()
  assert.deepEqual(seen, ['ice', 'ice'])
})

/** A context with a clock and timers the test runs by hand. */
function timed() {
  const made = loaded()
  const timers = []
  made.context.time = 0
  made.context.after = (seconds, run) => timers.push({ at: made.context.time + seconds, run })
  const advance = seconds => {
    made.context.time += seconds
    for (const timer of timers.filter(candidate => candidate.at <= made.context.time)) { timers.splice(timers.indexOf(timer), 1); timer.run() }
  }
  return { ...made, advance }
}

test('notifications stack, fade near their end, go at their end, and a click dismisses one early', () => {
  const { context, step, advance } = timed()
  const first = context.gameUi.notify('Saved', { tone: 'good', life: 2 })
  context.gameUi.notify('Low health', { tone: 'danger', life: 5 })
  assert.equal(context.gameUi.read('ui:notifications'), 'Saved Low health')
  assert.match(context.gameUi.controls('ui:notifications')[0].value, /^note:/)
  advance(1.8)
  assert.equal(context.gameUi.read('ui:notifications'), 'Saved Low health')
  context.gameUi.click('ui:notifications', 'dismiss', 'note:1')
  step()
  assert.equal(context.gameUi.read('ui:notifications'), 'Saved', 'the click removed the second')
  advance(0.3)
  assert.equal(context.gameUi.isShowing('ui:notifications'), false, 'the last one ended, so the stack is gone')
  assert.equal(first, 'note:0')
})

test('notifications keep the newest six, and the run ending clears them', () => {
  const { context } = timed()
  for (let count = 0; count < 9; count++) context.gameUi.notify(`n${count}`)
  assert.equal(context.gameUi.read('ui:notifications'), 'n3 n4 n5 n6 n7 n8')
  context.bus.emit('play:stopped')
  assert.equal(context.gameUi.isShowing('ui:notifications'), false)
  context.gameUi.notify('again')
  assert.equal(context.gameUi.read('ui:notifications'), 'again', 'a new run starts with an empty list')
})

test('a popup menu opens at a point kept on screen, picks once, and dismisses on an outside click', () => {
  const { context, step } = loaded()
  context.viewport = { width: 800, height: 600 }
  const picked = []
  context.gameUi.menu({ at: { x: 790, y: 590 }, items: [{ label: 'Mark', value: 'mark' }, { isDivider: true }, { label: 'Drop', value: 'drop', kind: 'danger', isDisabled: true }], onPick: value => picked.push(value) })
  assert.ok(context.gameUi.isShowing('ui:menu'))
  assert.deepEqual(context.gameUi.controls('ui:menu').map(control => [control.action, control.isDisabled]), [['pick', false], ['pick', true], ['dismiss', false]])
  assert.equal(context.gameUi.controls('ui:menu')[0].isFocused, true, 'the first item has the keys, not the outside layer')
  assert.equal(context.gameUi.click('ui:menu', 'pick', 'drop'), false, 'a disabled row cannot be picked')
  context.gameUi.click('ui:menu', 'pick', 'mark')
  step()
  assert.deepEqual(picked, ['mark'])
  assert.equal(context.gameUi.isShowing('ui:menu'), false)
  context.gameUi.menu({ at: { x: 10, y: 10 }, items: [{ label: 'A', value: 'a' }], onPick: value => picked.push(value) })
  context.gameUi.click('ui:menu', 'dismiss')
  step()
  assert.deepEqual(picked, ['mark'], 'dismissing picks nothing')
  assert.equal(context.gameUi.isShowing('ui:menu'), false)
})

test('a popup menu is placed inside the viewport, and left where it was asked when there is room', () => {
  const viewport = { width: 800, height: 600 }
  assert.deepEqual(menuPlacement({ x: 790, y: 590 }, 2, viewport), { x: 592, y: 504 }, 'moved in from the corner: 800 - 200 - 8 across, 600 - (2 x 36 + 16) - 8 down')
  assert.deepEqual(menuPlacement({ x: 100, y: 120 }, 3, viewport), { x: 100, y: 120 })
  assert.deepEqual(menuPlacement({ x: -50, y: -5 }, 1, viewport), { x: 8, y: 8 })
})

test('a context menu carries the classes its CSS needs, on the rows and on the outside layer', () => {
  const html = kit.contextMenu([{ label: 'A', value: 'a' }], { x: 5, y: 6 })
  assert.match(html, /class="ui-menu-item ui-button"/)
  assert.match(html, /class="ui-menu-scrim"/)
  assert.match(html, /left:5px;top:6px/)
})

test('an accordion opens the sections named, and disables the controls in the closed ones', () => {
  const html = kit.accordion([
    { value: 'a', title: 'Audio', content: [kit.toggle('Music', { action: 'music', isOn: true })] },
    { value: 'b', title: 'Video', content: [kit.button('Reset', { action: 'reset' })] }
  ], { open: 'a' })
  assert.equal((html.match(/data-open/g) ?? []).length, 1)
  const { context, step } = loaded()
  const seen = []
  context.gameUi.show('menu', { html, on: { toggle: value => seen.push(value), reset: () => seen.push('reset') } })
  assert.deepEqual(context.gameUi.controls('menu').map(control => [control.action, control.isDisabled]), [['toggle', false], ['music', false], ['toggle', false], ['reset', true]])
  assert.equal(context.gameUi.click('menu', 'reset'), false, 'a closed section cannot be used')
  context.gameUi.click('menu', 'toggle', 'b')
  step()
  assert.deepEqual(seen, ['b'])
})

test('a table shows text cells, marks the sorted column, and rows raise the action with their value', () => {
  const columns = [{ key: 'name', label: 'Name', isSortable: true }, { key: 'score', label: 'Score', align: 'right', isSortable: true }]
  const rows = [{ value: 'ada', name: 'Ada <A>', score: 90 }, { value: 'bo', name: 'Bo', score: 70 }]
  const html = kit.table(columns, rows, { action: 'pick', selected: 'bo', sortKey: 'score', sortDirection: 'descending' })
  assert.match(html, /aria-sort="descending"/)
  assert.match(html, /Score ▼/)
  assert.match(html, /Ada &lt;A&gt;/)
  const { context, step } = loaded()
  const seen = []
  context.gameUi.show('board', { html, on: { pick: value => seen.push(value), sort: value => seen.push('sort:' + value) } })
  context.gameUi.click('board', 'pick', 'ada')
  context.gameUi.click('board', 'sort', 'name')
  step()
  assert.deepEqual(seen, ['ada', 'sort:name'])
})

test('an avatar falls back to initials, and a key code reads as a keycap', () => {
  assert.match(kit.avatar({ name: 'ada lovelace byron', status: 'online' }), /ui-avatar-initials">AL</)
  assert.match(kit.avatar({ image: 'ui/ada.png', name: 'Ada' }), /src="\/project\/assets\/ui\/ada.png"/)
  assert.deepEqual(['KeyE', 'Digit3', 'ArrowUp', 'MouseLeft', 'Space', null].map(keyName), ['E', '3', '↑', 'LMB', 'Space', 'none'])
})

test('a keybind row waits for the next key, hands it to the callback on the fixed step, and Esc cancels', () => {
  const { context, step } = loaded()
  const got = []
  assert.equal(context.gameUi.feedKey('KeyQ'), false, 'nothing waiting, nothing taken')
  context.gameUi.captureKey(code => got.push(code))
  assert.equal(context.gameUi.isCapturing(), true)
  assert.equal(context.gameUi.feedKey('KeyQ'), true)
  assert.equal(context.gameUi.isCapturing(), false)
  assert.deepEqual(got, [], 'not until the fixed step')
  step()
  context.gameUi.captureKey(code => got.push(code))
  context.gameUi.feedKey('Escape')
  step()
  assert.deepEqual(got, ['KeyQ', null])
  assert.match(kit.keybind('Jump', 'Space', { isListening: true }), /Press a key…/)
  assert.match(kit.keybind('Jump', 'Space'), />Space</)
})

test('the kit stylesheet lists the base components before the extensions that restyle them', () => {
  // The same specificity is decided by order, so an extension written first loses to `.ui-button`.
  const at = rule => BASE_CSS.indexOf(rule)
  assert.ok(at('.ui-button {') > -1)
  for (const extension of ['.ui-accordion-head', '.ui-menu-item', '.ui-keycap', '.ui-table-sort']) {
    assert.ok(at(extension) > at('.ui-button {'), `${extension} comes after .ui-button`)
  }
})

test('an effect with a life removes itself, one without stays until cleared and fades out first', () => {
  const { context, advance } = timed()
  const flash = context.gameUi.effect('flash', { color: 'danger', strength: 0.4, life: 0.35 })
  const vignette = context.gameUi.effect('vignette', { color: '#112233', strength: 0.6, class: 'ui-pulse' })
  assert.deepEqual(context.gameUi.effects().map(effect => effect.name), ['flash', 'vignette'])
  assert.equal(context.gameUi.isShowing('ui:effects'), true)
  advance(0.4)
  assert.deepEqual(context.gameUi.effects().map(effect => effect.name), ['vignette'], 'the flash is gone after its life')
  context.gameUi.clearEffect('vignette')
  assert.equal(context.gameUi.effects()[0].isLeaving, true, 'clearing starts the fade, it does not cut')
  advance(0.5)
  assert.deepEqual(context.gameUi.effects(), [])
  assert.equal(context.gameUi.isShowing('ui:effects'), false, 'no effects, no layer')
  assert.match(flash, /^fx:/)
  assert.notEqual(flash, vignette)
})

test('an effect name must be a class-safe word, and a colour is a theme token or a plain CSS colour', () => {
  const { context } = timed()
  assert.equal(context.gameUi.effect('Bad Name'), '')
  assert.equal(context.gameUi.effect('x" onmouseover="'), '')
  assert.equal(context.gameUi.effects().length, 0)
  context.gameUi.effect('tint', { color: 'expression(alert(1));}' })
  context.gameUi.effect('my-glow', { color: 'good', strength: 2 })
  assert.equal(context.gameUi.effects().length, 2)
})

test('effects and a run ending: the list is empty for the next run', () => {
  const { context } = timed()
  context.gameUi.effect('fade', { color: '#000' })
  context.bus.emit('play:stopped')
  assert.deepEqual(context.gameUi.effects(), [])
  assert.equal(context.gameUi.isShowing('ui:effects'), false)
})

/** A timed context with a `play` that records what it was asked to play. */
function heard() {
  const made = timed()
  const plays = []
  made.context.play = (file, options) => plays.push([file, options.volume])
  return { ...made, plays }
}

test('UI sounds come from the theme tokens or from code, and a name with no file is silent', () => {
  const { context, step, advance, plays } = heard()
  context.gameUi.show('bar', { html: kit.button('Go', { action: 'go' }), on: { go() {} } })
  context.gameUi.click('bar', 'go')
  step()
  assert.deepEqual(plays, [], 'no sound set, no sound')
  context.gameUi.theme.use(':root { --ui-sound-click: "ui/click.wav"; --ui-sound-volume: 0.5 }')
  advance(1)
  context.gameUi.click('bar', 'go')
  step()
  assert.deepEqual(plays, [['ui/click.wav', 0.5]], 'the theme names the file and the volume, and quotes are dropped')
  context.gameUi.sounds({ click: 'mine.wav' })
  advance(1)
  context.gameUi.click('bar', 'go')
  step()
  assert.equal(plays.at(-1)[0], 'mine.wav', 'code overrides the theme')
})

test('each event makes its own sound, falling back to click, and the same sound waits 0.05 s', () => {
  const { context, step, advance, plays } = heard()
  context.gameUi.sounds({ click: 'c.wav', toggle: 't.wav', notify: 'n.wav' })
  context.gameUi.show('panel', {
    html: kit.stack([kit.toggle('T', { action: 'toggle-it' }), kit.tabs(['a', 'b'], { action: 'tab', value: 'a' }), kit.slider('S', { action: 'slide-it' })]),
    on: {}
  })
  context.gameUi.click('panel', 'toggle-it', true)
  context.gameUi.click('panel', 'tab', 'b')
  context.gameUi.click('panel', 'slide-it', 0.5)
  step()
  assert.deepEqual(plays.map(play => play[0]), ['t.wav', 'c.wav'], 'a toggle has its own; a tab falls back to click; a slider has none and does not click')
  context.gameUi.click('panel', 'tab', 'b')
  step()
  assert.equal(plays.length, 2, 'the same sound inside 0.05 s is dropped')
  advance(0.1)
  context.gameUi.click('panel', 'tab', 'b')
  step()
  assert.equal(plays.length, 3)
  context.gameUi.notify('Hi', { tone: 'good' })
  assert.equal(plays.at(-1)[0], 'n.wav', 'notify-good falls back to notify')
})

test('opening and closing an interactive panel, and a leaving panel, make their sounds', () => {
  const { context, plays } = heard()
  context.gameUi.sounds({ open: 'open.wav', close: 'close.wav' })
  context.gameUi.show('card', { html: 'x' })
  assert.deepEqual(plays, [], 'a panel that lets clicks through is not opened with a sound')
  context.gameUi.show('menu', { isInteractive: true, html: kit.button('A', { action: 'a' }) })
  context.gameUi.hide('menu')
  assert.deepEqual(plays.map(play => play[0]), ['open.wav', 'close.wav'])
})

test('hover and focus moves queue their sounds; a press on a control that was hidden makes none', () => {
  const { context, step, advance, plays } = heard()
  context.gameUi.sounds({ focus: 'f.wav', click: 'c.wav' })
  context.gameUi.show('menu', { takesKeys: true, html: kit.row([kit.button('A', { action: 'a' }), kit.button('B', { action: 'b' })]), on: {} })
  step('uiDown')
  assert.deepEqual(plays.map(play => play[0]), ['f.wav'], 'moving focus makes the focus sound')
  advance(0.1)
  context.gameUi.click('menu', 'b')
  context.gameUi.hide('menu')
  step()
  assert.equal(plays.length, 1, 'the panel went while the click was queued, so no click sound')
})

test('soundOfEvent: types beat kinds, pointer enter and leave are silent', () => {
  assert.equal(soundOfEvent({ type: 'dragstart', kind: 'drag' }), 'pickup')
  assert.equal(soundOfEvent({ type: 'drop', kind: 'drop' }), 'drop')
  assert.equal(soundOfEvent({ type: 'click', kind: 'button' }), 'click')
  assert.equal(soundOfEvent({ type: 'change', kind: 'toggle' }), 'toggle')
  assert.equal(soundOfEvent({ type: 'key', kind: 'key' }), 'close')
  assert.equal(soundOfEvent({ type: 'pointerover', kind: 'target' }), '')
  assert.equal(soundOfEvent({ type: 'dragend', kind: 'drag' }), '')
})

test('a UI sound still plays after game time goes back, as it does on a level reload', () => {
  const { context, plays } = heard()
  context.gameUi.sounds({ click: 'c.wav' })
  context.time = 10
  assert.equal(context.gameUi.playSound('click'), 'c.wav')
  context.time = 0.5
  assert.equal(context.gameUi.playSound('click'), 'c.wav', 'time went back to before the last play')
  assert.equal(plays.length, 2)
})

/** A gamepad as `navigator.getGamepads` reports one: buttons with `pressed`, and axes. */
const pad = ({ pressed = [], axes = [0, 0] } = {}) => ({ buttons: Array.from({ length: 16 }, (unused, index) => ({ pressed: pressed.includes(index) })), axes })

test('a gamepad becomes key codes: buttons, the d-pad and the left stick', () => {
  assert.deepEqual([...heldPadCodes([pad({ pressed: [0, 12] })])].sort(), ['GamepadA', 'GamepadUp'])
  assert.deepEqual([...heldPadCodes([pad({ axes: [-0.9, 0.1] })])], ['GamepadLeft'])
  assert.deepEqual([...heldPadCodes([pad({ axes: [0.3, 0.4] })])], [], 'a small lean is not a direction')
  assert.deepEqual([...heldPadCodes([null, pad({ pressed: [1] })])], ['GamepadB'], 'an empty slot is skipped')
  assert.deepEqual([...heldPadCodes([pad({ pressed: [6, 7, 10] })])], [], 'buttons with no code are ignored')
})

test('polling presses what became held, releases what was let go, and repeats a held direction', () => {
  const calls = []
  const context = { input: { press: code => calls.push('+' + code), release: code => calls.push('-' + code) } }
  const state = { padHeld: new Map() }
  pollGamepad(context, state, [pad({ pressed: [0, 13] })], 0.016)
  assert.deepEqual(calls, ['+GamepadA', '+GamepadDown'])
  calls.length = 0
  pollGamepad(context, state, [pad({ pressed: [0, 13] })], 0.2)
  assert.deepEqual(calls, [], 'held, and not yet time to repeat')
  pollGamepad(context, state, [pad({ pressed: [0, 13] })], 0.3)
  assert.deepEqual(calls, ['-GamepadDown', '+GamepadDown'], 'a held direction repeats; a held button does not')
  calls.length = 0
  pollGamepad(context, state, [pad()], 0.016)
  assert.deepEqual(calls.sort(), ['-GamepadA', '-GamepadDown'])
  assert.equal(state.padHeld.size, 0)
})

test('a wheel puts its items on a circle clockwise from the top, and keeps the whole wheel on screen', () => {
  const html = kit.radial([{ label: 'A', value: 'a', glyph: '1' }, { label: 'B', value: 'b' }, { label: 'C', value: 'c' }, { label: 'D', value: 'd' }], { x: 300, y: 200, radius: 100 })
  assert.match(html, /left:300px;top:200px/)
  const offsets = [...html.matchAll(/left:(-?\d+)px;top:(-?\d+)px;--i:(\d)/g)].map(match => [Number(match[1]), Number(match[2])])
  assert.deepEqual(offsets, [[0, -100], [100, 0], [0, 100], [-100, 0]], 'top, right, bottom, left')
  assert.match(html, /class="ui-radial-item ui-button"/)
  assert.match(html, /class="ui-radial-scrim"/)
  const viewport = { width: 800, height: 600 }
  assert.deepEqual(radialPlacement({ x: 10, y: 590 }, 100, viewport), { x: 148, y: 452 })
  assert.deepEqual(radialPlacement({ x: 400, y: 300 }, 100, viewport), { x: 400, y: 300 })
})

test('a wheel picks by click, and picks the focused item on demand for a hold-to-open wheel', () => {
  const { context, step } = loaded()
  context.viewport = { width: 800, height: 600 }
  const picked = []
  context.gameUi.radial({ items: [{ label: 'Sword', value: 'sword' }, { label: 'Bow', value: 'bow' }, { label: 'Bomb', value: 'bomb', isDisabled: true }, { label: 'Rod', value: 'rod' }], onPick: value => picked.push(value) })
  assert.equal(context.gameUi.isShowing('ui:radial'), true)
  assert.equal(context.gameUi.controls('ui:radial')[0].isFocused, true)
  step('uiRight')
  step('uiRight')
  assert.equal(context.gameUi.controls('ui:radial').find(control => control.isFocused).label, 'Rod', 'the disabled item is skipped')
  assert.equal(context.gameUi.pickFocused('ui:radial'), true, 'as on the release of the key that opened it')
  step()
  assert.deepEqual(picked, ['rod'])
  assert.equal(context.gameUi.isShowing('ui:radial'), false, 'a pick closes the wheel')
  assert.equal(context.gameUi.pickFocused('ui:radial'), false, 'and there is nothing left to pick')
  context.gameUi.radial({ items: [{ label: 'A', value: 'a' }], onPick: value => picked.push(value) })
  context.gameUi.click('ui:radial', 'dismiss')
  step()
  assert.deepEqual(picked, ['rod'], 'dismissing picks nothing')
})

test('the layer behind a menu or wheel can be clicked but is never focused, so a pick cannot land on it', () => {
  const { context, step } = loaded()
  context.viewport = { width: 800, height: 600 }
  const picked = []
  context.gameUi.radial({ items: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }], onPick: value => picked.push(value) })
  const controls = context.gameUi.controls('ui:radial')
  assert.equal(controls.at(-1).isPassive, true)
  assert.equal(controls.at(-1).isDisabled, false, 'it still takes a click')
  step('uiUp')
  assert.equal(context.gameUi.controls('ui:radial').find(control => control.isFocused).label, 'B', 'up from the first wraps to the last item, not to the layer')
  assert.equal(context.gameUi.pickFocused('ui:radial'), true)
  step()
  assert.deepEqual(picked, ['b'])
})

test('a tip is text, escaped, or HTML from a registered provider, or nothing', () => {
  const providers = { item: value => `<b>${value}</b> card` }
  assert.equal(tipHtml({ tip: 'Saves <now>' }, providers), 'Saves &lt;now&gt;')
  assert.equal(tipHtml({ tip: 'fallback', tipKey: 'item', tipValue: 'sword' }, providers), '<b>sword</b> card', 'a provider wins over the text')
  assert.equal(tipHtml({ tip: 'fallback', tipKey: 'missing', tipValue: 'x' }, providers), 'fallback', 'no provider, so the text')
  assert.equal(tipHtml({}, providers), '')
  const html = kit.button('Go', { action: 'go', tip: 'Goes "far"', tipKey: 'item', tipValue: 7 })
  assert.match(html, /data-tip="Goes &quot;far&quot;" data-tip-key="item" data-tip-value="7"/)
})

test('a tip box opens from the side of the viewport with room', () => {
  const viewport = { width: 800, height: 600 }
  assert.equal(tipPlacement(100, 100, viewport), 'left:114px;top:118px')
  assert.equal(tipPlacement(700, 500, viewport), 'right:114px;bottom:118px')
})

test('the tooltip waits, shows once, follows the pointer, and goes when the pointer leaves', () => {
  const shown = []
  const element = { isConnected: true, dataset: { tip: 'Hello' }, getBoundingClientRect: () => ({ left: 0, bottom: 0 }) }
  const state = { panels: new Map(), anchors: new Map(), tip: makeTipState() }
  const context = { viewport: { width: 800, height: 600 }, gameUi: { show: (id, options) => shown.push([id, options]) } }
  const hooks = tipHooks(state.tip)
  hooks.enter(element, 100, 100)
  runTooltip(context, state, 0.2)
  assert.equal(shown.length, 0, 'not before its delay')
  runTooltip(context, state, 0.2)
  assert.equal(shown.length, 1)
  assert.equal(shown[0][1].order, 70)
  assert.match(shown[0][1].html(), /ui-tooltip-box/)
  assert.match(shown[0][1].html(), /left:114px;top:118px/)
  hooks.move(300, 250)
  runTooltip(context, state, 0.016)
  assert.equal(shown.length, 1, 'it moves; it is not shown again')
  assert.match(shown[0][1].html(), /left:314px;top:268px/, 'and the one panel follows the pointer')
  hooks.leave()
  runTooltip(context, state, 0.016)
  assert.equal(state.tip.isShown, false)
  hooks.enter(element, 10, 10)
  runTooltip(context, state, 0.1)
  assert.equal(shown.length, 1, 'a new hover starts its wait again')
})

test('a focused control explains itself only when keys led, not when the pointer left focus behind', () => {
  const shown = []
  const focused = { isConnected: true, dataset: { tip: 'Focused tip' }, getBoundingClientRect: () => ({ left: 20, bottom: 50 }) }
  const root = { querySelector: () => focused }
  const panels = new Map([['menu', { isInteractive: true, phase: 'open', root, lastControls: [{ isDisabled: false }] }]])
  const state = { panels, anchors: new Map(), tip: makeTipState() }
  const context = { viewport: { width: 800, height: 600 }, gameUi: { show: (id, options) => shown.push([id, options]) } }
  runTooltip(context, state, 1)
  assert.equal(shown.length, 0, 'the pointer never led, and keys have not either: no tip for a focus nobody moved')
  state.tip.isKeyLed = true
  runTooltip(context, state, 0.2)
  runTooltip(context, state, 0.2)
  assert.equal(shown.length, 1, 'keys moved the focus, so its tip shows after the delay')
  assert.match(shown[0][1].html(), /Focused tip/)
  assert.match(shown[0][1].html(), /left:34px;top:50px/, 'under the element')
  tipHooks(state.tip).move(5, 5)
  runTooltip(context, state, 0.016)
  assert.equal(state.tip.isShown, false, 'the pointer took over, so the focus tip goes')
})

test('a log draws its newest lines in order, escaped, capped, in a bottom-anchored scroller', () => {
  const html = kit.log(['one', { who: 'Ada', text: 'two <b>', tone: 'danger' }, 'three'], { max: 2 })
  assert.match(html, /class="ui-log"/)
  assert.doesNotMatch(html, />one</, 'the oldest is dropped past max')
  assert.match(html, /<b>Ada <\/b>two &lt;b&gt;/)
  assert.match(html, /data-tone="danger"/)
  assert.ok(html.indexOf('two') < html.indexOf('three'), 'oldest first in the page; the scroller is what puts the newest at the bottom')
  const { context } = loaded()
  context.gameUi.show('chat', { html })
  assert.equal(context.gameUi.read('chat'), 'Ada two <b> three')
})

test('a virtual list draws only the rows near its window, sized for all of them', () => {
  const items = Array.from({ length: 5000 }, (unused, index) => ({ label: `Row ${index}`, value: index }))
  const top = kit.virtualList(items, { rowHeight: 30, height: 300, top: 0, overscan: 2, pick: 'pick' })
  const rowsAt = html => (html.match(/ui-vlist-row/g) ?? []).length
  assert.equal(rowsAt(top), 12, '10 in view and 2 of overscan below')
  assert.match(top, /class="ui-vlist-inner" style="height:150000px"/, 'the scroll bar is the length of all 5000')
  const scrolled = kit.virtualList(items, { rowHeight: 30, height: 300, top: 3000, overscan: 2, pick: 'pick' })
  assert.equal(rowsAt(scrolled), 14, '2 above, 10 in view, 2 below')
  assert.match(scrolled, /Row 98/)
  assert.doesNotMatch(scrolled, /Row 50</)
  assert.match(scrolled, /style="top:2940px"/, 'rows sit at their place in the whole list')
  const end = kit.virtualList(items, { rowHeight: 30, height: 300, top: 149700, overscan: 2 })
  assert.match(end, /Row 4999/)
  assert.equal(rowsAt(end), 12)
})

test('a virtual list reports its scroll position, cannot be focused, and lists only the rows it drew', () => {
  const { context, step } = loaded()
  const seen = []
  let top = 0
  const items = Array.from({ length: 1000 }, (unused, index) => ({ label: `R${index}`, value: index }))
  context.gameUi.show('list', { takesKeys: true, html: () => kit.virtualList(items, { rowHeight: 30, height: 300, top, pick: 'pick' }), on: { scroll: value => { top = value; seen.push(value) }, pick: value => seen.push('pick ' + value) } })
  const before = context.gameUi.controls('list')
  assert.equal(before.filter(control => control.action === 'pick').length, 14, '10 in view and the default 4 of overscan')
  assert.equal(before.find(control => control.action === 'scroll').isPassive, true)
  assert.equal(before[0].isFocused, false, 'focus starts on a row, not the scroller')
  assert.equal(context.gameUi.click('list', 'scroll', 6000, 'scroll'), true)
  step()
  assert.deepEqual(seen, [6000])
  const after = context.gameUi.controls('list').filter(control => control.action === 'pick').map(control => control.value)
  assert.deepEqual([after[0], after.at(-1)], ['196', '213'], 'the window moved to rows 196 to 213')
})
