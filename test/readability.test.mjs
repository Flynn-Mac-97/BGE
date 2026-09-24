/**
 * The Readability plugin owns the three marks and the keys a level declares.
 *
 * The kernel holds only the `marks` registry, so these cases drive the plugin
 * through `makeRenderer` the way the loader does and check what it registered
 * and what the frame counted. The keys `mesh.keyline`, `mesh.shadow` and
 * `mesh.ring` are this plugin's, so nothing here imports the kernel for them.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from '../engine/render.js'
import readability from '../plugins/builtin/readability.js'
import { makeReadability } from '../plugins/builtin/readability/marks.js'

const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

/** A renderer with the plugin loaded, as the loader does it after the screen exists. */
async function withReadability() {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  readability.onLoad({ renderer: frame })
  return frame
}

const body = (id, mesh, extra = {}) => ({ id, type: 'actor', x: 0, y: 0, z: 0, mesh, ...extra })

test('loading the plugin registers the three marks through renderer.marks', async () => {
  const frame = await withReadability()
  assert.deepEqual(frame.marks.names, ['keyline', 'contactShadow', 'groundRing'])
})

test('a second load of the same renderer registers nothing twice', async () => {
  const frame = await withReadability()
  readability.onLoad({ renderer: frame })
  assert.deepEqual(frame.marks.names, ['keyline', 'contactShadow', 'groundRing'])
})

test('the defaults land on renderer.readability, in place', async () => {
  const frame = await withReadability()
  assert.deepEqual(frame.readability, makeReadability())
})

test('a mesh that declares a mark gets all three, and the frame counts them', async () => {
  const frame = await withReadability()
  const actor = body('player', { box: [1, 1, 1], keyline: 3, shadow: 1.2, ring: 2 })
  frame.sync({ entities: [actor] })

  const object = frame.objectFor(actor)
  assert.ok(object.children.some(child => child.userData.keyline === true), 'the keyline hangs off the object')
  assert.equal(frame.stats.keylines, 1)
  assert.equal(frame.stats.contactShadows, 1)
  assert.equal(frame.stats.groundRings, 1)
})

test('an entity that never moved and declares nothing gets no keyline', async () => {
  const frame = await withReadability()
  const still = body('wall', { box: [3, 3, 0.4] })
  frame.sync({ entities: [still] })
  assert.equal(frame.stats.keylines, 0)
  assert.ok(!frame.objectFor(still).children.some(child => child.userData.keyline === true))
})

test('a keyline is opt-in: the default width for a moving thing is zero', async () => {
  const frame = await withReadability()
  assert.equal(frame.readability.keyline, 0)
})

test('declaring keyline 0 turns one entity\'s outline off', async () => {
  const frame = await withReadability()
  const actor = body('actor', { box: [1, 1, 1], keyline: 0 })
  frame.sync({ entities: [actor] })
  assert.equal(frame.stats.keylines, 0)
})

test('a removed mark stops being drawn, and the plugin puts it back', async () => {
  const frame = await withReadability()
  frame.marks.remove('groundRing')
  assert.deepEqual(frame.marks.names, ['keyline', 'contactShadow'])

  const actor = body('player', { box: [1, 1, 1], ring: 2 })
  frame.sync({ entities: [actor] })
  assert.equal(frame.stats.groundRings, 0, 'the rule is not drawn and is not counted')
})

test('readability turned to zero removes the outlines already drawn', async () => {
  const frame = await withReadability()
  const actor = body('mover', { box: [1, 1, 1], keyline: 3 })
  frame.sync({ entities: [actor] })
  assert.equal(frame.stats.keylines, 1)

  frame.readability.keyline = 0
  actor.mesh = { box: [1, 1, 1] }
  frame.sync({ entities: [actor] })
  assert.equal(frame.stats.keylines, 0)
})
