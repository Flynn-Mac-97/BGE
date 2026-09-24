/**
 * The resource lifetimes the pass graph plans: a transient resource is allocated
 * for one frame and pools with any other transient whose span does not overlap; a
 * persistent resource outlives the frame, is never aliased, is read next frame
 * with what the last one wrote, survives a resize and a device restore, and is
 * released when nothing declares it any more.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makePassGraph } from '../../../engine/render/graph.js'

const noop = () => {}

test('a persistent resource keeps what the last frame wrote and shares no slot', () => {
  const graph = makePassGraph({ report: noop })
  const read = []
  graph.add({
    name: 'historyWrite',
    writes: ['history'],
    target: { format: 'half-float', lifetime: 'persistent' },
    execute: (frame, targets) => {
      targets.get('history').writtenOn = 'first frame'
    }
  })
  graph.add({
    name: 'historyRead',
    reads: ['history'],
    execute: (frame, targets) => read.push(targets.get('history')?.writtenOn ?? null)
  })
  // A transient with the same descriptor and a span after the persistent one:
  // without the lifetime it would be the obvious target to share.
  graph.add({ name: 'scratchWrite', writes: ['scratch'], target: { format: 'half-float' }, execute: noop })
  graph.add({ name: 'scratchRead', reads: ['scratch'], execute: noop })

  graph.run(null, null, 64, 64)
  const history = graph.targets.get('history')
  assert.ok(history, 'the persistent resource was given a target')
  assert.notEqual(history, graph.targets.get('scratch'), 'a persistent resource is never aliased')
  assert.equal(graph.pool.created, 2, 'the persistent resource and the transient each made one target')
  assert.deepEqual(read, ['first frame'], 'frame one read what the writer wrote')

  // The producer is gone, but its record still declares the resource. The
  // reader must still get the same target, holding the last frame's contents.
  graph.disable('historyWrite')
  graph.run(null, null, 64, 64)
  assert.equal(graph.targets.get('history'), history, 'the persistent target outlived the pass-set change')
  assert.deepEqual(read, ['first frame', 'first frame'], 'frame two read what frame one wrote')
})

test('a persistent resource does not cost the transient pooling', () => {
  const graph = makePassGraph({ report: noop })
  const half = { format: 'half-float' }
  graph.add({ name: 'history', writes: ['history'], target: { ...half, lifetime: 'persistent' }, execute: noop })
  graph.add({ name: 'readHistory', reads: ['history'], execute: noop })
  graph.add({ name: 'a', writes: ['x'], target: half, execute: noop })
  graph.add({ name: 'b', reads: ['x'], execute: noop })
  graph.add({ name: 'c', writes: ['y'], target: half, execute: noop })
  graph.add({ name: 'd', reads: ['y'], execute: noop })
  graph.run(null, null, 64, 64)

  assert.equal(graph.targets.get('x'), graph.targets.get('y'), 'two free transient spans still share one slot')
  assert.notEqual(graph.targets.get('x'), graph.targets.get('history'), 'no transient takes the persistent slot')
  assert.equal(graph.pool.created, 2, 'one persistent target and one shared transient target')
})

test('a persistent resource survives a resize in place', () => {
  const graph = makePassGraph({ report: noop })
  graph.add({ name: 'write', writes: ['history'], target: { scale: 0.5, lifetime: 'persistent' }, execute: noop })
  graph.add({ name: 'read', reads: ['history'], execute: noop })
  graph.run(null, null, 100, 50)

  const target = graph.targets.get('history')
  assert.equal(target.width, 50, 'the persistent target follows its scale')
  graph.run(null, null, 200, 80)
  assert.equal(graph.targets.get('history'), target, 'the resize kept the same target')
  assert.equal(target.width, 100, 'and resized it in place')
  assert.equal(graph.pool.created, 1, 'a resize made no target')
})

test('a persistent resource comes back after a device restore', () => {
  const graph = makePassGraph({ report: noop })
  graph.add({ name: 'write', writes: ['history'], target: { lifetime: 'persistent' }, execute: noop })
  graph.add({ name: 'read', reads: ['history'], execute: noop })
  graph.run(null, null, 64, 64)
  const before = graph.targets.get('history')

  graph.recreateTargets()
  graph.run(null, null, 64, 64)
  const after = graph.targets.get('history')
  assert.ok(after, 'the persistent resource has a target again')
  assert.notEqual(after, before, 'the old target died with the device')
  assert.equal(graph.pool.created, 1, 'one target was rebuilt from the descriptor')
})

test('a persistent resource is released when nothing declares it any more', () => {
  const graph = makePassGraph({ report: noop })
  graph.add({ name: 'write', writes: ['history'], target: { lifetime: 'persistent' }, execute: noop })
  graph.add({ name: 'read', reads: ['history'], execute: noop })
  graph.run(null, null, 64, 64)
  assert.equal(graph.pool.created, 1)

  graph.remove('write')
  graph.run(null, null, 64, 64)
  assert.equal(graph.targets.get('history'), null, 'the read has no target to resolve')
  assert.equal(graph.pool.created, 0, 'the undeclared persistent target was disposed')
})

test('a depth resource carries a depth texture and never shares with a colour', () => {
  const graph = makePassGraph({ report: noop })
  graph.add({ name: 'depthWrite', writes: ['depth'], target: { kind: 'depth' }, execute: noop })
  graph.add({ name: 'depthRead', reads: ['depth'], execute: noop })
  graph.add({ name: 'colourWrite', writes: ['colour'], target: { kind: 'colour' }, execute: noop })
  graph.add({ name: 'colourRead', reads: ['colour'], execute: noop })
  graph.run(null, null, 64, 64)

  const depth = graph.targets.get('depth')
  const colour = graph.targets.get('colour')
  assert.ok(depth.depthTexture, 'a depth resource is read through a depth texture')
  assert.equal(colour.depthTexture, null, 'a colour resource keeps its depth buffer private')
  assert.notEqual(depth, colour, 'the two kinds never share a slot')
  assert.equal(graph.pool.created, 2)
})
