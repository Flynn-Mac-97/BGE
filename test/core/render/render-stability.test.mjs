/**
 * The pass graph's stability guard: thousands of frames leave the graph, its
 * targets and its caches flat; a disabled pass returns to the same frame; a
 * throwing pass leaves the next frame whole; released objects and dropped
 * entities free what they held; a resize leaks no target; and one asset
 * requested many times stays one cached object.
 *
 * Every assertion is a count, an identity or an order. One wall-clock guard is
 * kept, with a budget an order of magnitude above the measured work.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'
import { makePassGraph } from '../../../engine/render/graph.js'
import { makeRenderer } from '../../../engine/render.js'
import { solidGeometry } from '../../../engine/render/geometry-cache.js'
import { cachedTexture, tiledTexture } from '../../../engine/render/texture-cache.js'
import { cachedModel, modelCache, forgetModel } from '../../../engine/render/model-cache.js'
import { makeCountingPool } from './counting-pool.mjs'

const noop = () => {}
const ORTHO = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const viewport = () => ({ width: 320, height: 180 })
const box = id => ({ id, type: 'wall', x: 0, y: 0, z: -5, mesh: { box: [1, 1, 1] } })
const names = graph => graph.passes.map(pass => pass.name)

test('twenty thousand frames leave the order, the targets, the pool and the rebuild count flat', () => {
  const pool = makeCountingPool()
  const graph = makePassGraph({ report: noop, pool })
  graph.add({ name: 'produce', writes: ['x'], target: { format: 'half-float' }, execute: noop })
  graph.add({ name: 'consume', reads: ['x'], execute: noop })
  graph.add({ name: 'present', execute: noop })
  graph.run(null, null, 64, 64)

  const order = graph.passes
  const passes = graph.passes.slice()
  const frame = graph.frame
  const target = graph.targets.get('x')
  const created = pool.created
  const acquired = pool.acquired
  const rebuilds = graph.rebuilds

  const started = performance.now()
  for (let i = 0; i < 20000; i++) graph.run(null, null, 64, 64)
  const elapsed = performance.now() - started

  assert.equal(graph.passes, order, 'the sorted order is the same array')
  assert.deepEqual(graph.passes, passes, 'every pass object is the one that was there')
  assert.equal(graph.frame, frame, 'the frame record is the same object')
  assert.equal(graph.targets.get('x'), target, 'the target keeps its identity')
  assert.equal(pool.created, created, 'no frame made a target')
  assert.equal(pool.acquired, acquired, 'no frame asked the pool for a target')
  assert.equal(graph.rebuilds, rebuilds, 'no frame rebuilt the pass set')

  // Budget: 4000 ms for 20,000 frames of a three-pass graph. The steady path
  // allocates nothing and calls one function per pass, which measures tens of
  // milliseconds here; the budget is far above that for a slow or loaded machine.
  assert.ok(elapsed < 4000, `20,000 steady frames took ${elapsed.toFixed(1)}ms, over the 4s budget`)
})

test('disabling and enabling a pass returns the graph to its baseline', () => {
  const graph = makePassGraph({ report: noop })
  const work = []
  graph.add({
    name: 'produce',
    writes: ['x'],
    target: { format: 'half-float' },
    extract: () => work.push('extract'),
    execute: () => work.push('produce')
  })
  graph.add({ name: 'probe', execute: () => work.push('probe') })
  graph.add({ name: 'present', reads: ['x'], execute: () => work.push('present') })

  graph.run(null, null, 8, 8)
  const baseline = {
    names: names(graph),
    target: graph.targets.get('x'),
    created: graph.pool.created,
    frame: graph.frame,
    work: work.slice(),
    rebuilds: graph.rebuilds
  }

  graph.disable('probe')
  work.length = 0
  graph.run(null, null, 8, 8)
  assert.deepEqual(names(graph), ['produce', 'present'], 'a disabled pass does not run')
  assert.deepEqual(work, ['extract', 'produce', 'present'], 'its callbacks are gone too')

  graph.enable('probe')
  work.length = 0
  graph.run(null, null, 8, 8)

  assert.deepEqual(names(graph), baseline.names, 'the order is the baseline order')
  assert.equal(graph.targets.get('x'), baseline.target, 'the target is the baseline target')
  assert.equal(graph.pool.created, baseline.created, 'no target was made by the round trip')
  assert.equal(graph.frame, baseline.frame, 'the frame record is the baseline record')
  assert.deepEqual(work, baseline.work, 'the frame does the baseline work')
  assert.equal(graph.rebuilds, baseline.rebuilds + 2, 'the off and on each rebuilt once, and no more')
})

test('a pass that throws leaves the graph able to run the next frame', () => {
  const graph = makePassGraph({ report: noop })
  const ran = []
  let broken = true
  graph.add({ name: 'before', execute: () => ran.push('before') })
  graph.add({
    name: 'broken',
    execute: () => {
      if (broken) throw new Error('a broken pass')
      ran.push('broken')
    }
  })
  graph.add({ name: 'after', execute: () => ran.push('after') })

  const order = graph.passes
  const frame = graph.frame
  const rebuilds = graph.rebuilds
  const created = graph.pool.created

  // The error reaches the caller, because a frame that quietly half-drew is the
  // failure this engine refuses. What is contained is the graph's own state.
  assert.throws(() => graph.run(null, null, 8, 8), /a broken pass/)
  assert.deepEqual(ran, ['before'], 'the passes after the throw did not run')

  broken = false
  ran.length = 0
  graph.run(null, null, 8, 8)

  assert.deepEqual(ran, ['before', 'broken', 'after'], 'the next frame ran every pass, in order')
  assert.equal(graph.passes, order, 'the order survived the throw')
  assert.equal(graph.frame, frame, 'the frame record survived the throw')
  assert.equal(graph.rebuilds, rebuilds, 'the throw did not force a rebuild')
  assert.equal(graph.pool.created, created, 'the throw made no target')
})

test('dispose frees a plugin object and its children, and the sweep frees a dropped entity', async () => {
  const frame = await makeRenderer(null, ORTHO, viewport())

  const group = new THREE.Group()
  const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
  group.add(child)
  let groupFreed = 0
  let childFreed = 0
  group.addEventListener('dispose', () => groupFreed++)
  child.addEventListener('dispose', () => childFreed++)
  frame.scene.add(group)
  frame.dispose(group)
  assert.equal(groupFreed, 1, 'the plugin object is released')
  assert.equal(childFreed, 1, 'its child is released too')

  const entity = box('a')
  frame.sync({ entities: [entity] })
  const object = frame.objectFor(entity)
  let entityFreed = 0
  object.addEventListener('dispose', () => entityFreed++)
  frame.sync({ entities: [] })
  assert.equal(entityFreed, 1, 'the sweep released the object that left the world')
  assert.equal(frame.objectFor(entity), null, 'nothing answers for the dropped entity')

  // A hundred add-and-drop cycles must leave the scene as it was: a release that
  // only disposed but did not remove would stack an object per cycle.
  const settled = frame.scene.children.length
  for (let i = 0; i < 100; i++) {
    frame.sync({ entities: [box(`t${i}`)] })
    frame.sync({ entities: [] })
  }
  assert.equal(frame.scene.children.length, settled, 'a hundred dropped entities left nothing behind')
})

test('repeated resize resizes targets in place and leaks none', () => {
  const graph = makePassGraph({ report: noop })
  graph.add({ name: 'produce', writes: ['x'], target: { scale: 0.5 }, execute: noop })
  graph.add({ name: 'consume', reads: ['x'], execute: noop })
  graph.run(null, null, 100, 50)

  const target = graph.targets.get('x')
  const created = graph.pool.created
  let lastWidth = 100
  for (let width = 120; width < 400; width += 7) {
    lastWidth = width
    graph.run(null, null, width, 50)
    assert.equal(graph.pool.created, created, `a resize to ${width} made no target`)
    assert.equal(graph.targets.get('x'), target, 'the same target is resized in place')
  }
  assert.equal(target.width, Math.round(lastWidth * 0.5), 'the target holds the last width')
})

test('one geometry size requested many times stays one geometry', () => {
  const geometry = solidGeometry('box', 1, 1, 1)
  const sphere = solidGeometry('sphere', 1, 1, 1)
  for (let i = 0; i < 100; i++) {
    assert.equal(solidGeometry('box', 1, 1, 1), geometry, 'one size, one geometry')
    assert.equal(solidGeometry('sphere', 1, 1, 1), sphere, 'one sphere size, one geometry')
  }
  assert.notEqual(solidGeometry('box', 2, 1, 1), geometry, 'a different size is a different geometry')
})

test('one texture and one tiling requested many times stay one cached texture', () => {
  withImageDocument(() => {
    const world = cachedTexture('wall.png', 'world')
    const tiled = tiledTexture('wall.png', 'world', 2, 2)
    for (let i = 0; i < 100; i++) {
      assert.equal(cachedTexture('wall.png', 'world'), world, 'one request, one texture')
      assert.equal(tiledTexture('wall.png', 'world', 2, 2), tiled, 'one tiling, one texture')
    }
    assert.notEqual(cachedTexture('wall.png', 'sprite'), world, 'a different reading is a different texture')
    assert.notEqual(tiledTexture('wall.png', 'world', 3, 3), tiled, 'a different tiling is a different texture')
  })
})

test('one model file requested many times stays one cache entry', () => {
  for (let i = 0; i < 50; i++) cachedModel('hero.glb', noop, noop)
  assert.equal(modelCache.size, 1, 'fifty requests for one file made one entry')

  forgetModel('hero.glb')
  assert.equal(modelCache.size, 0, 'forget drops the entry')
  cachedModel('hero.glb', noop, noop)
  cachedModel('hero.glb', noop, noop)
  assert.equal(modelCache.size, 1, 'the cache holds one entry per file, not per request')
})

/**
 * Install the image element three's texture loader asks the document for, so a
 * texture can be cached with no browser. The element never fires a load, so the
 * texture stays in the cache; only the cache keying is under test, not upload.
 */
function withImageDocument(run) {
  const saved = globalThis.document
  globalThis.document = {
    createElementNS: () => ({
      complete: false,
      addEventListener() {},
      removeEventListener() {},
      set src(value) {
        this._src = value
      },
      get src() {
        return this._src
      }
    })
  }
  try {
    return run()
  } finally {
    if (saved === undefined) delete globalThis.document
    else globalThis.document = saved
  }
}
