/**
 * The entity sync's cost, proved by per-entity visits rather than a stopwatch.
 *
 * The render benchmark found the sync is the kernel's largest stage at ten
 * thousand entities. Its steady walk visits each entity once, so its cost is
 * linear in the entity count; a change that made the walk quadratic, or that ran
 * a mark twice per entity, would multiply the visits. A mark that answers `holds`
 * forces every entity onto the full pass, which makes the walk countable through
 * the public marks door with no GL context.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from '../../../engine/render.js'

const ORTHO = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const viewport = () => ({ width: 320, height: 180 })
const box = id => ({ id, type: 'wall', x: 0, y: 0, z: -5, mesh: { box: [1, 1, 1] } })

test('the steady walk visits every entity exactly once, so ten times the entities cost ten times the visits', async () => {
  const frame = await makeRenderer(null, ORTHO, viewport())
  let visits = 0
  frame.marks.register('count-visits', {
    draw() {
      visits++
    },
    // Every entity takes the full pass, so the mark sees each walk the kernel makes.
    holds: () => true,
    holdsMoving: () => true
  })

  const sizes = [1, 1000, 10000]
  const counted = []
  for (const size of sizes) {
    const world = { entities: Array.from({ length: size }, (unused, index) => box(`e${index}`)) }
    frame.sync(world)
    visits = 0
    frame.sync(world)
    assert.equal(frame.stats.entities, size, `${size} entities are in the frame's count`)
    assert.equal(visits, size, `${size} entities cost ${size} visits, not more`)
    counted.push(visits)
  }

  assert.deepEqual(
    counted,
    sizes,
    'the walk is linear: a hundred times the entities is never a hundred times the visits per entity'
  )
})

test('the walk belongs to the scene pass: replacing or disabling it runs no walk', async () => {
  const frame = await makeRenderer(null, ORTHO, viewport())
  let visits = 0
  frame.marks.register('count-visits', {
    draw() {
      visits++
    },
    holds: () => true,
    holdsMoving: () => true
  })

  const world = { entities: [box('a'), box('b')] }
  frame.sync(world)
  assert.equal(visits, 2, 'the default scene pass walks the world')
  assert.equal(frame.stats.entities, 2, 'and reports what it walked')

  // A plugin that draws the scene its own way replaces the pass, so the
  // engine's walk goes with it.
  frame.graph.replace('scene', { extract: () => {}, execute: () => {} })
  visits = 0
  frame.draw(world)
  assert.equal(visits, 0, 'the replaced scene pass does not run the engine walk')

  // A disabled pass is dropped from the run entirely, so neither its walk nor
  // its draw happens.
  frame.graph.disable('scene')
  visits = 0
  frame.draw(world)
  assert.equal(visits, 0, 'a disabled scene pass runs no walk')
})

test('a sync then a draw is one walk, not two', async () => {
  const frame = await makeRenderer(null, ORTHO, viewport())
  let visits = 0
  frame.marks.register('count-visits', {
    draw() {
      visits++
    },
    holds: () => true,
    holdsMoving: () => true
  })

  const world = { entities: [box('a'), box('b')] }
  frame.sync(world)
  const walked = visits
  assert.equal(walked, 2, 'the sync walked the world')
  frame.draw()
  assert.equal(visits, walked, 'the draw reused the extract instead of walking again')
})
