#!/usr/bin/env node
/**
 * Rig Animation: the sampler, the clip builder, and the plugin in a world.
 *
 * The sampler runs sixty times a second for every rigged body, so it is tested
 * on its own rather than through a world. The world half proves the plugin
 * loads and contributes its verbs, and needs no motion model to do it.
 *
 *   node --test test/rig-animation.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { startWorldInNode } from '../engine/start-world-node.mjs'
import { widenClip, applyClip } from '../plugins/builtin/rig-animation.js'
import { buildClip, writeClip, multiply, skeletonFor, SKELETONS } from '../tools/lib/motion-clip.mjs'
import { FIXTURE } from './fixture-project.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Three frames of two nodes: the first turns, the second rests. */
const CLIP = widenClip({
  name: 'test',
  framesPerSecond: 10,
  loop: true,
  nodes: ['hips', 'head'],
  rotations: [
    [0, 0, 0, 1, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 1],
    [0, 1, 0, 0, 0, 0, 0, 1]
  ],
  root: [[0, 1, 0], [0, 1, 1], [0, 1, 2]]
}, 'test')

const at = (seconds, clip = CLIP, rig = {}) => {
  const entity = { x: 0, y: 0, z: 0, _rigTime: seconds }
  applyClip(entity, clip, rig)
  return entity
}

const length = turn => Math.hypot(...turn)

// ------------------------------------------------------------------ the file
test('a clip whose rotations do not match its nodes is refused by name', () => {
  assert.throws(
    () => widenClip({ nodes: ['a', 'b'], rotations: [[0, 0, 0, 1]] }, 'walk.json'),
    /walk\.json: 2 nodes needs 8 numbers a frame, got 4/
  )
})

test('a clip with no rotations is refused', () => {
  assert.throws(() => widenClip({ nodes: ['a'], rotations: [] }, 'walk.json'), /no rotations/)
})

// --------------------------------------------------------------- the sampler
test('time zero is frame zero exactly', () => {
  assert.deepEqual(at(0).pose.hips, [0, 0, 0, 1])
  assert.deepEqual(at(0).pose.head, [0, 0, 0, 1])
})

test('a whole frame time lands on that frame', () => {
  // 10 frames a second, so 0.1s is frame one.
  assert.deepEqual(at(0.1).pose.hips, [1, 0, 0, 0])
})

test('between two frames it blends, and the result stays a rotation', () => {
  const turn = at(0.15).pose.hips
  assert.ok(turn[0] > 0 && turn[1] > 0, 'moving from frame 1 toward frame 2')
  assert.ok(Math.abs(length(turn) - 1) < 1e-9, `normalised, got ${length(turn)}`)
})

test('a looping clip wraps back to its first frame', () => {
  assert.deepEqual(at(0.3).pose.hips, [0, 0, 0, 1], 'three frames at 10fps is one loop')
})

test('a clip holds its last frame once, and says it is done', () => {
  const once = widenClip({ ...clipSource(), loop: false }, 'once.json')
  const entity = at(9, once)
  assert.deepEqual(entity.pose.hips, [0, 1, 0, 0], 'the last frame')
  assert.equal(entity.rigDone, true)
})

test('opposite signs interpolate the short way round', () => {
  // The same rotation written twice, once negated. Blending them must not
  // travel through zero, which is what an unsigned blend does.
  const clip = widenClip({
    nodes: ['hips'], framesPerSecond: 10, loop: false,
    rotations: [[0, 0, 0, 1], [0, 0, 0, -1]]
  }, 'signs.json')
  const turn = at(0.05, clip).pose.hips
  assert.ok(Math.abs(Math.abs(turn[3]) - 1) < 1e-9, `held still, got ${JSON.stringify(turn)}`)
})

// ------------------------------------------------------------- root movement
test('the root position is written every step, in metres', () => {
  assert.deepEqual(at(0.1).rigRoot, [0, 1, 1])
})

test('root motion is off unless the type asks for it', () => {
  const entity = { x: 5, y: 0, z: 5, _rigTime: 0 }
  applyClip(entity, CLIP, {})
  entity._rigTime = 0.1
  applyClip(entity, CLIP, {})
  assert.equal(entity.z, 5, 'the entity did not move')
})

test('the last frame holds its root rather than blending back to the first', () => {
  // 3 frames at 10fps, so 0.25s is halfway between the last frame and the wrap.
  // Blending the root back to frame zero there runs the walk backwards.
  const entity = at(0.25)
  assert.deepEqual(entity.rigRoot, [0, 1, 2], 'held the last root')
  const turn = entity.pose.hips
  assert.ok(turn[1] > 0 && turn[3] > 0, 'the rotation still wraps toward the first frame')
})

test('root motion adds the step travel, and a loop does not snap it back', () => {
  const entity = { x: 5, y: 0, z: 5, _rigTime: 0 }
  const rig = { rootMotion: true }
  applyClip(entity, CLIP, rig)
  entity._rigTime = 0.1
  applyClip(entity, CLIP, rig)
  assert.equal(entity.z, 6, 'one metre of clip travel moved it one metre')
  entity._rigTime = 0.3
  applyClip(entity, CLIP, rig)
  assert.equal(entity.z, 6, 'wrapping to frame zero moved it nowhere')
})

// -------------------------------------------------------------- the builder
test('a skeleton is recognised by its joint count', () => {
  assert.equal(skeletonFor(30), 'soma-30')
  assert.equal(skeletonFor(22), 'smplx-22')
  assert.equal(skeletonFor(34), 'g1-34')
  assert.equal(skeletonFor(7), null)
})

test('a map renames the joints it names and drops the rest', () => {
  const clip = buildClip({
    ...rawMotion(), skeleton: 'soma-30',
    map: { Hips: 'pelvis', Head: { node: 'skull' } }
  })
  assert.deepEqual(clip.nodes, ['pelvis', 'skull'])
  assert.equal(clip.rotations[0].length, 8, 'two nodes is eight numbers a frame')
})

test('several source joints compose into one node', () => {
  const chain = buildClip({
    ...rawMotion(), skeleton: 'soma-30',
    map: { spine: { node: 'torso', from: ['Spine1', 'Spine2', 'Chest'] } }
  })
  const single = buildClip({ ...rawMotion(), skeleton: 'soma-30', map: { Spine1: 'torso' } })
  assert.deepEqual(chain.nodes, ['torso'])
  assert.notDeepEqual(chain.rotations[1], single.rotations[1], 'three joints turn further than one')
})

test('a map naming a joint the skeleton has not got is refused', () => {
  assert.throws(
    () => buildClip({ ...rawMotion(), skeleton: 'soma-30', map: { Elbow: 'armLeft' } }),
    /joint Elbow, which this skeleton has not got/
  )
})

test('a note in the map is skipped rather than read as a joint', () => {
  const clip = buildClip({ ...rawMotion(), skeleton: 'soma-30', map: { _why: 'a note', Hips: 'pelvis' } })
  assert.deepEqual(clip.nodes, ['pelvis'])
})

test('an offset in the map is applied to every frame', () => {
  const quarterTurn = [0, 0, Math.SQRT1_2, Math.SQRT1_2]
  const plain = buildClip({ ...rawMotion(), skeleton: 'soma-30', map: { Hips: 'pelvis' } })
  const turned = buildClip({
    ...rawMotion(), skeleton: 'soma-30',
    map: { Hips: { node: 'pelvis', offset: quarterTurn } }
  })
  const expected = multiply(plain.rotations[0].slice(0, 4), quarterTurn).map(v => Number(v.toFixed(4)))
  assert.deepEqual(turned.rotations[0], expected)
})

test('a Z-up capture is turned into the Y-up the engine draws in', () => {
  const clip = buildClip({ ...rawMotion(), skeleton: 'soma-30', map: { Hips: 'pelvis' }, upAxis: 'z' })
  // Frame one is [0, 1, 2] as captured; Y and Z swap and Z is negated.
  assert.deepEqual(clip.root[1], [0, 2, -1])
})

test('a wrong skeleton for the buffer is refused, not guessed', () => {
  assert.throws(() => buildClip({ ...rawMotion(), skeleton: 'smplx-22' }), /22 joints, the buffer has 30/)
})

test('a written clip reads back as the same clip', () => {
  const clip = buildClip({ ...rawMotion(), skeleton: 'soma-30', name: 'walk' })
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rig-')), 'walk.json')
  writeClip(file, clip)
  const read = widenClip(JSON.parse(fs.readFileSync(file, 'utf8')), 'walk.json')
  assert.equal(read.nodes.length, SKELETONS['soma-30'].names.length)
  assert.equal(read.count, 3)
  assert.deepEqual(read.rotations, clip.rotations)
  assert.equal(read.source, null, 'no source was given, so none is invented')
  fs.rmSync(path.dirname(file), { recursive: true, force: true })
})

// --------------------------------------------------------------- in a world
test('the plugin loads headless and contributes its verbs', async () => {
  const { context, engine } = await startWorldInNode({ root: ROOT, project: FIXTURE })
  assert.equal(typeof context.rigAnimation.load, 'function')
  assert.equal(typeof context.rigAnimation.clip, 'function')
  const clips = await engine.run('rig.clips')
  assert.equal(typeof clips, 'object', 'rig.clips answers even when no type declares one')
})

test('a clip file that is not there fails by name', async () => {
  const { context } = await startWorldInNode({ root: ROOT, project: FIXTURE })
  await assert.rejects(context.rigAnimation.load('motion/nothing-here.json'), /nothing-here\.json/)
})

/** Three frames of every soma joint, and a root that walks along Z. */
function rawMotion() {
  const joints = SKELETONS['soma-30'].names.length
  const frames = 3
  const rotations = new Float32Array(frames * joints * 4)
  for (let frame = 0; frame < frames; frame++) {
    for (let joint = 0; joint < joints; joint++) {
      const angle = frame * 0.1 + joint * 0.01
      const position = (frame * joints + joint) * 4
      rotations[position] = Math.sin(angle / 2)
      rotations[position + 3] = Math.cos(angle / 2)
    }
  }
  const root = new Float32Array([0, 0, 0, 0, 1, 2, 0, 2, 4])
  return { rotations, root, joints, frames }
}

/** The literal CLIP is widened, so a second copy of its source is needed to vary it. */
function clipSource() {
  return {
    name: 'test', framesPerSecond: 10, nodes: ['hips', 'head'],
    rotations: [
      [0, 0, 0, 1, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 1],
      [0, 1, 0, 0, 0, 0, 0, 1]
    ],
    root: [[0, 1, 0], [0, 1, 1], [0, 1, 2]]
  }
}
