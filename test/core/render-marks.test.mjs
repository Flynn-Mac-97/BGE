/**
 * The renderer's plugin surface: the mark registry, `objectFor` and a
 * non-destructive pass list.
 *
 * The surface is the contract a plugin builds on, so it is driven here with no
 * GL context. The three built-in marks register through the same door, which is
 * what makes it a hook rather than a core-only shortcut.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from '../../engine/render.js'

const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

const box = (id, x = 0) => ({ id, type: 'wall', x, y: 0, z: 0, mesh: { box: [1, 1, 1] } })

test('the three built-in marks register through the same door a plugin uses', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  assert.deepEqual(frame.marks.names, ['keyline', 'contactShadow', 'groundRing'])
})

test('a mark draws once per matching entity, and removing it stops the draw', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const drawn = new Map()
  frame.marks.register('probe', {
    draw(entity, object, place, declared) {
      if (declared?.box) drawn.set(entity.id, (drawn.get(entity.id) ?? 0) + 1)
    }
  })

  const world = { entities: [box('a'), box('b'), box('c')] }
  frame.sync(world)
  assert.deepEqual([...drawn.keys()].sort(), ['a', 'b', 'c'])
  assert.deepEqual([...drawn.values()], [1, 1, 1], 'once per entity, not once per mark or frame')

  // Every entity moves, so the next sync visits all three again.
  drawn.clear()
  for (const entity of world.entities) entity.x += 1
  frame.sync(world)
  assert.equal(drawn.size, 3)

  frame.marks.remove('probe')
  drawn.clear()
  for (const entity of world.entities) entity.x += 1
  frame.sync(world)
  assert.equal(drawn.size, 0, 'a removed mark is not drawn again')
})

test('objectFor answers with the scene object the sync built for an entity', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const one = box('one')
  frame.sync({ entities: [one] })

  const object = frame.objectFor(one)
  assert.ok(object, 'the entity has an object once it is synced')
  assert.equal(object.userData.entity, 'one')
  assert.equal(frame.objectFor(box('missing')), null)
})

test('passes.add leaves the chain alone and remove takes only its own name', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const effect = name => ({ name, apply: colour => colour })
  frame.passes.set([effect('base')])

  frame.passes.add('extra', effect('extra'), { order: 5 })
  assert.deepEqual(frame.passes.list.map(one => one.name), ['base', 'extra'])

  frame.passes.add('front', effect('front'), { order: -1 })
  assert.deepEqual(frame.passes.list.map(one => one.name), ['front', 'base', 'extra'], 'order places the effect')

  frame.passes.remove('extra')
  assert.deepEqual(frame.passes.list.map(one => one.name), ['front', 'base'], 'the rest of the chain is untouched')
})
