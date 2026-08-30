#!/usr/bin/env node
/**
 * describe()'s size-outlier and stacked-entity fault detection, offline and
 * pure. verticalSpan and heightGaps are covered elsewhere and untouched here.
 *
 * Not wired into `npm run test:offline` — that script names its two files
 * explicitly in package.json, and this lane's claim is describe.js alone.
 * Run directly: node --test test/see-describe-faults.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { findSizeOutliers, findStackedEntities } from '../plugins/builtin/see/describe.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(ROOT, 'bin/engine.mjs')

const rat = (id, box, extra = {}) => ({ id, type: 'rat', x: 0, y: 0, z: 0, mesh: { box }, ...extra })
const world = entities => ({ world: { entities } })

test('one instance boxed nothing like the rest of its type is named', () => {
  const entities = [rat('rat-1', [1, 2, 1]), rat('rat-2', [1, 2, 1]), rat('rat-3', [1, 2, 1]), rat('rat-4', [10, 20, 10])]
  const found = findSizeOutliers(world(entities), {})
  assert.equal(found.length, 1)
  assert.equal(found[0].id, 'rat-4')
  assert.equal(found[0].factor, 10)
  assert.deepEqual(found[0].typicalSize, [1, 2, 1])
})

test('a type with no dominant size — every instance placed by hand — is left alone', () => {
  const entities = [rat('prop-1', [1, 1, 1]), rat('prop-2', [4, 2, 6]), rat('prop-3', [9, 1, 2]), rat('prop-4', [2, 8, 3])]
  assert.deepEqual(findSizeOutliers(world(entities), {}), [], 'no size is common enough to call typical')
})

test('a type with fewer than three instances has no norm to depart from', () => {
  const entities = [rat('rat-1', [1, 2, 1]), rat('rat-2', [100, 100, 100])]
  assert.deepEqual(findSizeOutliers(world(entities), {}), [])
})

test('a hidden outlier is not reported unless includeHidden is asked for', () => {
  const entities = [rat('rat-1', [1, 2, 1]), rat('rat-2', [1, 2, 1]), rat('rat-3', [1, 2, 1]),
    rat('rat-4', [10, 20, 10], { hidden: true })]
  assert.deepEqual(findSizeOutliers(world(entities), {}), [], 'hidden, so not counted')
  assert.equal(findSizeOutliers(world(entities), { includeHidden: true }).length, 1)
})

const prop = (id, at, extra = {}) => ({ id, type: 'meadow-prop', x: at[0], y: at[1], z: at[2], mesh: { box: [1, 1, 1] }, ...extra })
const light = (id, at) => ({ id, type: 'light', x: at[0], y: at[1], z: at[2] })

test('two drawn entities on the exact same spot are named — only one can ever be seen', () => {
  const entities = [prop('a', [1, 2, 3]), prop('b', [1, 2, 3]), prop('c', [5, 5, 5])]
  const found = findStackedEntities(world(entities), {})
  assert.equal(found.length, 1)
  assert.deepEqual(found[0].ids.sort(), ['a', 'b'])
  assert.deepEqual(found[0].at, [1, 2, 3])
})

test('a light sharing a lamp post\'s position is not a stacking fault — it has no shape to hide', () => {
  const entities = [prop('post', [1, 2, 3]), light('post-light', [1, 2, 3])]
  assert.deepEqual(findStackedEntities(world(entities), {}), [], 'one drawn body, one light: nothing is hidden')
})

test('positions half a centimetre apart are not the same position', () => {
  const entities = [prop('a', [1, 2, 3]), prop('b', [1.02, 2, 3])]
  assert.deepEqual(findStackedEntities(world(entities), {}), [])
})

test('a hidden duplicate is not reported unless includeHidden is asked for', () => {
  const entities = [prop('a', [1, 2, 3]), prop('b', [1, 2, 3], { hidden: true })]
  assert.deepEqual(findStackedEntities(world(entities), {}), [])
  assert.equal(findStackedEntities(world(entities), { includeHidden: true }).length, 1)
})

/**
 * Real findings from the real engine: drop two gems at the kitten with
 * nothing simulated in between (the fixed +3 offset `kitten.drop` uses lands
 * both at one point), then give one gem's mesh a 10m box by hand. Both are
 * how these faults actually happen — a double-drop on one tick, a bad
 * override — not fabricated JSON.
 */
test('a live double-drop is caught as two entities on one point', () => {
  const stdout = execFileSync(process.execPath, [
    CLI, 'script',
    '[["play"],["simulate",30],["run","kitten.drop",5],["run","kitten.drop",5],["run","see.describe"]]',
    '--headless', '--project', 'kitten-survivors', '--level', 'meadow'
  ], { encoding: 'utf8' })
  const steps = JSON.parse(stdout)
  const dropped = [steps[2].id, steps[3].id]
  const description = steps[4]
  assert.ok(description.stackedEntities?.length >= 1, 'the double-drop is reported')
  const found = description.stackedEntities.find(entry => dropped.every(id => entry.ids.includes(id)))
  assert.ok(found, 'the two dropped gems are named together')
})

test('a live mesh override is caught as a size outlier', () => {
  const stdout = execFileSync(process.execPath, [
    CLI, 'script',
    '[["play"],["simulate",30],["run","kitten.drop",5],'
      + '["set","xp-gem-196","mesh",{"box":[10,10,10]}],["run","see.describe"]]',
    '--headless', '--project', 'kitten-survivors', '--level', 'meadow'
  ], { encoding: 'utf8' })
  const description = JSON.parse(stdout)[4]
  const found = description.sizeOutliers?.find(entry => entry.id === 'xp-gem-196')
  assert.ok(found, 'the oversized gem is named')
  assert.ok(found.factor > 10, `expected a large factor, got ${found.factor}`)
})

test('the unmodified meadow, at the scene the verify command reaches, has neither fault', () => {
  const stdout = execFileSync(process.execPath, [
    CLI, 'script', '[["play"],["simulate",30],["run","see.describe"]]',
    '--headless', '--project', 'kitten-survivors', '--level', 'meadow'
  ], { encoding: 'utf8' })
  const description = JSON.parse(stdout)[2]
  assert.equal(description.sizeOutliers, undefined, 'a shipped level names no size fault')
  assert.equal(description.stackedEntities, undefined, 'a shipped level names no stacking fault')
})
