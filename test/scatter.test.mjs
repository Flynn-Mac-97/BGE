#!/usr/bin/env node
/**
 * Scatter: the sampler, and the plugin in a real headless world.
 *
 * Not wired into `npm run test:offline` — that script names its files
 * explicitly in package.json and this lane's claim is scatter.js alone.
 * Run directly: node --test test/scatter.test.mjs
 *
 * The pure half draws from the engine's own random stream rather than a
 * hand-rolled one, so what it proves about determinism is what the engine will
 * actually do. The world half boots the same node runner the CLI uses and
 * writes nothing to disk.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeLoop } from '../engine/loop.js'
import { startWorldInNode } from '../engine/start-world-node.mjs'
import { growField, readRule, distanceToPath, areaSize, SCATTER_TYPE } from '../plugins/builtin/scatter.js'
import { FIXTURE, FIXTURE_LEVEL } from './fixture-project.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The engine's own stream, seeded. The same generator a level load hands out. */
function seeded(seed) {
  const loop = makeLoop({ onFixed() {}, onFrame() {} })
  loop.reset(seed)
  return loop.random
}

/** A scatter entity as the world models one, without a world to put it in. */
const marker = (properties, at = [0, 0, 0]) => ({
  id: 'field', x: at[0], y: at[1], z: at[2], properties
})

/** A world stub for the two things readRule reads off one. */
const worldOf = (typeNames, entities = []) => ({
  types: new Map(typeNames.map(name => [name, {}])),
  entities
})

const rule = (properties, options = {}) =>
  readRule(marker(properties, options.at), options.world ?? worldOf(['tuft', 'stone']))

// ------------------------------------------------------------- determinism
test('the same seed grows the same field, placement for placement', () => {
  const declared = { of: 'tuft', count: 120, width: 40, depth: 40, apart: 1.5 }
  const first = growField(rule(declared), seeded(7))
  const second = growField(rule(declared), seeded(7))
  assert.ok(first.placed > 0, 'the rule places something to compare')
  assert.deepEqual(second.placements, first.placements)
})

test('a different seed grows a different field', () => {
  const declared = { of: 'tuft', count: 120, width: 40, depth: 40, apart: 1.5 }
  const first = growField(rule(declared), seeded(7))
  const second = growField(rule(declared), seeded(8))
  assert.equal(second.placed, first.placed, 'the same rule still asks for the same count')
  assert.notDeepEqual(second.placements, first.placements)
})

test('one stream grown twice does not repeat itself — the draws really advance', () => {
  const declared = { of: 'tuft', count: 40, width: 40, depth: 40 }
  const random = seeded(11)
  const first = growField(rule(declared), random)
  const second = growField(rule(declared), random)
  assert.notDeepEqual(second.placements, first.placements)
})

test('the draw count is a function of the rule alone', () => {
  const declared = { of: 'tuft', count: 50, width: 30, depth: 30, apart: 1 }
  const one = seeded(3)
  const two = seeded(4)
  growField(rule(declared), one)
  growField(rule(declared), two)
  assert.ok(one.draws > 0, 'the stream it was handed is the one it drew from')
  assert.equal(one.draws, two.draws, 'two seeds spend the same number of draws on one rule')
})

// ----------------------------------------------------------------- spacing
test('no two placements are closer than apart', () => {
  const apart = 2.5
  const field = growField(rule({ of: 'tuft', count: 150, width: 50, depth: 50, apart }), seeded(21))
  assert.ok(field.placed > 20, `the rule placed ${field.placed}, too few to prove anything`)
  for (let a = 0; a < field.placements.length; a++) {
    for (let b = a + 1; b < field.placements.length; b++) {
      const one = field.placements[a].at
      const other = field.placements[b].at
      const gap = Math.hypot(one[0] - other[0], one[2] - other[2])
      assert.ok(gap >= apart - 1e-9,
        `${field.placements[a].id} and ${field.placements[b].id} are ${gap.toFixed(3)} m apart, under ${apart}`)
    }
  }
})

test('apart 0 places every one that was asked for', () => {
  const field = growField(rule({ of: 'tuft', count: 200, width: 20, depth: 20, apart: 0 }), seeded(5))
  assert.equal(field.placed, 200)
})

test('a rule too tight for its area comes up short and says the number', () => {
  const field = growField(rule({ of: 'tuft', count: 400, width: 10, depth: 10, apart: 3 }), seeded(5))
  assert.ok(field.placed < field.asked, `placed ${field.placed} of ${field.asked}`)
  assert.equal(field.asked, 400)
})

// --------------------------------------------------------------- exclusion
test('nothing lands inside a clear circle', () => {
  const clear = [{ at: [0, 0], radius: 8 }, { at: [15, -12], radius: 5 }]
  const field = growField(rule({ of: 'tuft', count: 300, width: 60, depth: 60, clear }), seeded(31))
  assert.ok(field.placed > 50, 'enough placements to be worth checking')
  for (const placement of field.placements) {
    for (const circle of clear) {
      const reach = Math.hypot(placement.at[0] - circle.at[0], placement.at[2] - circle.at[1])
      assert.ok(reach >= circle.radius,
        `${placement.id} is ${reach.toFixed(3)} m from a circle of radius ${circle.radius}`)
    }
  }
})

test('a { type, radius } circle keeps clear of every entity of that type', () => {
  const standing = [{ type: 'landmark', x: -6, z: 4 }, { type: 'landmark', x: 9, z: -9 }]
  const resolved = readRule(
    marker({ of: 'tuft', count: 300, width: 50, depth: 50, clear: [{ type: 'landmark', radius: 4 }] }),
    worldOf(['tuft', 'landmark'], standing))
  assert.equal(resolved.clear.length, 2, 'one circle per entity of that type')
  const field = growField(resolved, seeded(41))
  for (const placement of field.placements) {
    for (const at of standing) {
      assert.ok(Math.hypot(placement.at[0] - at.x, placement.at[2] - at.z) >= 4,
        `${placement.id} landed on a landmark`)
    }
  }
})

test('nothing lands in a corridor, and width is the full lane', () => {
  const lane = { path: [[-20, -14], [-4, 2], [8, 18]], width: 6 }
  const field = growField(rule({ of: 'tuft', count: 300, width: 60, depth: 60, corridors: [lane] }), seeded(51))
  assert.ok(field.placed > 50, 'enough placements to be worth checking')
  for (const placement of field.placements) {
    const off = distanceToPath(lane.path, placement.at[0], placement.at[2])
    assert.ok(off >= lane.width / 2, `${placement.id} is ${off.toFixed(3)} m off the centre line`)
  }
})

test('with the corridor taken away, placements do land in that lane', () => {
  // The exclusion test above is only worth anything if the lane is somewhere
  // placements would otherwise go.
  const lane = { path: [[-20, -14], [-4, 2], [8, 18]], width: 6 }
  const field = growField(rule({ of: 'tuft', count: 300, width: 60, depth: 60 }), seeded(51))
  const inside = field.placements.filter(one => distanceToPath(lane.path, one.at[0], one.at[2]) < lane.width / 2)
  assert.ok(inside.length > 0, 'the lane is in the area, so excluding it means something')
})

test('distanceToPath measures to the segment, not to its ends', () => {
  assert.equal(distanceToPath([[0, 0], [10, 0]], 5, 3), 3)
  assert.equal(distanceToPath([[0, 0], [10, 0]], 15, 0), 5, 'past the end it is the end')
  assert.equal(distanceToPath([[4, 4]], 4, 7), 3, 'a one-point path is the point')
})

// -------------------------------------------------------------------- area
test('every placement is inside the box, the disc and the ring', () => {
  const box = growField(rule({ of: 'tuft', count: 200, width: 30, depth: 12 }), seeded(61))
  for (const placement of box.placements) {
    assert.ok(Math.abs(placement.at[0]) <= 15 + 1e-9 && Math.abs(placement.at[2]) <= 6 + 1e-9, placement.id)
  }

  const disc = growField(rule({ of: 'tuft', count: 200, area: 'disc', radius: 9 }), seeded(62))
  for (const placement of disc.placements) {
    assert.ok(Math.hypot(placement.at[0], placement.at[2]) <= 9 + 1e-9, placement.id)
  }

  const ring = growField(rule({ of: 'tuft', count: 200, area: 'ring', radius: 12, inner: 7 }), seeded(63))
  for (const placement of ring.placements) {
    const reach = Math.hypot(placement.at[0], placement.at[2])
    assert.ok(reach >= 7 - 1e-9 && reach <= 12 + 1e-9, `${placement.id} at ${reach.toFixed(3)}`)
  }
})

test('the area is centred on the scatter entity, so moving it moves the field', () => {
  const declared = { of: 'tuft', count: 60, width: 10, depth: 10 }
  const here = growField(rule(declared), seeded(71))
  const over = growField(rule(declared, { at: [100, 0, -40] }), seeded(71))
  for (let index = 0; index < here.placements.length; index++) {
    assert.equal(over.placements[index].at[0], Math.round((here.placements[index].at[0] + 100) * 1000) / 1000)
    assert.equal(over.placements[index].at[2], Math.round((here.placements[index].at[2] - 40) * 1000) / 1000)
  }
})

test('density is turned into a count from the area size', () => {
  assert.equal(rule({ of: 'tuft', density: 0.5, width: 20, depth: 10 }).count, 100)
  assert.equal(Math.round(areaSize({ area: 'disc', radius: 10 })), 314)
  assert.equal(rule({ of: 'tuft', count: 7, density: 99, width: 20, depth: 10 }).count, 7, 'count wins')
})

// ----------------------------------------------------------------- reading
test('of takes a comma list, a plain list, and weighted entries', () => {
  assert.deepEqual(rule({ of: 'tuft, stone' }).entries.map(entry => entry.type), ['tuft', 'stone'])
  assert.deepEqual(rule({ of: ['tuft', { type: 'stone', weight: 3 }] }).entries.map(entry => entry.weight), [1, 3])
})

test('a type no world answers to is dropped, and reported by name', () => {
  const said = []
  const resolved = readRule(marker({ of: 'tuft, ghost' }), worldOf(['tuft']), message => said.push(message))
  assert.deepEqual(resolved.entries.map(entry => entry.type), ['tuft'])
  assert.match(said.join('\n'), /no type "ghost"/)
})

test('nothing in `of` places nothing, and says how many it wanted', () => {
  const field = growField(rule({ count: 50 }), seeded(81))
  assert.equal(field.placed, 0)
  assert.equal(field.asked, 50)
})

test('a corridor or circle written wrong is refused by name, not ignored', () => {
  const said = []
  const resolved = readRule(
    marker({ of: 'tuft', clear: [{ at: [0, 0] }], corridors: [{ width: 3 }] }),
    worldOf(['tuft']), message => said.push(message))
  assert.equal(resolved.clear.length, 0)
  assert.equal(resolved.corridors.length, 0)
  assert.match(said.join('\n'), /clear circle needs a radius/)
  assert.match(said.join('\n'), /corridor needs a path/)
})

test('a ring whose hole is wider than the ring is swapped rather than left empty', () => {
  const resolved = rule({ of: 'tuft', area: 'ring', radius: 4, inner: 11 })
  assert.deepEqual([resolved.inner, resolved.radius], [4, 11])
})

test('sit lifts each placement by half its own drawn box height', () => {
  const world = { types: new Map([['post', { mesh: { box: [1, 3, 1] } }]]), entities: [] }
  const standing = growField(readRule(marker({ of: 'post', count: 5, apart: 0 }), world), seeded(91))
  for (const placement of standing.placements) {
    assert.ok(Math.abs(placement.at[1] - 1.5 * placement.scale) < 1e-9,
      `${placement.id} is at y ${placement.at[1]} on a 3 m post scaled ${placement.scale}`)
  }
  const centred = growField(readRule(marker({ of: 'post', count: 5, apart: 0, sit: false }), world), seeded(91))
  for (const placement of centred.placements) assert.equal(placement.at[1], 0)
})

test('yaw and scale are drawn per placement, inside the pair they were given', () => {
  const field = growField(rule({ of: 'tuft', count: 80, yaw: [10, 20], scale: [0.5, 2] }), seeded(101))
  const rotations = new Set(field.placements.map(one => one.rotation))
  assert.ok(rotations.size > 10, 'the yaw really varies')
  for (const placement of field.placements) {
    assert.ok(placement.rotation >= 10 && placement.rotation <= 20, `rotation ${placement.rotation}`)
    assert.ok(placement.scale >= 0.5 && placement.scale <= 2, `scale ${placement.scale}`)
  }
})

test('an entry carries its own mesh and properties onto every placement of it', () => {
  const declared = { of: [{ type: 'tuft', mesh: { tint: '#5f6d30' }, properties: { body: 'none' } }], count: 4, apart: 0 }
  const field = growField(rule(declared), seeded(111))
  for (const placement of field.placements) {
    assert.deepEqual(placement.mesh, { tint: '#5f6d30' })
    assert.deepEqual(placement.properties, { body: 'none' })
  }
})

// -------------------------------------------------------- in a real world
test('a scatter in a live world grows on the clock, the same way twice', async () => {
  const { context, engine, world } = await startWorldInNode({ root: ROOT, project: FIXTURE })

  const place = async () => {
    // The level load reseeds the stream, so both runs start from the same place.
    await context.editor.loadLevel(FIXTURE_LEVEL)
    assert.ok(world.types.has('scatter'), 'the plugin registered the type on level:loaded')
    context.spawn('scatter', {
      id: 'tufts', at: [0, 0, 0],
      properties: { of: 'prop', count: 40, width: 24, depth: 24, apart: 1.2 }
    })
    engine.simulate(0.1)
    return world.entities.filter(entity => entity.id.startsWith('tufts-'))
      .map(entity => [entity.id, entity.x, entity.z])
  }

  const first = await place()
  assert.ok(first.length > 10, `the field grew ${first.length} placements`)
  assert.deepEqual(await place(), first, 'the same level and seed grew the same field')

  await context.editor.loadLevel(FIXTURE_LEVEL)
})

test('the marker hides on the clock, and takes its field with it when destroyed', async () => {
  const { context, engine, world } = await startWorldInNode({ root: ROOT, project: FIXTURE })
  await context.editor.loadLevel(FIXTURE_LEVEL)

  const scatter = context.spawn('scatter', {
    id: 'tufts', at: [0, 0, 0], properties: { of: 'prop', count: 12, width: 20, depth: 20 }
  })
  assert.equal(scatter.hidden, false, 'visible in the editor, so it can be dragged')
  engine.simulate(0.1)
  assert.equal(scatter.hidden, true, 'an editing aid is not part of the picture while playing')
  assert.equal(world.entities.filter(entity => entity.id.startsWith('tufts-')).length, 12)

  context.destroy(scatter)
  assert.equal(world.entities.filter(entity => entity.id.startsWith('tufts-')).length, 0)
})

test('expand leaves real placements and no scatter, and a save would write them', async () => {
  const { context, world } = await startWorldInNode({ root: ROOT, project: FIXTURE })
  await context.editor.loadLevel(FIXTURE_LEVEL)

  const scatter = context.spawn('scatter', {
    id: 'tufts', at: [2, 0, -3], properties: { of: 'prop', count: 9, width: 20, depth: 20 }
  })
  const previewed = context.scatter.preview('tufts')
  assert.equal(previewed[0].standing, 9)
  assert.equal(world.simulated, true, 'a preview cannot be saved into the level')

  const expanded = context.scatter.expand(scatter)
  assert.equal(expanded.placed, 9)
  assert.equal(world.all('scatter').length, 0, 'the marker is gone')
  assert.equal(world.byId('tufts-1').type, 'prop')

  // The whole point of expanding: what toLevel writes is ordinary placements,
  // each keeping the id the field gave it, so one can be nudged by hand.
  const level = world.toLevel(null)
  const written = level.entities.filter(entity => String(entity.id || '').startsWith('tufts-'))
  assert.equal(written.length, 9)
  assert.equal(written[0].type, 'prop')
  assert.ok(Array.isArray(written[0].at))
})

test('scatter.list answers "why is my field empty" from a terminal', async () => {
  const { context, engine } = await startWorldInNode({ root: ROOT, project: FIXTURE })
  await context.editor.loadLevel(FIXTURE_LEVEL)
  context.spawn('scatter', {
    id: 'tufts', at: [0, 0, 0], properties: { of: 'prop', count: 300, width: 8, depth: 8, apart: 3 }
  })
  engine.simulate(0.1)

  const report = await engine.run('scatter.list')
  assert.equal(report.scatters.length, 1)
  assert.equal(report.scatters[0].count, 300)
  assert.ok(report.scatters[0].placed < 300)
  assert.match(report.notes.join('\n'), /too tight for its area/)
})

test('the type declares every key the guide lists', () => {
  const declared = Object.keys(SCATTER_TYPE.properties)
  for (const key of ['of', 'count', 'density', 'area', 'width', 'depth', 'radius', 'inner',
    'apart', 'clear', 'corridors', 'yaw', 'scale', 'y', 'sit', 'tries']) {
    assert.ok(declared.includes(key), `the inspector schema is missing ${key}`)
  }
})
