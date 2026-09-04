#!/usr/bin/env node
/**
 * describe()'s hull simplification, offline and pure.
 *
 * Not wired into `npm run test:offline` — that script names its two files
 * explicitly in package.json, and this lane's claim is describe.js alone.
 * Run directly: node --test test/see-describe-hull.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { simplifyHull } from '../plugins/builtin/see/describe.js'
import { FIXTURE, FIXTURE_LEVEL } from './fixture-project.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(ROOT, 'bin/engine.mjs')

test('a repeated point costs nothing — dropped before the budget is spent', () => {
  const square = [[0, 0], [0, 0], [10, 0], [10, 10], [0, 10]]
  const result = simplifyHull(square, 20)
  assert.equal(result.length, 4, 'the duplicate corner is gone, the shape is not')
})

test('a hull that closes back to its first point is not counted twice', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
  const result = simplifyHull(square, 20)
  assert.equal(result.length, 4)
})

test('too small to show a silhouette gets no hull at all', () => {
  const square = [[0, 0], [1, 0], [1, 1], [0, 1]]
  assert.equal(simplifyHull(square, 0.3), null, 'a speck under the visible-size floor')
  assert.notEqual(simplifyHull(square, 5), null, 'the same shape, large enough, keeps its hull')
})

test('fewer than three points after dedup is not a shape', () => {
  assert.equal(simplifyHull([[0, 0], [0, 0], [0, 0]], 20), null)
})

test('a fourteen-point silhouette on a one-percent-wide body is cut down hard', () => {
  // A rounded outline — the shape a pixel-traced rat silhouette actually has,
  // not the six-or-fewer corners describe()'s own box hull ever produces.
  const rounded = []
  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2
    rounded.push([50 + Math.cos(angle) * 2, 50 + Math.sin(angle) * 5])
  }
  const result = simplifyHull(rounded, 1)
  assert.ok(result.length < rounded.length, 'the point count actually drops')
  assert.ok(result.length <= 5, `a body this small does not need this much detail, got ${result.length}`)
  assert.ok(result.length >= 3, 'still a real polygon')
})

test('a bigger body earns more points than a smaller one from the same source shape', () => {
  const rounded = []
  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2
    rounded.push([50 + Math.cos(angle) * 2, 50 + Math.sin(angle) * 5])
  }
  const small = simplifyHull(rounded, 2)
  const big = simplifyHull(rounded, 18)
  assert.ok(big.length >= small.length, `big: ${big.length}, small: ${small.length}`)
})

test('simplification never invents points past what it was given', () => {
  const triangle = [[0, 0], [10, 0], [5, 10]]
  const result = simplifyHull(triangle, 50)
  assert.equal(result.length, 3, 'nothing to remove, nothing added')
})

test('in a real scene, every marked hull respects the point budget and has no repeated point', () => {
  const stdout = execFileSync(process.execPath, [
    CLI, 'script', '[["play"],["simulate",1],["run","see.describe",{"brief":true}]]',
    '--headless', '--project', FIXTURE, '--level', FIXTURE_LEVEL
  ], { encoding: 'utf8' })
  const description = JSON.parse(stdout)[2]
  const marked = description.visible.filter(entry => entry.hull)
  assert.ok(marked.length > 0, 'the level marks something to check')
  for (const entry of marked) {
    assert.ok(entry.hull.length <= 8, `${entry.id} carries ${entry.hull.length} hull points`)
    for (let i = 1; i < entry.hull.length; i++) {
      assert.notDeepEqual(entry.hull[i], entry.hull[i - 1], `${entry.id} repeats a point`)
    }
  }
})
