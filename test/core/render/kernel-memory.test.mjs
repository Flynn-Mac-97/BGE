/**
 * The kernel's GPU memory is reported, bounded and freed.
 *
 * The target pool reports the targets it holds and the bytes they occupy. It
 * holds a ceiling a runaway pass set cannot pass, reporting once and culling the
 * pass rather than allocating without bound. `release` drops the pooled targets
 * and clears the module-level texture and model caches, so a later use rebuilds
 * instead of reusing what the finished renderer held.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { TARGET_CEILING_BYTES } from '../../../engine/render/target-pool.js'
import { makePassGraph } from '../../../engine/render/graph.js'
import { makeRenderer } from '../../../engine/render.js'
import { cachedTexture } from '../../../engine/render/texture-cache.js'
import { cachedModel, modelCache } from '../../../engine/render/model-cache.js'
import { withImageDocument } from './image-document.mjs'

const noop = () => {}
const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }

test('the pool reports the targets and bytes a plan implies, and returns to zero when it empties', () => {
  const graph = makePassGraph({ report: noop })
  graph.add({ name: 'colour', writes: ['plate'], target: { format: 'half-float' }, execute: noop })
  graph.add({ name: 'depth', writes: ['z'], target: { kind: 'depth' }, execute: noop })
  graph.add({ name: 'read', reads: ['plate', 'z'], execute: noop })
  graph.run(null, null, 64, 64)

  // 64x64: half-float colour is four channels of two bytes plus four depth
  // bytes; a depth resource is four colour bytes plus four depth bytes.
  const colourBytes = 64 * 64 * (4 * 2 + 4)
  const depthBytes = 64 * 64 * (4 * 1 + 4)
  assert.deepEqual(graph.pool.usage, { targets: 2, bytes: colourBytes + depthBytes })

  graph.remove('colour')
  graph.remove('depth')
  graph.remove('read')
  graph.run(null, null, 64, 64)
  assert.deepEqual(graph.pool.usage, { targets: 0, bytes: 0 }, 'an emptied pass set gives every target back')
})

test('fifty full-size passes fit under the ceiling, and a runaway pass set is culled and reported once', () => {
  // The benchmark's worst case: fifty distinct passes, each with its own target,
  // at the 1280x720 viewport. Aliasing usually makes this one target; the
  // distinct scales here force fifty, which is the number the ceiling must clear.
  const legit = makePassGraph({ report: noop })
  for (let at = 0; at < 50; at++) {
    legit.add({
      name: `probe${at}`,
      always: true,
      writes: [`colour${at}`],
      target: { format: 'half-float', scale: 1 + at / 1000 },
      execute: noop
    })
  }
  legit.run(null, null, 1280, 720)
  assert.equal(legit.pool.usage.targets, 50, 'every legitimate pass got its target')
  assert.ok(legit.pool.usage.bytes < TARGET_CEILING_BYTES, 'fifty legitimate passes sit under the ceiling')

  // Enough distinct full-size targets to pass one GiB. The pool refuses the
  // rest, reports the ceiling once, and the graph runs no pass without a target.
  const said = []
  const heavy = makePassGraph({ report: message => said.push(message) })
  for (let at = 0; at < 120; at++) {
    heavy.add({
      name: `probe${at}`,
      always: true,
      writes: [`colour${at}`],
      target: { format: 'half-float', scale: 1 + at / 1000 },
      execute: noop
    })
  }
  heavy.run(null, null, 1280, 720)
  heavy.run(null, null, 1280, 720)
  assert.equal(said.length, 1, 'the ceiling is reported once, not once per target or per frame')
  assert.match(said[0], /ceiling/)
  assert.ok(heavy.pool.usage.bytes <= TARGET_CEILING_BYTES, 'the pool never passes its ceiling')
  assert.ok(heavy.pool.usage.targets < 120, 'the targets past the ceiling were culled')
})

test('release drops the pooled targets and clears the texture and model caches', async () => {
  const renderer = await makeRenderer(null, VIEW, { width: 64, height: 64 })
  renderer.graph.add({ name: 'plate', writes: ['plate'], target: { format: 'half-float' }, execute: noop })
  renderer.graph.add({ name: 'read', reads: ['plate'], execute: noop })
  renderer.draw({ entities: [] })
  assert.equal(renderer.graph.pool.usage.targets, 1, 'the frame pooled its target')
  assert.ok(renderer.graph.pool.usage.bytes > 0)

  withImageDocument(() => {
    const texture = cachedTexture('wall.png', 'world')
    assert.equal(cachedTexture('wall.png', 'world'), texture, 'the texture is cached before release')
    cachedModel('hero.glb', noop, noop)
    assert.equal(modelCache.size, 1, 'the model is cached before release')

    renderer.release()

    assert.deepEqual(renderer.graph.pool.usage, { targets: 0, bytes: 0 }, 'release drops the pooled targets')
    assert.equal(modelCache.size, 0, 'release clears the model cache')
    assert.notEqual(cachedTexture('wall.png', 'world'), texture, 'a later texture request rebuilds')
    cachedModel('hero.glb', noop, noop)
    assert.equal(modelCache.size, 1, 'a later model request rebuilds')
  })
})
