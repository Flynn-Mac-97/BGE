/**
 * `world.byId` answers in one probe of an id index, not a scan of the entity list.
 *
 * The Lights plugin calls `byId` for every scene child every frame, so a scan
 * there is quadratic — the largest single per-frame cost the render benchmark
 * measures. The lookup is proved O(1) by counting the index probes it makes, not
 * by timing it: a clock measures the machine, not the shape of the code.
 *
 * The index is keyed by id, and a level load renames each entity at the end of
 * the load, so every path that adds, removes, replaces or renames an entity is
 * checked here: spawn, destroy, clear, restore, and the rename the loader makes.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

import { makeWorld } from '../../../engine/world.js'
import { makeBus } from '../../../engine/bus.js'
import { startWorldInNode } from '../../../engine/start-world-node.mjs'
import { CHECKOUT, temporaryProject } from '../../fixture-project.mjs'

/** Run a body with every `Map.get` counted, so a lookup's probes can be read. */
function countIndexProbes(body) {
  const realGet = Map.prototype.get
  let probes = 0
  Map.prototype.get = function (...args) {
    probes++
    return realGet.apply(this, args)
  }
  try {
    body()
  } finally {
    Map.prototype.get = realGet
  }
  return probes
}

test('byId makes one index probe per lookup, whatever the entity count', () => {
  for (const count of [8, 4000]) {
    const world = makeWorld(makeBus())
    for (let index = 0; index < count; index++) world.spawn('crate', { id: `crate-${index}` })

    const found = []
    const probes = countIndexProbes(() => {
      for (let index = 0; index < count; index++) found.push(world.byId(`crate-${index}`))
      found.push(world.byId('no-such-id'))
    })

    assert.equal(found.length, count + 1)
    for (let index = 0; index < count; index++)
      assert.equal(found[index].id, `crate-${index}`, `crate-${index} is found`)
    assert.equal(found[count], undefined, 'an id no live entity has answers undefined, as find did')
    assert.equal(probes, count + 1, `one probe per lookup at ${count} entities, got ${probes}`)
  }
})

test('byId follows an entity through spawn, destroy and restore', () => {
  const world = makeWorld(makeBus())

  const crate = world.spawn('crate', { id: 'crate-0' })
  assert.equal(world.byId('crate-0'), crate, 'a spawned entity is found by id')

  const thrown = world.spawn('crate', { id: 'crate-1' })
  world.destroy(thrown)
  assert.equal(world.byId('crate-1'), undefined, 'a destroyed entity is not found')

  const coins = [world.spawn('coin', { id: 'coin-0' }), world.spawn('coin', { id: 'coin-1' })]
  const mark = world.capture()
  world.destroy(coins[0])
  world.spawn('coin', { id: 'coin-2' })
  world.restore(mark)

  // A destroyed entity comes back as a new object under its own id: nothing can
  // bring the discarded object back, and everything holding it has to look it
  // up again. An entity that was never destroyed keeps its identity.
  assert.equal(world.byId('coin-0').id, 'coin-0', 'the destroyed entity is found again by its id')
  assert.notEqual(world.byId('coin-0'), coins[0], 'as the new object standing in for it')
  assert.equal(world.byId('coin-1'), coins[1], 'the entity that was never destroyed keeps its identity')
  assert.equal(world.byId('coin-2'), undefined, 'an entity made after the checkpoint is gone')
  assert.equal(world.byId('crate-0'), crate, 'an entity from before the checkpoint is still found')
})

/** A level whose placements carry no id: the loader names them by position. */
const PROJECT = {
  'game.json': { title: 'lookup', startLevel: 'main' },
  'levels/main.json': {
    entities: [
      { type: 'crate', at: [1, 0, 0] },
      { type: 'crate', at: [2, 0, 0] }
    ]
  },
  'types/crate.js': 'export default {}\n'
}

test('a level load names an entity by position, and byId finds it', async () => {
  const project = await temporaryProject(PROJECT)
  try {
    const { context } = await startWorldInNode({ root: CHECKOUT, project })
    const crates = context.world.entities.filter(entity => entity.type === 'crate')

    assert.equal(crates.length, 2, 'the level really placed two crates')
    assert.equal(context.world.byId('crate-0'), crates[0], 'the first crate is found by its level id')
    assert.equal(context.world.byId('crate-1'), crates[1], 'and the second by its own')
    assert.equal(context.world.byId('crate-2'), undefined, 'an id past the end of the level finds nothing')
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
})

test('clear drops the ids the level held', () => {
  const world = makeWorld(makeBus())
  const crate = world.spawn('crate', { id: 'crate-0' })

  world.clear()

  assert.equal(world.byId('crate-0'), undefined, 'a cleared world holds no id')
  assert.equal(world.entities.length, 0)
  assert.equal(world.entities.includes(crate), false)
})
