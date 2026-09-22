/**
 * The UI vocabulary, composed without a browser.
 *
 * Plugins never write markup: they compose from these primitives, so a
 * primitive that returns the wrong node, or fails to bind an input, is a panel
 * that is silently missing or silently wrong — the plugin loader catches a
 * panel's error and disables it without a word. Node has no DOM, so this
 * installs the smallest one the vocabulary touches and reads back what it
 * builds.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { assetURL, makeUI } from '../../engine/ui.js'
import { assetURL as assetURLFromPath } from '../../engine/asset-path.js'

/** The base of the fake DOM, so `ui.js`'s `instanceof Node` check passes. */
class FakeNode {
  constructor() {
    this.children = []
    this.listeners = new Map()
  }

  append(...nodes) {
    this.children.push(...nodes)
  }

  addEventListener(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, [])
    this.listeners.get(event).push(handler)
  }

  /** Fire one event at this element, with it as the target unless told otherwise. */
  fire(event, target = this, extra = {}) {
    for (const handler of this.listeners.get(event) || []) {
      handler({ target, preventDefault() {}, stopPropagation() {}, ...extra })
    }
  }
}

/** One element, with the parts of the DOM `ui.js` reaches for. */
class FakeElement extends FakeNode {
  constructor(tag) {
    super()
    this.tagName = String(tag).toUpperCase()
    this.className = ''
    this.attributes = {}
    this.textContent = ''
    this.value = ''
    this.open = false
    this.draggable = false
    const classes = new Set()
    this.classList = {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name)
    }
  }

  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return this.attributes[name] ?? null }
  focus() { this.focused = true }
  setSelectionRange() {}
}

/** A text node. `ui.js` builds one for every string it appends. */
class FakeText extends FakeNode {
  constructor(text) { super(); this.textContent = String(text) }
}

const saved = { document: globalThis.document, Node: globalThis.Node }
globalThis.Node = FakeNode
globalThis.document = {
  createElement: tag => new FakeElement(tag),
  createTextNode: text => new FakeText(text)
}
after(() => {
  globalThis.document = saved.document
  globalThis.Node = saved.Node
})

/** Every node under one, this one first. */
const flatten = node => [node, ...node.children.flatMap(child => (child instanceof FakeNode ? flatten(child) : []))]

/** The first node under one matching a predicate, or undefined. */
const find = (node, predicate) => flatten(node).find(predicate)

/** A fresh vocabulary over a state object, counting redraws. */
function vocabulary() {
  const state = {}
  const drawn = { count: 0 }
  return { state, drawn, ui: makeUI(state, () => { drawn.count++ }) }
}

// Every primitive the file exposes, built with the smallest argument it takes.
const builds = {
  stack: ui => ui.stack([ui.text('a')]),
  row: ui => ui.row([]),
  spacer: ui => ui.spacer(),
  section: ui => ui.section('title', []),
  fold: ui => ui.fold('title', []),
  gallery: ui => ui.gallery([]),
  scroll: ui => ui.scroll([]),
  text: ui => ui.text('hi'),
  label: ui => ui.label('hi'),
  value: ui => ui.value(1),
  empty: ui => ui.empty('none'),
  meta: ui => ui.meta('1'),
  glyph: ui => ui.glyph('✓'),
  search: ui => ui.search(),
  field: ui => ui.field({ k: 'x', v: 1 }),
  button: ui => ui.button('go', () => {}),
  toggle: ui => ui.toggle({ label: 'x' }),
  slider: ui => ui.slider({ k: 'x', value: 0 }),
  pick: ui => ui.pick({ options: ['a'], value: 'a' }),
  list: ui => ui.list({ items: [1] }),
  textarea: ui => ui.textarea({ value: 'x' }),
  tree: ui => ui.tree({ nodes: [{ id: 'a', title: 'A' }] }),
  grid: ui => ui.grid({ items: [1] }),
  thumb: ui => ui.thumb('player.png'),
  preview: ui => ui.preview('player.png'),
  picture: ui => ui.picture('agent-runs/x.png'),
  raw: ui => ui.raw(new FakeElement('div'))
}

test('every primitive in the vocabulary builds a node', () => {
  const { ui } = vocabulary()
  for (const [name, build] of Object.entries(builds)) {
    assert.equal(typeof ui[name], 'function', `${name} is not on the vocabulary`)
    assert.ok(build(ui) instanceof FakeNode, `${name} did not return a node`)
  }
})

test('the asset URL is re-exported, not a second copy', () => {
  assert.equal(assetURL, assetURLFromPath)
  const { ui } = vocabulary()
  const image = find(ui.thumb('player.png'), node => node.tagName === 'IMG')
  assert.equal(image.getAttribute('src'), '/project/assets/player.png')
})

test('a bound search writes state and redraws', () => {
  const { ui, state, drawn } = vocabulary()
  const box = ui.search({ bind: 'filter' })
  const input = find(box, node => node.tagName === 'INPUT')
  input.fire('input', { value: 'wall' })
  assert.equal(state.filter, 'wall')
  assert.equal(drawn.count, 1)
  box._focus()
  assert.equal(input.focused, true)
})

test('a bound toggle flips state and redraws', () => {
  const { ui, state, drawn } = vocabulary()
  const toggle = ui.toggle({ label: 'grid', bind: 'grid' })
  toggle.fire('click')
  assert.equal(state.grid, true)
  assert.equal(drawn.count, 1)
})

test('a bound slider writes a number', () => {
  const { ui, state } = vocabulary()
  const slider = ui.slider({ k: 'speed', bind: 'speed' })
  const input = find(slider, node => node.tagName === 'INPUT')
  input.fire('input', { value: '0.5' })
  assert.equal(state.speed, 0.5)
})

test('a field with onChange reports its value, a number when it says so', () => {
  const { ui } = vocabulary()
  const seen = []
  const text = find(ui.field({ k: 'note', v: 'a', onChange: value => seen.push(value) }), node => node.tagName === 'INPUT')
  text.fire('change', { value: 'b' })
  const number = find(ui.field({ k: 'x', v: 1, kind: 'number', onChange: value => seen.push(value) }), node => node.tagName === 'INPUT')
  number.fire('change', { value: '2.5' })
  assert.deepEqual(seen, ['b', 2.5])
})

test('a list shows its empty text, marks the selection and reports a pick', () => {
  const { ui } = vocabulary()
  const empty = ui.list({ emptyText: 'nothing here' })
  assert.ok(find(empty, node => node.textContent === 'nothing here'))

  const picked = []
  const list = ui.list({ items: ['a', 'b'], key: item => item, selected: 'b', onPick: item => picked.push(item) })
  const rows = flatten(list).filter(node => node.className.startsWith('u-lrow'))
  assert.equal(rows.length, 2)
  assert.ok(rows[1].className.includes(' on'))
  rows[0].fire('click')
  assert.deepEqual(picked, ['a'])
})

test('a tree nests each node under the parent it names', () => {
  const { ui } = vocabulary()
  const tree = ui.tree({ nodes: [{ id: 'a', title: 'A' }, { id: 'b', parent: 'a', title: 'B' }] })
  const depths = flatten(tree).filter(node => node.className.startsWith('u-trow')).map(row => row.getAttribute('style'))
  assert.deepEqual(depths, ['--depth:0', '--depth:1'])
})

test('a grid states its column count and reports a pick', () => {
  const { ui } = vocabulary()
  const picked = []
  const grid = ui.grid({ items: ['a', 'b', 'c'], cols: 2, onPick: item => picked.push(item) })
  assert.equal(grid.getAttribute('style'), '--cols:2')
  const cells = flatten(grid).filter(node => node.className.startsWith('u-cell'))
  cells[2].fire('click')
  assert.deepEqual(picked, ['c'])
})

test('a thumb without a picture stands in with a glyph', () => {
  const { ui } = vocabulary()
  const stand = ui.thumb('player.obj')
  assert.equal(find(stand, node => node.tagName === 'IMG'), undefined)
  assert.ok(find(stand, node => node.textContent === '·'))
})
