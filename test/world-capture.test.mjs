/**
 * A checkpoint of the world: taken, carried on from, and put back.
 *
 * The hash from `test/state-hash.test.mjs` is what makes this checkable at all —
 * "the world went back" is one number rather than a thousand rows — so these tests
 * lean on it. What they add is the part a hash cannot show: identity. Everything
 * outside the world holds an entity by reference — the solver maps one to a body, a
 * behaviour watches one, a chase remembers one — so a restore that handed out new
 * objects would break all of them and look like a physics bug.
 *
 * A checkpoint is also a moment, not a view: the world carrying on must not change
 * what was written down.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CHECKOUT, FIXTURE } from './fixture-project.mjs'
import { startWorldInNode } from '../engine/start-world-node.mjs'
import { stateHash } from '../engine/world.js'

const boot = async () => (await startWorldInNode({ root: CHECKOUT, project: FIXTURE })).context

test('a capture put back is the world it was taken from', async () => {
  const context = await boot()
  const { world, loop } = context
  loop.step(60)

  const mark = world.capture()
  const wasHash = stateHash(world)
  const wasOrder = world.entities.map(entity => entity.id)
  const wasCount = world.entities.length

  // Change it several ways at once, so a restore that got one of them right and
  // another wrong cannot pass.
  world.entities[0].x += 5
  world.entities[0].properties.probe = 1
  world.state.probe = 2
  world.spawn('ground', { at: [3, 3, 0] })
  loop.step(60)
  assert.equal(world.entities.length, wasCount + 1, 'the changes really did change the world')

  world.restore(mark)

  assert.equal(stateHash(world), wasHash, 'the whole world, to the bit')
  assert.deepEqual(world.entities.map(entity => entity.id), wasOrder, 'the same entities in the same order')
  assert.equal(world.entities.length, wasCount, 'and none left over from after the checkpoint')
})

test('an entity keeps its identity, which is what everything else holds', async () => {
  const context = await boot()
  const body = context.world.entities[0]
  const wasX = body.x

  const mark = context.world.capture()
  body.x += 5
  context.world.restore(mark)

  assert.equal(context.world.entities[0], body, 'the same object, not a copy of it')
  assert.equal(body.x, wasX, 'and holding the values it held')
})

test('a state object holding an entity gets that entity back', async () => {
  const context = await boot()
  const watched = context.world.entities[1]
  context.world.state.target = watched

  const mark = context.world.capture()
  context.world.entities[0].x += 3
  context.world.restore(mark)

  assert.equal(context.world.state.target, watched, 'the same entity object the state was holding')
  assert.equal(context.world.entities.includes(watched), true, 'and it is in the world')
})

test('an entity the world destroyed since the checkpoint comes back as a new object, under its own id', async () => {
  const context = await boot()
  const watched = context.world.entities[1]
  const id = watched.id
  context.world.state.target = watched

  const mark = context.world.capture()
  context.world.destroy(watched)
  context.world.restore(mark)

  // Identity survives for an entity that was still in the world. This one was
  // thrown away by `destroy`, and nothing can bring that particular object back —
  // so the reference resolves to the entity now standing in for it. Anything
  // holding the discarded object has to look it up by id, not remember it.
  assert.notEqual(context.world.state.target, watched, 'not the discarded object')
  assert.equal(context.world.state.target.id, id, 'but the entity it stood for')
  assert.equal(context.world.entities.includes(context.world.state.target), true, 'and it is in the world')
})

test('carrying on does not change what was written down', async () => {
  const context = await boot()
  const body = context.world.entities[0]
  body.properties.health = 10

  const mark = context.world.capture()
  body.properties.health = 1
  context.world.state.probe = 5

  context.world.restore(mark)

  assert.equal(body.properties.health, 10, 'a checkpoint is a moment, not a view of a living world')
  assert.equal('probe' in context.world.state, false, 'including the shared state')
})

test('the shared state object keeps its identity too', async () => {
  const context = await boot()
  const state = context.world.state
  state.score = 3

  const mark = context.world.capture()
  state.score = 99
  context.world.restore(mark)

  assert.equal(context.world.state, state, 'a plugin that read it once still has the same object')
  assert.equal(state.score, 3)
})

test('what a checkpoint cannot carry is named, not dropped in silence', async () => {
  const context = await boot()
  context.world.state.callback = () => 1

  const mark = context.world.capture()

  assert.equal(mark.lost.length, 1, 'one thing could not go in')
  assert.match(mark.lost[0], /world\.state\.callback is a function/)
})

test('a checkpoint of another shape is refused, not misread', async () => {
  const context = await boot()
  assert.throws(() => context.world.restore({ version: 99, entities: [] }), /version/)
})
