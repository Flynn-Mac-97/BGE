/**
 * `renderer.marks` — a visual drawn beside one entity, contributed by a plugin.
 *
 * The kernel runs a mark without knowing its name: it calls `draw` for every
 * mesh entity and walks the optional frame hooks by name. An empty registry is
 * a length check and nothing else, so a world with no mark pays nothing.
 *
 * The Readability plugin's three marks register through this same door, so the
 * registry is a hook rather than a core-only shortcut. The kernel must not name
 * a keyline, a shadow or a ring; a source scan at the end of this file holds
 * that rule.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRenderer } from '../../../engine/render.js'

const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

const box = (id, extra = {}) => ({ id, type: 'wall', x: 0, y: 0, z: 0, mesh: { box: [1, 1, 1] }, ...extra })

/** The merge settle is 45 frames; run past it so the quiet scan can skip an entity. */
const settle = (frame, world, frames = 50) => {
  for (let index = 0; index < frames; index++) frame.sync(world)
}

test('the registry starts empty, because a mark belongs to a plugin', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  assert.deepEqual(frame.marks.names, [])
})

test('a mark is drawn once per mesh entity, and only for the entities it matches', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const visited = []
  const matched = []
  frame.marks.register('probe', {
    draw(entity, object, place, declared) {
      visited.push(entity.id)
      assert.ok(object, `mark for ${entity.id} gets its object`)
      if (declared?.ring) matched.push(entity.id)
    }
  })

  const world = { entities: [box('a', { mesh: { box: [1, 1, 1], ring: true } }), box('b'), box('c')] }
  frame.sync(world)
  assert.deepEqual(visited, ['a', 'b', 'c'], 'once per entity, in list order')
  assert.deepEqual(matched, ['a'], 'the mark chooses; the kernel calls for all')

  visited.length = 0
  for (const entity of world.entities) entity.x += 1
  frame.sync(world)
  assert.deepEqual(visited, ['a', 'b', 'c'], 'not twice for one entity on one frame')
})

test('remove stops the draw, and leaves any other mark in place', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const seen = []
  frame.marks.register('kept', { draw: () => seen.push('kept') })
  frame.marks.register('dropped', { draw: () => seen.push('dropped') })

  const world = { entities: [box('a')] }
  frame.sync(world)
  assert.deepEqual(seen, ['kept', 'dropped'])

  frame.marks.remove('dropped')
  seen.length = 0
  for (const entity of world.entities) entity.x += 1
  frame.sync(world)
  assert.deepEqual(seen, ['kept'])
  assert.deepEqual(frame.marks.names, ['kept'])
})

test('registration order is draw order, and re-registering keeps a name in place', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const order = []
  frame.marks.register('first', { draw: () => order.push('first') })
  frame.marks.register('second', { draw: () => order.push('second') })
  frame.marks.register('first', { draw: () => order.push('first-again') })

  frame.sync({ entities: [box('a')] })
  assert.deepEqual(order, ['first-again', 'second'])
})

test('the core drives every frame hook a mark carries, without knowing its name', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const seen = {
    begin: 0,
    grow: [],
    draws: [],
    place: 0,
    count: [],
    heldId: [],
    changed: 0,
    holds: 0,
    holdsMoving: 0,
    blocksMerge: 0
  }
  frame.marks.register('lifecycle', {
    begin: () => seen.begin++,
    grow: count => seen.grow.push(count),
    draw: entity => seen.draws.push(entity.id),
    place: () => seen.place++,
    count: stats => seen.count.push(stats.entities),
    heldId: view => {
      seen.heldId.push(view)
      return null
    },
    changed: () => {
      seen.changed++
      return false
    },
    holds: () => {
      seen.holds++
      return false
    },
    holdsMoving: () => {
      seen.holdsMoving++
      return false
    },
    blocksMerge: () => {
      seen.blocksMerge++
      return false
    }
  })

  frame.sync({ entities: [box('a'), box('b')] })

  assert.equal(seen.begin, 1, 'begin runs once, before the walk')
  assert.deepEqual(seen.grow, [2], 'grow is handed the entity count')
  assert.deepEqual(seen.draws, ['a', 'b'], 'draw runs once per entity')
  assert.equal(seen.place, 1, 'place runs once, after the walk')
  assert.deepEqual(seen.count, [2], 'count is handed the frame stats')
  assert.deepEqual(seen.heldId, [VIEW], 'heldId is handed the session view')
  assert.equal(seen.changed, 1)
  assert.equal(seen.holds, 2)
  assert.equal(seen.holdsMoving, 2)
  assert.equal(seen.blocksMerge, 2)
})

test('holds keeps a settled entity on the full pass, so a still world still reaches a mark', async () => {
  const cases = [
    ['no hook', {}, 0],
    ['holds', { holds: () => true }, 6]
  ]
  for (const [label, hook, expected] of cases) {
    const frame = await makeRenderer(null, VIEW, VIEWPORT)
    let draws = 0
    frame.marks.register('probe', { ...hook, draw: () => draws++ })
    const world = { entities: [box('a'), box('b')] }
    settle(frame, world)
    draws = 0
    for (let index = 0; index < 3; index++) frame.sync(world)
    assert.equal(draws, expected, label)
  }
})

test('changed forces exactly one full pass', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  let forced = false
  let draws = 0
  frame.marks.register('probe', { changed: () => forced, draw: () => draws++ })
  const world = { entities: [box('a'), box('b')] }
  settle(frame, world)

  draws = 0
  forced = true
  frame.sync(world)
  assert.equal(draws, 2, 'the forced frame visits both entities')

  forced = false
  draws = 0
  frame.sync(world)
  assert.equal(draws, 0, 'the next unchanged frame skips them again')
})

test('heldId names the one entity every scan must visit', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const seen = []
  frame.marks.register('probe', { heldId: () => 'a', draw: entity => seen.push(entity.id) })
  const world = { entities: [box('a'), box('b')] }
  settle(frame, world)

  seen.length = 0
  for (let index = 0; index < 3; index++) frame.sync(world)
  assert.deepEqual(seen, ['a', 'a', 'a'], 'only the held entity is forced through the full pass')
})

test('move follows an entity the moving scan placed, without a full pass', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const seen = []
  frame.marks.register('probe', {
    // A mark that owns its entity keeps it out of every batch, which is what
    // lets the moving scan answer it instead of the full pass.
    blocksMerge: () => true,
    draw: entity => seen.push(['draw', entity.id]),
    move: entity => seen.push(['move', entity.id])
  })
  const entities = [box('a')]
  const world = {
    entities,
    drawnPlaceInto: (into, entity, blend) => {
      into.x = entity.x * blend
      into.y = entity.y
      into.z = entity.z || 0
      into.yaw = entity.yaw
      return into
    }
  }
  settle(frame, world)
  seen.length = 0
  entities[0].x = 5
  frame.sync(world, 0.5)

  assert.deepEqual(seen, [['move', 'a']], 'the moving scan lets the mark follow the entity')
})

test('blocksMerge keeps a mark-owned entity out of every batch', async () => {
  const cases = [
    ['plain', {}, 8],
    ['blocksMerge', { blocksMerge: () => true }, 0]
  ]
  for (const [label, hook, expected] of cases) {
    const frame = await makeRenderer(null, VIEW, VIEWPORT)
    frame.marks.register('probe', { ...hook, draw: () => {} })
    const world = { entities: Array.from({ length: 8 }, (placeholder, index) => box(`e${index}`)) }
    settle(frame, world, 60)
    assert.equal(frame.stats.merged, expected, label)
  }
})

test('forget reaches a mark that caches by file', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const forgotten = []
  frame.marks.register('probe', { forget: file => forgotten.push(file), draw: () => {} })
  frame.forget('meadow/grass.png')
  assert.deepEqual(forgotten, ['meadow/grass.png'])
})

test('with no mark registered, a sync draws nothing and a later mark starts at the next sync', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  assert.deepEqual(frame.marks.names, [])
  const world = { entities: [box('a')] }

  frame.sync(world)
  assert.equal(frame.stats.entities, 1, 'the world still syncs')

  let drawn = 0
  frame.marks.register('late', { draw: () => drawn++ })
  frame.sync(world)
  assert.equal(drawn, 1, 'registering takes effect on the next sync')
})

test('nothing under engine/ imports the readability modules the plugin owns', () => {
  const engine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'engine')
  const moved = /(readability-marks|keyline-marks|keyline-hull|contact-shadows|ground-rings|floor-mark|ground-band)\.js/
  const found = []
  for (const entry of fs.readdirSync(engine, { recursive: true })) {
    const file = path.join(engine, entry)
    if (!file.endsWith('.js')) continue
    if (moved.test(fs.readFileSync(file, 'utf8'))) found.push(entry)
  }
  assert.deepEqual(found, [], 'the kernel never names a readability mark')
})
