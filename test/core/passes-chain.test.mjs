/**
 * `renderer.passes` — the ordered post-processing chain.
 *
 * The chain is an ordered list and nothing more. `set` replaces the whole list
 * and is destructive; `add` and `remove` work one named effect at a time, so a
 * second caller cannot delete the first caller's chain. An empty list means no
 * chain at all: the scene draws straight to the canvas and no target is built.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from '../../engine/render.js'

const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

const effect = name => ({ name, apply: colour => colour })
const names = frame => frame.passes.list.map(one => one.name)

test('the list starts empty, and set stores the chain in order', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  assert.deepEqual(frame.passes.list, [])

  frame.passes.set([effect('first'), effect('second')])
  assert.deepEqual(names(frame), ['first', 'second'])
})

test('add places a named effect by order, and without an order goes last', async () => {
  const cases = [
    ['empty list', [], { order: 5 }, ['probe']],
    ['after the tail', ['base'], { order: 5 }, ['base', 'probe']],
    ['before the head', ['base'], { order: -1 }, ['probe', 'base']],
    ['no order goes last', ['base'], {}, ['base', 'probe']],
    ['equal order goes after', ['base'], { order: 0 }, ['base', 'probe']]
  ]
  for (const [label, start, options, expected] of cases) {
    const frame = await makeRenderer(null, VIEW, VIEWPORT)
    frame.passes.set(start.map(effect))
    frame.passes.add('probe', effect('probe'), options)
    assert.deepEqual(names(frame), expected, label)
  }
})

test('remove takes only the named effect out of the chain', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  frame.passes.set([effect('a'), effect('b'), effect('c')])
  frame.passes.remove('b')
  assert.deepEqual(names(frame), ['a', 'c'])
})

test('adding a name that is already in the chain replaces it, so it draws once', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  frame.passes.set([effect('base')])
  frame.passes.add('base', effect('base'), { order: 3 })
  assert.deepEqual(names(frame), ['base'])
})

test('two callers cannot destroy each other, because add and remove touch one name', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  // The Post Processing plugin owns the chain and states it with the one
  // destructive door.
  frame.passes.set([effect('tone'), effect('bloom')])
  // A second plugin adds its own effect without replacing the chain.
  frame.passes.add('grain', effect('grain'), { order: 10 })
  assert.deepEqual(names(frame), ['tone', 'bloom', 'grain'])

  frame.passes.remove('grain')
  assert.deepEqual(names(frame), ['tone', 'bloom'], 'the first caller chain survives')
})

test('an empty list is no chain: the world draws directly and no target is built', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  let sceneDraws = 0
  const render = frame.threeRenderer.render
  frame.threeRenderer.render = (scene, camera) => {
    if (scene === frame.scene) sceneDraws++
    return render.call(frame.threeRenderer, scene, camera)
  }
  frame.passes.set([])
  frame.sync({ entities: [{ id: 'a', type: 'wall', x: 0, y: 0, z: 0, mesh: { box: [1, 1, 1] } }] })
  frame.draw()

  assert.equal(sceneDraws, 1, 'the scene draws straight to the canvas')
  assert.equal(frame.stats.post, 'none')
})
