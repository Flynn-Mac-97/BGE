/**
 * Game UI world space: which anchors a frame draws, where, and what each is
 * given. The projection is a fake, so culling is checked with no renderer.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeBus } from '../engine/bus.js'
import gameUi from '../plugins/builtin/game-ui.js'
import { makeAnchor } from '../plugins/builtin/game-ui/records.js'
import { placeAnchors, pruneHidden, resolveTarget, transformOf } from '../plugins/builtin/game-ui/world-layer.js'

const viewport = { width: 800, height: 600 }
const view = { x: 0, y: 0, z: 0 }

/** A projection that puts world (x, y) at pixel (x, y), z ignored, and calls z > 100 behind the camera. */
const project = (x, y, z) => ({ x, y, behind: z > 100 })

const entry = (id, point, options = {}) => ({ id, anchor: makeAnchor({ html: id, ...options }, 0), entity: null, point })
const idsOf = placed => placed.map(placement => placement.id)

test('an anchor behind the camera, off screen, or beyond its maxDistance is not placed', () => {
  const entries = [
    entry('front', [100, 100, 0]),
    entry('behind', [100, 100, 500]),
    entry('off', [2000, 100, 0]),
    entry('edge', [830, 100, 0]),
    entry('far', [300, 300, 0], { maxDistance: 100 })
  ]
  assert.deepEqual(idsOf(placeAnchors(entries, { project, view, viewport, limit: 10 })), ['front', 'edge'], 'a margin keeps one that is about to slide in')
})

test('past the limit the nearest to the view are kept, nearest first', () => {
  const entries = [entry('far', [500, 500, 0]), entry('near', [10, 10, 0]), entry('middle', [200, 100, 0])]
  assert.deepEqual(idsOf(placeAnchors(entries, { project, view, viewport, limit: 2 })), ['near', 'middle'])
  assert.deepEqual(idsOf(placeAnchors(entries, { project, view, viewport, limit: 3 })), ['far', 'near', 'middle'], 'under the limit nothing is sorted or dropped')
})

test('a target is an entity id, an entity, a point, or a function of one of them', () => {
  const enemy = { id: 'e1', x: 3, y: 4, z: 5 }
  const world = { byId: id => (id === 'e1' ? enemy : undefined) }
  assert.deepEqual(resolveTarget('e1', world), { entity: enemy, point: [3, 4, 5], isGone: false })
  assert.deepEqual(resolveTarget(enemy, world).point, [3, 4, 5])
  assert.deepEqual(resolveTarget([1, 2], world).point, [1, 2, 0], 'a flat point has z 0')
  assert.equal(resolveTarget(() => enemy, world).entity, enemy)
  assert.equal(resolveTarget('e2', world).isGone, true, 'an entity that is gone ends its anchor')
  assert.equal(resolveTarget(() => 'e2', world).isGone, false, 'a function that names nobody hides the anchor, and may name someone later')
  assert.equal(resolveTarget(() => null, world).point, null)
})

test('the transform puts the pivot on the pixel and scales about it', () => {
  const anchor = makeAnchor({ html: '', pivot: [0.5, 1], scaleByDistance: 10 }, 0)
  assert.equal(transformOf(anchor, { x: 100.4, y: 50.6, distance: 20 }), 'translate3d(100px, 51px, 0) scale(0.50) translate(-50%, -100%)')
  assert.match(transformOf(makeAnchor({ html: '' }, 0), { x: 1, y: 2, distance: 999 }), /scale\(1\.00\)/, 'no scaleByDistance, no scaling')
})

test('an anchor reads, lists controls, and runs handlers with the entity it follows', () => {
  const enemy = { id: 'e1', x: 0, y: 0, z: 0, name: 'Wolf' }
  const context = { bus: makeBus(), world: { byId: id => (id === 'e1' ? enemy : undefined) } }
  gameUi.onLoad(context)
  const seen = []
  context.gameUi.anchor('tag:e1', {
    to: 'e1',
    html: entity => `<b>${entity.name}</b>` + context.gameUi.kit.target('inspect', { action: 'inspect', value: entity.id }),
    on: { inspect: (value, event) => seen.push([value, event.entity.name, event.id]) }
  })
  assert.equal(context.gameUi.read('tag:e1'), 'Wolf inspect')
  assert.deepEqual(context.gameUi.shown(), ['tag:e1'])
  assert.equal(context.gameUi.click('tag:e1', 'inspect'), true)
  gameUi.systems.find(system => system.phase === 'fixed').run(null, 1 / 60, context)
  assert.deepEqual(seen, [['e1', 'Wolf', 'tag:e1']])
  assert.equal(context.gameUi.hide('tag:e1'), true)
  assert.deepEqual(context.gameUi.shown(), [])
})

test('an anchor and a panel of one id replace each other, and a run ending clears both', () => {
  const context = { bus: makeBus(), world: { byId: () => undefined } }
  gameUi.onLoad(context)
  context.gameUi.show('a', { html: 'panel' })
  context.gameUi.anchor('a', { to: [0, 0, 0], html: 'anchor' })
  assert.equal(context.gameUi.read('a'), 'anchor')
  context.gameUi.show('b', { html: 'panel' })
  context.bus.emit('play:stopped')
  assert.deepEqual(context.gameUi.shown(), [])
})

test('hidden anchors lose their elements once the layer holds more than it should, and get one again when drawn', () => {
  const made = () => { const anchor = makeAnchor({ html: '' }, 0); anchor.element = { remove() {} }; anchor.isHidden = true; anchor.written = 'x'; return anchor }
  const shown = makeAnchor({ html: '' }, 0)
  shown.element = { remove() {} }
  shown.isHidden = false
  const hidden = [made(), made()]
  const layer = { root: { childElementCount: 3 } }
  pruneHidden(layer, [shown, ...hidden], 3)
  assert.ok(hidden.every(anchor => anchor.element), 'at the limit nothing is dropped')
  layer.root.childElementCount = 4
  pruneHidden(layer, [shown, ...hidden], 3)
  assert.ok(hidden.every(anchor => anchor.element === null && anchor.written === null), 'over it, hidden ones go')
  assert.ok(shown.element, 'and a drawn one stays')
})
