/**
 * The pass graph's order: label edges decide position, registration order
 * breaks a tie, and a cycle is reported rather than thrown.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makePassGraph } from '../../engine/render/graph.js'

const noop = () => {}
const names = graph => graph.passes.map(pass => pass.name)

test('after and before place a pass where it says', () => {
  const graph = makePassGraph({ report: noop })
  graph.add({ name: 'middle', execute: noop })
  graph.add({ name: 'last', after: ['middle'], execute: noop })
  graph.add({ name: 'first', before: ['middle'], execute: noop })
  assert.deepEqual(names(graph), ['first', 'middle', 'last'])
})

test('passes with no edge between them keep registration order', () => {
  const graph = makePassGraph({ report: noop })
  graph.add({ name: 'c', execute: noop })
  graph.add({ name: 'a', execute: noop })
  graph.add({ name: 'b', execute: noop })
  assert.deepEqual(names(graph), ['c', 'a', 'b'], 'no constraint means the order they arrived')
})

test('a chain of edges holds across many passes', () => {
  const graph = makePassGraph({ report: noop })
  graph.add({ name: 'fourth', after: ['third'], execute: noop })
  graph.add({ name: 'second', after: ['first'], execute: noop })
  graph.add({ name: 'first', execute: noop })
  graph.add({ name: 'third', after: ['second'], execute: noop })
  assert.deepEqual(names(graph), ['first', 'second', 'third', 'fourth'])
})

test('an edge to a label that does not exist is ignored, and the frame still runs', () => {
  const reported = []
  const graph = makePassGraph({ report: message => reported.push(message) })
  let ran = 0
  graph.add({ name: 'probe', before: ['missing'], execute: () => { ran++ } })
  graph.run(null, null, 8, 8)
  assert.equal(ran, 1)
  assert.ok(reported.some(message => message.includes('missing')), 'the dangling edge is named')
})

test('a cycle is reported by name and its members keep registration order', () => {
  const reported = []
  const graph = makePassGraph({ report: message => reported.push(message) })
  graph.add({ name: 'a', after: ['b'], execute: noop })
  graph.add({ name: 'b', after: ['a'], execute: noop })
  graph.add({ name: 'c', execute: noop })
  const ordered = names(graph)
  assert.deepEqual(ordered.filter(name => name !== 'c'), ['a', 'b'], 'the cycle keeps arrival order')
  assert.ok(reported.some(message => message.includes('cycle') && message.includes('a') && message.includes('b')))
})

test('remove takes one pass out and leaves the rest ordered', () => {
  const graph = makePassGraph({ report: noop })
  graph.add({ name: 'a', execute: noop })
  graph.add({ name: 'b', execute: noop })
  graph.add({ name: 'c', execute: noop })
  graph.remove('b')
  assert.deepEqual(names(graph), ['a', 'c'])
})

test('disable takes a pass out of the run without dropping its record', () => {
  const graph = makePassGraph({ report: noop })
  let ran = 0
  graph.add({ name: 'probe', execute: () => { ran++ } })
  graph.disable('probe')
  assert.deepEqual(names(graph), [])
  graph.run(null, null, 8, 8)
  assert.equal(ran, 0)
  graph.enable('probe')
  assert.deepEqual(names(graph), ['probe'])
  graph.run(null, null, 8, 8)
  assert.equal(ran, 1)
})
