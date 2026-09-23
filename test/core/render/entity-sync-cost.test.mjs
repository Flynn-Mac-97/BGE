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
    const world = { entities: Array.from({ length: size }, (_, at) => box(`e${at}`)) }
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
