/**
 * `extract` and `prepare` on the pass graph: each runs once per pass per frame,
 * every extract and prepare finishes before the first execute, and the kernel
 * hands the plugin a sink without ever reading what the plugin put in it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makePassGraph } from '../../engine/render/graph.js'

const noop = () => {}

test('every extract and prepare runs before the first execute', () => {
  const graph = makePassGraph({ report: noop })
  const steps = []
  graph.add({
    name: 'first',
    extract: () => steps.push('first extract'),
    prepare: () => steps.push('first prepare'),
    execute: () => steps.push('first execute')
  })
  graph.add({
    name: 'second',
    extract: () => steps.push('second extract'),
    prepare: () => steps.push('second prepare'),
    execute: () => steps.push('second execute')
  })
  graph.add({ name: 'present', execute: () => steps.push('present execute') })
  graph.run(null, null, 8, 8)
  assert.deepEqual(steps, [
    'first extract', 'second extract',
    'first prepare', 'second prepare',
    'first execute', 'second execute', 'present execute'
  ])
})

test('extract and prepare run once per pass per frame', () => {
  const graph = makePassGraph({ report: noop })
  let extracts = 0
  let prepares = 0
  graph.add({ name: 'probe', extract: () => { extracts++ }, prepare: () => { prepares++ }, execute: noop })
  graph.add({ name: 'present', execute: noop })
  graph.run(null, null, 8, 8)
  graph.run(null, null, 8, 8)
  assert.equal(extracts, 2)
  assert.equal(prepares, 2)
})

test('a disabled pass gets no extract, prepare or execute', () => {
  const graph = makePassGraph({ report: noop })
  const seen = []
  graph.add({ name: 'probe', extract: () => seen.push('extract'), prepare: () => seen.push('prepare'), execute: () => seen.push('execute') })
  graph.add({ name: 'present', execute: noop })
  graph.disable('probe')
  graph.run(null, null, 8, 8)
  assert.deepEqual(seen, [])
})

test('the sink stores plugin data and the kernel never reads it', () => {
  const graph = makePassGraph({ report: noop })
  const written = []
  let seenFrame = null
  graph.add({
    name: 'plugin',
    extract(frame, sink) {
      seenFrame = frame
      const entry = sink.attribute('instances')
      entry.values = [1, 2, 3]
      sink.markDirty('instances')
      written.push(entry.values.length)
    },
    execute: noop
  })
  graph.add({ name: 'present', execute: noop })
  graph.run('camera', null, 8, 8)
  assert.deepEqual(written, [3])
  assert.equal(seenFrame, graph.frame, 'the plugin sees the one frame record')
  assert.equal(seenFrame.camera, 'camera')
})
