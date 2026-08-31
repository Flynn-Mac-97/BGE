/**
 * Lane View, proved without a browser.
 *
 * The two rules worth a test are the ones a critic failed twice on other rows:
 * the viewer must refuse to send a write, and a missing capture must never be
 * filled in with the schematic.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import plugin, { askBody, laneView } from '../plugins/builtin/lane-view.js'

const described = {
  project: 'kitten-survivors',
  level: 'level1',
  viewport: { width: 540, height: 960 },
  camera: { mode: 'ortho' },
  counts: { visible: 2 },
  palette: { rat: '#ff3366' },
  visible: [
    { id: 'rat-1', type: 'rat', at: [40, 60], size: [10, 20], depth: 5 },
    { id: 'wall-1', type: 'wall', at: [70, 30], size: [8, 8], depth: 9, hull: [[66, 26], [74, 26], [74, 34]] }
  ]
}

const watching = (now, overrides = {}) => ({
  client: 'lane-a', shown: described, shownAt: now, answering: true, why: null,
  frame: null, frameWhy: null, ...overrides
})

test('the guide names every command the plugin registers', () => {
  const ids = plugin.commands.map(command => command.id)
  assert.deepEqual(ids, ['lane.view', 'lane.watch', 'lane.report'])
})

test('a read is sent as the CLI sends it', () => {
  assert.deepEqual(askBody('lane-a', 'see.describe', { about: false }),
    { op: 'run', args: ['see.describe', { about: false }], client: 'lane-a', timeout: 4000 })
  assert.deepEqual(askBody('lane-a', 'snapshot'),
    { op: 'snapshot', args: [], client: 'lane-a', timeout: 4000 })
})

test('every write is refused, by name', () => {
  for (const verb of ['set', 'spawn', 'destroy', 'play', 'saveLevel', 'eval']) {
    assert.throws(() => askBody('lane-a', verb), /read only/, `${verb} was not refused`)
  }
  assert.throws(() => askBody('', 'snapshot'), /name its client/)
})

test('the schematic is drawn from the reported geometry, not invented', () => {
  const now = Date.now()
  const view = laneView(watching(now), now)
  const svg = decodeURIComponent(view.schematic.image.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))
  assert.match(svg, /viewBox="0 0 100 100"/)
  assert.match(svg, /width="540" height="960"/)
  // The box entity keeps its reported centre and size; the hull entity keeps its points.
  assert.match(svg, /x="35" y="50" width="10" height="20"/)
  assert.match(svg, /points="66,26 74,26 74,34"/)
  assert.match(svg, /#ff3366/)
})

test('a lane that stopped answering is dated and grey, never live', () => {
  const now = Date.now()
  const view = laneView(watching(now, { answering: false, why: 'no reply' }), now)
  assert.equal(view.dated, true)
  assert.equal(view.answering, false)
  assert.match(view.schematic.label, /DATED/)
  const svg = decodeURIComponent(view.schematic.image)
  assert.equal(svg.includes('#ff3366'), false, 'a dated diagram must drop the live palette')

  // Answering, but the last read is older than the stale window.
  const old = laneView(watching(now - 9000), now)
  assert.equal(old.dated, true)
})

test('no capture stays no capture — the schematic never fills the frame panel', () => {
  const now = Date.now()
  const view = laneView(watching(now, { frameWhy: 'this lane has captured nothing' }), now)
  assert.equal(view.frame.url, undefined)
  assert.match(view.frame.label, /no frame yet/)
  assert.equal(view.frame.why, 'this lane has captured nothing')
  assert.ok(view.schematic.image, 'the schematic itself is still shown')
})

test('both halves are labelled as what they are, and dated', () => {
  const now = Date.now()
  const frame = { url: 'api/lane-frame?client=lane-a&frame=x.png', at: now - 3000, bytes: 2048, how: 'first seen' }
  const view = laneView(watching(now - 1000, { frame }), now)
  assert.match(view.schematic.label, /^SCHEMATIC — a diagram of reported state, not a frame/)
  assert.match(view.schematic.label, /s old$/)
  // The route sends no date for a frame, so the label says which date it carries.
  assert.match(view.frame.label, /^CAPTURE — a real frame this lane wrote · first seen \d\d:\d\d:\d\d/)
  assert.match(view.frame.label, /2 kB$/)
  assert.notEqual(view.frame.url, view.schematic.image)
  // ui.picture prefixes a slash onto any source that is not a data URL.
  assert.equal(view.frame.url.startsWith('/'), false)
  assert.equal(view.schematic.image.startsWith('data:image/svg+xml'), true)
})

test('a lane with nothing reported says so rather than drawing an empty world', () => {
  const view = laneView(undefined)
  assert.equal(view.schematic.image, undefined)
  assert.match(view.schematic.label, /nothing reported yet/)
  assert.equal(view.frame.url, undefined)
})
