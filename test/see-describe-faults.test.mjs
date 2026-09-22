#!/usr/bin/env node
/**
 * describe()'s size-outlier and stacked-entity fault detection, offline and
 * pure. verticalSpan and heightGaps are covered elsewhere and untouched here.
 *
 * Run directly: node --test test/see-describe-faults.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { findSizeOutliers, findStackedEntities } from '../plugins/builtin/see/describe.js'
import { FIXTURE_LEVEL, temporaryFixture } from './fixture-project.mjs'

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
 * The same two faults through the whole engine, not through the pure functions
 * above: spawned into a live world, read back by `see.describe`.
 *
 * Built here rather than borrowed from a game's own command. The engine
 * repository holds no game, and what is under test is the fault detection, so
 * the fault is made directly and the assertion says what made it.
 */
// One copy per run, because spawning and setting save the level: two runs
// sharing a project means the second reads what the first wrote.
async function script(steps) {
  const directory = await temporaryFixture('engine-see-faults-')
  return JSON.parse(execFileSync(process.execPath, [
    CLI, 'script', JSON.stringify(steps),
    '--headless', '--project', directory, '--level', FIXTURE_LEVEL
  ], {
    encoding: 'utf8',
    // Fixture writes must not share the real workspace's agent claims.
    env: { ...process.env, ENGINE_STATE_ROOT: path.join(directory, '.engine') }
  }))
}

test('two entities spawned on one point are caught as stacked', async () => {
  const steps = await script([
    ['spawn', 'prop', { id: 'stack-a', at: [3, 3, 0] }],
    ['spawn', 'prop', { id: 'stack-b', at: [3, 3, 0] }],
    ['run', 'see.describe']
  ])
  const description = steps[2]
  const found = description.stackedEntities?.find(entry =>
    entry.ids.includes('stack-a') && entry.ids.includes('stack-b'))
  assert.ok(found, `the two spawned props are named together: ${JSON.stringify(description.stackedEntities)}`)
})

test('one instance boxed ten times its type is caught as a size outlier', async () => {
  const steps = await script([
    ['spawn', 'prop', { id: 'huge', at: [3, 3, 0] }],
    ['set', 'huge', 'mesh', { box: [10, 10, 10] }],
    ['run', 'see.describe']
  ])
  const description = steps[2]
  const found = description.sizeOutliers?.find(entry => entry.id === 'huge')
  assert.ok(found, `the oversized prop is named: ${JSON.stringify(description.sizeOutliers)}`)
  assert.ok(found.factor > 10, `expected a large factor, got ${found.factor}`)
})

test('the fixture level as it stands has neither fault', async () => {
  const description = (await script([['play'], ['simulate', 1], ['run', 'see.describe']]))[2]
  assert.equal(description.sizeOutliers, undefined, 'a level as written names no size fault')
  assert.equal(description.stackedEntities, undefined, 'a level as written names no stacking fault')
})
