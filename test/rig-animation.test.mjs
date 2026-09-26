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
import { applyLayer } from '../plugins/builtin/rig-animation/layer.js'
import { applyCrossfade, crossfadeFrom } from '../plugins/builtin/rig-animation/crossfade.js'
import { widenSkeleton, placeOf } from '../plugins/builtin/rig-animation/skeleton.js'
import { applyConstraints } from '../plugins/builtin/rig-animation/constraints.js'
import { worldPointOf } from '../plugins/builtin/rig-animation/targets.js'
import { constraintsForControls } from '../plugins/builtin/rig-animation/controls.js'
import { rigView } from '../plugins/builtin/rig-animation/rig-view.js'
import { rotate } from '../plugins/builtin/rig-animation/turns.js'
import {
  buildClip,
  writeClip,
  skeletonFor,
  loopWindow,
  closeQuaternionLoop,
  closeVectorLoop,
  SKELETONS
} from '../tools/lib/motion-clip.mjs'
import { withRestWorld, captureWorldTurns, planRetarget, neutralFor, multiply } from '../tools/lib/retarget.mjs'
import { findMap, mapsFor, nodesOf } from '../tools/lib/rig-maps.mjs'
import { guessMap } from '../tools/lib/rig-map-guess.mjs'
import { retargetSources } from '../tools/lib/retarget-clips.mjs'
import { checkClips } from '../tools/lib/rig-check.mjs'
import { FIXTURE } from './fixture-project.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Three frames of two nodes: the first turns, the second rests. */
const CLIP = widenClip(
  {
    name: 'test',
    framesPerSecond: 10,
    loop: true,
    nodes: ['hips', 'head'],
    rotations: [
      [0, 0, 0, 1, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 1],
      [0, 1, 0, 0, 0, 0, 0, 1]
    ],
    root: [
      [0, 1, 0],
      [0, 1, 1],
      [0, 1, 2]
    ]
  },
  'test'
)

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

test('a node with positions gets its local position after its rotation, blended', () => {
  const clip = widenClip(
    {
      ...clipSource(),
      positions: {
        head: [
          [0, 0, 0],
          [0, 2, 0],
          [0, 4, 0]
        ]
      }
    },
    'moves.json'
  )
  assert.deepEqual(at(0.15, clip).pose.head.slice(4), [0, 3, 0])
  assert.equal(at(0.15, clip).pose.hips.length, 4, 'a node without positions stays a rotation')
  assert.throws(
    () => widenClip({ ...clipSource(), positions: { tail: [[0, 0, 0]] } }, 'moves.json'),
    /positions names tail/
  )
})

test('opposite signs interpolate the short way round', () => {
  // The same rotation written twice, once negated. Blending them must not
  // travel through zero, which is what an unsigned blend does.
  const clip = widenClip(
    {
      nodes: ['hips'],
      framesPerSecond: 10,
      loop: false,
      rotations: [
        [0, 0, 0, 1],
        [0, 0, 0, -1]
      ]
    },
    'signs.json'
  )
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
    ...rawMotion(),
    skeleton: 'soma-30',
    map: { Hips: 'pelvis', Head: { node: 'skull' } }
  })
  assert.deepEqual(clip.nodes, ['pelvis', 'skull'])
  assert.equal(clip.rotations[0].length, 8, 'two nodes is eight numbers a frame')
})

test('several source joints compose into one node', () => {
  const chain = buildClip({
    ...rawMotion(),
    skeleton: 'soma-30',
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
    ...rawMotion(),
    skeleton: 'soma-30',
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

test('retargeting onto a model with other bone axes puts every joint where the capture put it', () => {
  const soma = SKELETONS['soma-30']
  const model = twistedCopyOf(soma)
  const map = Object.fromEntries(soma.names.map(name => [name, { node: `bone-${name}` }]))
  const motion = rawMotion()
  const clip = buildClip({ ...motion, skeleton: 'soma-30', map, model, standing: false })

  const last = motion.frames - 1
  const captured = captureWorldTurns(
    soma.names.map((_, joint) =>
      Array.from(motion.rotations.slice((last * motion.joints + joint) * 4, (last * motion.joints + joint + 1) * 4))
    ),
    soma,
    0
  )
  const expected = positionsOf(soma.parents, soma.offsets, captured)
  const local = clip.nodes.map((_, index) => clip.rotations[last].slice(index * 4, index * 4 + 4))
  const posed = positionsOf(
    model.map(node => node.parent),
    model.map(node => node.translation),
    worldFromLocal(
      model.map(node => node.parent),
      local
    )
  )
  for (const joint of ['LeftHand', 'RightToeBase', 'Head']) {
    const index = soma.names.indexOf(joint)
    for (let axis = 0; axis < 3; axis++)
      assert.ok(Math.abs(posed[index][axis] - expected[index][axis]) < 1e-3, `${joint} axis ${axis}`)
  }
})

test('a cycle keeps the frames between the two best matching poses', () => {
  const frames = Array.from({ length: 60 }, (_, frame) => {
    const angle = (frame / 15) * Math.PI
    return [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)]
  })
  // A full turn every 30 frames returns to the same pose at frame 30 as at frame 0.
  const window = loopWindow(frames)
  assert.equal(window.last - window.first, 30)
})

test('a model built facing the other way takes the motion turned to its own facing', () => {
  const soma = SKELETONS['soma-30']
  const model = twistedCopyOf(soma)
  const halfTurn = [0, 1, 0, 0]
  model[0].rotation = multiply(halfTurn, model[0].rotation)
  withRestWorld(model)
  const map = Object.fromEntries(soma.names.map(name => [name, { node: `bone-${name}` }]))
  const motion = rawMotion()
  const clip = buildClip({ ...motion, root: null, skeleton: 'soma-30', map, model, standing: false })
  const last = motion.frames - 1
  const captured = captureWorldTurns(
    soma.names.map((_, joint) =>
      Array.from(motion.rotations.slice((last * motion.joints + joint) * 4, (last * motion.joints + joint + 1) * 4))
    ),
    soma,
    0
  )
  const expected = positionsOf(soma.parents, soma.offsets, captured).map(position => rotateVector(halfTurn, position))
  const local = clip.nodes.map((_, index) => clip.rotations[last].slice(index * 4, index * 4 + 4))
  const posed = positionsOf(
    model.map(node => node.parent),
    model.map(node => node.translation),
    worldFromLocal(
      model.map(node => node.parent),
      local
    )
  )
  const hand = soma.names.indexOf('LeftHand')
  for (let axis = 0; axis < 3; axis++)
    assert.ok(
      Math.abs(posed[hand][axis] - expected[hand][axis]) < 2e-3,
      `hand axis ${axis}: ${posed[hand][axis]} vs ${expected[hand][axis]}`
    )
})

test('an arm hung off a bone the map never names still follows the shoulder that drives it', () => {
  const soma = SKELETONS['soma-30']
  const model = twistedCopyOf(soma)
  // Hang the upper arm off Spine1, as Rigify hangs DEF-upper_arm off ORG-shoulder, keeping its rest place.
  const arm = model.find(node => node.name === 'bone-LeftArm')
  const holder = model.findIndex(node => node.name === 'bone-Spine1')
  arm.parent = holder
  const inverseHolder = [
    -model[holder].worldRotation[0],
    -model[holder].worldRotation[1],
    -model[holder].worldRotation[2],
    model[holder].worldRotation[3]
  ]
  arm.translation = rotateVector(
    inverseHolder,
    arm.worldPosition.map((value, axis) => value - model[holder].worldPosition[axis])
  )
  arm.rotation = multiply(inverseHolder, arm.worldRotation)
  withRestWorld(model)

  const map = Object.fromEntries(soma.names.map(name => [name, { node: `bone-${name}` }]))
  const motion = rawMotion()
  const clip = buildClip({ ...motion, root: null, skeleton: 'soma-30', map, model, standing: false })
  const last = motion.frames - 1
  assert.ok(clip.positions?.['bone-LeftArm'], 'the arm carries a position')

  const captured = captureWorldTurns(
    soma.names.map((_, joint) =>
      Array.from(motion.rotations.slice((last * motion.joints + joint) * 4, (last * motion.joints + joint + 1) * 4))
    ),
    soma,
    0
  )
  const expected = positionsOf(soma.parents, soma.offsets, captured)
  const byNode = new Map(clip.nodes.map((name, index) => [name, index]))
  const parents = model.map(node => node.parent)
  const local = model.map(node =>
    byNode.has(node.name)
      ? clip.rotations[last].slice(byNode.get(node.name) * 4, byNode.get(node.name) * 4 + 4)
      : node.rotation
  )
  const translations = model.map(node => clip.positions?.[node.name]?.[last] || node.translation)
  const posed = positionsOf(parents, translations, worldFromLocal(parents, local))
  const hand = soma.names.indexOf('LeftHand')
  const handNode = model.findIndex(node => node.name === 'bone-LeftHand')
  for (let axis = 0; axis < 3; axis++)
    assert.ok(Math.abs(posed[handNode][axis] - expected[hand][axis]) < 2e-3, `hand axis ${axis}`)
})

test('a capture standing in its usual stance leaves the spine at the model rest', () => {
  const soma = SKELETONS['soma-30']
  const model = twistedCopyOf(soma)
  const map = Object.fromEntries(soma.names.map(name => [name, { node: `bone-${name}` }]))
  const stance = neutralFor('soma-30')
  const rotations = new Float32Array(soma.names.length * 4 * 2)
  soma.names.forEach((name, joint) => rotations.set(stance[name] || [0, 0, 0, 1], joint * 4))
  rotations.copyWithin(soma.names.length * 4, 0, soma.names.length * 4)
  const clip = buildClip({
    rotations,
    root: null,
    joints: soma.names.length,
    frames: 2,
    skeleton: 'soma-30',
    map,
    model
  })
  for (const name of ['Chest', 'Neck1', 'Head']) {
    const turn = clip.rotations[0].slice(
      clip.nodes.indexOf(`bone-${name}`) * 4,
      clip.nodes.indexOf(`bone-${name}`) * 4 + 4
    )
    const rest = model.find(node => node.name === `bone-${name}`).rotation
    const dot = Math.abs(turn.reduce((sum, value, axis) => sum + value * rest[axis], 0))
    assert.ok(dot > 0.9999, `${name} stays at rest, dot ${dot}`)
  }
})

test('a tilted pelvis bone keeps its tilt, so the body above it does not lean back', () => {
  const soma = SKELETONS['soma-30']
  const model = twistedCopyOf(soma)
  // Move Spine1's bone forward of the hips, as a Rigify pelvis bone rests.
  const spine = model.find(node => node.name === 'bone-Spine1')
  spine.translation = [0, spine.translation[1], spine.translation[2] + 0.1]
  withRestWorld(model)
  const map = { Hips: { node: 'bone-Hips' }, Spine1: { node: 'bone-Spine1' } }
  const plan = planRetarget({ map, skeleton: soma, model })
  assert.deepEqual(
    plan.find(entry => entry.node === 'bone-Hips').alignment.map(value => value + 0),
    [0, 0, 0, 1]
  )
})

test('a bone map is guessed from Mixamo, Unreal and Biped names', () => {
  const chain = names => names.map((name, index) => ({ name, parent: index ? 0 : -1 }))
  const mixamo = guessMap(
    chain(
      [
        'Hips',
        'Spine',
        'Spine1',
        'Spine2',
        'Neck',
        'Head',
        'LeftShoulder',
        'LeftArm',
        'LeftForeArm',
        'LeftHand',
        'RightShoulder',
        'RightArm',
        'RightForeArm',
        'RightHand',
        'LeftUpLeg',
        'LeftLeg',
        'LeftFoot',
        'LeftToeBase',
        'RightUpLeg',
        'RightLeg',
        'RightFoot',
        'RightToeBase'
      ].map(name => `mixamorig:${name}`)
    )
  ).map
  assert.equal(mixamo.LeftLeg.node, 'mixamorig:LeftUpLeg')
  assert.equal(mixamo.LeftShin.node, 'mixamorig:LeftLeg')
  assert.equal(mixamo.Chest.node, 'mixamorig:Spine2')
  const unreal = guessMap(
    chain([
      'pelvis',
      'spine_01',
      'spine_02',
      'spine_03',
      'neck_01',
      'head',
      'clavicle_l',
      'upperarm_l',
      'upperarm_twist_01_l',
      'lowerarm_l',
      'hand_l',
      'clavicle_r',
      'upperarm_r',
      'lowerarm_r',
      'hand_r',
      'thigh_l',
      'calf_l',
      'foot_l',
      'ball_l',
      'thigh_r',
      'calf_r',
      'foot_r',
      'ball_r'
    ])
  ).map
  assert.equal(unreal.LeftArm.node, 'upperarm_l', 'a twist bone is not the arm')
  assert.equal(unreal.RightShin.node, 'calf_r')
  const biped = guessMap(
    chain([
      'Bip01 Pelvis',
      'Bip01 Spine',
      'Bip01 Spine1',
      'Bip01 Neck',
      'Bip01 Head',
      'Bip01 L UpperArm',
      'Bip01 L Forearm',
      'Bip01 L Hand',
      'Bip01 R UpperArm',
      'Bip01 R Forearm',
      'Bip01 R Hand',
      'Bip01 L Thigh',
      'Bip01 L Calf',
      'Bip01 L Foot',
      'Bip01 R Thigh',
      'Bip01 R Calf',
      'Bip01 R Foot'
    ])
  ).map
  assert.equal(biped.RightHand.node, 'Bip01 R Hand')
  assert.throws(() => guessMap(chain(['Bone', 'Bone.001'])), /could not guess a bone map: no node for Hips/)
})

test('a deforming bone no mapped bone carries follows the nearest one', () => {
  const soma = SKELETONS['soma-30']
  const model = twistedCopyOf(soma)
  // A pelvis side bone hung off the root helper, as Rigify's DEF-pelvis.L is.
  const helper = { name: 'helper', parent: -1, rotation: [0, 0, 0, 1], translation: [0, 0, 0], scale: 1 }
  model.push(helper)
  model.push({
    name: 'side',
    parent: model.length - 1,
    rotation: [0, 0, 0, 1],
    translation: [0.05, 0, 0],
    scale: 1,
    joint: true
  })
  model.forEach(node => {
    if (node.name.startsWith('bone-')) node.joint = true
  })
  withRestWorld(model)
  const map = Object.fromEntries(soma.names.map(name => [name, { node: `bone-${name}` }]))
  const clip = buildClip({ ...rawMotion(), root: null, skeleton: 'soma-30', map, model, standing: false })
  assert.ok(clip.nodes.includes('side'), 'the follower is in the clip')
  assert.ok(!clip.nodes.includes('helper'), 'a bone that does not deform is left alone')
  assert.ok(clip.positions.side, 'and it moves as well as turns')
})

test("the bone map is found from the model's own node names", () => {
  const rigify = nodesOf(mapsFor('soma-30').find(one => one.rig === 'rigify').map)
  const model = rigify.map(name => ({ name }))
  assert.equal(findMap('soma-30', model).rig, 'rigify')
  assert.throws(
    () => findMap('soma-30', [{ name: 'Bone' }, { name: 'Bone.001' }]),
    /no bone map .* Its nodes start: Bone, Bone\.001/
  )
})

test('stored motion goes onto a model in one call, with the map found and the rig block returned', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-retarget-'))
  try {
    const motion = standingMotion()
    const source = path.join(project, 'assets/motion/source/walk')
    fs.mkdirSync(source, { recursive: true })
    fs.writeFileSync(path.join(source, 'local_rotations_xyzw.f32'), Buffer.from(motion.rotations.buffer))
    fs.writeFileSync(path.join(source, 'root_positions.f32'), Buffer.from(motion.root.buffer))
    fs.writeFileSync(path.join(source, 'prompt.txt'), 'a person walks')
    const rigify = mapsFor('soma-30').find(one => one.rig === 'rigify').map
    const nodeFor = Object.fromEntries(
      Object.entries(rigify)
        .filter(([key]) => !key.startsWith('_'))
        .map(([joint, entry]) => [joint, entry.node])
    )
    const skeleton = twistedCopyOf(SKELETONS['soma-30'])
    skeleton.forEach(node => {
      node.name = nodeFor[node.name.slice('bone-'.length)] || node.name
    })
    fs.mkdirSync(path.join(project, 'assets/models'), { recursive: true })
    fs.writeFileSync(path.join(project, 'assets/models/hero.glb'), glbOf(skeleton))

    const done = retargetSources({ project, model: 'models/hero.glb' })
    assert.equal(done.rig, 'rigify')
    assert.deepEqual(done.declare.rig.clips, { walk: 'motion/hero/walk.json' })
    const clip = JSON.parse(fs.readFileSync(path.join(project, 'assets/motion/hero/walk.json'), 'utf8'))
    assert.equal(clip.nodes.length, nodesOf(rigify).length)
    assert.equal(clip.source.prompt, 'a person walks')

    const clean = checkClips({ project, model: 'models/hero.glb' })
    assert.deepEqual(clean.findings, [], 'a right map has no findings')

    const swapped = JSON.parse(JSON.stringify(rigify))
    for (const part of ['Shoulder', 'Arm', 'ForeArm', 'Hand']) {
      ;[swapped[`Left${part}`].node, swapped[`Right${part}`].node] = [
        swapped[`Right${part}`].node,
        swapped[`Left${part}`].node
      ]
    }
    fs.mkdirSync(path.join(project, 'assets/motion/maps'), { recursive: true })
    fs.writeFileSync(path.join(project, 'assets/motion/maps/hero.json'), JSON.stringify(swapped))
    assert.equal(
      retargetSources({ project, model: 'models/hero.glb' }).map,
      'assets/motion/maps/hero.json',
      'a map in the game wins'
    )
    const wrong = checkClips({ project, model: 'models/hero.glb' })
    assert.ok(
      wrong.findings.some(finding => /turn over 100/.test(finding)),
      `swapped sides are found: ${wrong.findings}`
    )
  } finally {
    fs.rmSync(project, { recursive: true, force: true })
  }
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

/**
 * The capture's skeleton as a model: same rest positions, but every bone rests
 * with a different local rotation, as a Blender rig's bones do.
 */
function twistedCopyOf(skeleton) {
  const nodes = []
  const world = []
  skeleton.names.forEach((name, index) => {
    const parent = skeleton.parents[index]
    const angle = 0.3 + index * 0.2
    const rotation = [Math.sin(angle / 2) * 0.6, Math.sin(angle / 2) * 0.8, 0, Math.cos(angle / 2)]
    world[index] = parent < 0 ? rotation : multiply(world[parent], rotation)
    const parentWorld = parent < 0 ? [0, 0, 0, 1] : world[parent]
    const translation = rotateVector(
      [-parentWorld[0], -parentWorld[1], -parentWorld[2], parentWorld[3]],
      skeleton.offsets[index]
    )
    nodes.push({ name: `bone-${name}`, parent, rotation, translation, scale: 1 })
  })
  return withRestWorld(nodes)
}

/** A .glb holding only a node tree: enough for `readModelSkeleton`. */
function glbOf(nodes) {
  const document = {
    asset: { version: '2.0' },
    nodes: nodes.map((node, index) => ({
      name: node.name,
      rotation: node.rotation,
      translation: node.translation,
      children: nodes
        .map((child, childIndex) => (child.parent === index ? childIndex : -1))
        .filter(childIndex => childIndex >= 0)
    }))
  }
  let json = Buffer.from(JSON.stringify(document))
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)])
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(20 + json.length, 8)
  header.writeUInt32LE(json.length, 12)
  header.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([header, json])
}

function worldFromLocal(parents, local) {
  const world = []
  parents.forEach((parent, index) => {
    world[index] = parent < 0 ? local[index] : multiply(world[parent], local[index])
  })
  return world
}

function positionsOf(parents, translations, world) {
  const positions = []
  parents.forEach((parent, index) => {
    const moved = parent < 0 ? [0, 0, 0] : rotateVector(world[parent], translations[index])
    positions[index] = parent < 0 ? translations[index] : positions[parent].map((value, axis) => value + moved[axis])
  })
  return positions
}

function rotateVector(turn, vector) {
  const moved = multiply(multiply(turn, [...vector, 0]), [-turn[0], -turn[1], -turn[2], turn[3]])
  return [moved[0], moved[1], moved[2]]
}

/** Three frames of every soma joint at rest, hips at standing height: a body that is plainly right. */
function standingMotion() {
  const joints = SKELETONS['soma-30'].names.length
  const frames = 3
  const rotations = new Float32Array(frames * joints * 4)
  for (let at = 3; at < rotations.length; at += 4) rotations[at] = 1
  return { rotations, root: new Float32Array([0, 0.99, 0, 0, 0.99, 0, 0, 0.99, 0]), joints, frames }
}

/** The literal CLIP is widened, so a second copy of its source is needed to vary it. */
function clipSource() {
  return {
    name: 'test',
    framesPerSecond: 10,
    nodes: ['hips', 'head'],
    rotations: [
      [0, 0, 0, 1, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 1],
      [0, 1, 0, 0, 0, 0, 0, 1]
    ],
    root: [
      [0, 1, 0],
      [0, 1, 1],
      [0, 1, 2]
    ]
  }
}

test('a closed loop ends where it starts: the last kept frame steps into the first like any other', () => {
  // A turn about X that drifts 6 degrees over the window, so the pose it returns to is off.
  const frames = Array.from({ length: 25 }, (_, frame) => {
    const angle = (frame / 24) * ((6 * Math.PI) / 180)
    return [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)]
  })
  const closed = closeQuaternionLoop(frames)
  assert.equal(closed.length, 24, 'the closing frame is dropped')
  const angleOf = quaternion => 2 * Math.asin(quaternion[0])
  const seam = Math.abs(angleOf(closed[23]) - angleOf(closed[0]))
  const step = Math.abs(angleOf(closed[1]) - angleOf(closed[0]))
  assert.ok(seam < 1e-4, `the drift is taken out, so the last frame matches the first (${seam})`)
  assert.ok(Math.abs(step) < 1e-4, 'a steady drift and nothing else leaves a still pose')
})

test('a closed loop of positions spreads the jump back to the start', () => {
  const closed = closeVectorLoop([
    [0, 0, 0],
    [0, 1, 0],
    [0, 2, 0],
    [0, 3, 0],
    [0, 4, 0]
  ])
  assert.deepEqual(closed, [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ])
})

// ------------------------------------------------------------------ layers
/** A clip that holds the head turned half round about Y and the hips half round about X. */
const WAVE = widenClip(
  {
    name: 'wave',
    framesPerSecond: 10,
    loop: false,
    nodes: ['hips', 'head'],
    rotations: [
      [1, 0, 0, 0, 0, 1, 0, 0],
      [1, 0, 0, 0, 0, 1, 0, 0]
    ]
  },
  'wave'
)
const LAYERED_RIG = { clips: { wave: 'wave.json' }, masks: { upper: ['head'] }, layerFade: 0.1 }
const clipOf = file => (file === 'wave.json' ? WAVE : null)

/** The base clip at rest, then the layer stepped `steps` times of 1/60 s. */
function layered(steps, rigLayer = { clip: 'wave', mask: 'upper' }) {
  const entity = at(0)
  entity.rigLayer = rigLayer
  for (let step = 0; step < steps; step++) applyLayer(entity, LAYERED_RIG, 1 / 60, clipOf)
  return entity
}

test('a layer turns only the nodes in its mask, once faded in', () => {
  const entity = layered(12)
  assert.deepEqual(entity.pose.head.map(Math.abs), [0, 1, 0, 0], 'the head plays the layer')
  assert.deepEqual(entity.pose.hips, [0, 0, 0, 1], 'the hips keep the base clip')
})

test('a layer fades in: part way in, the node is between the base and the layer', () => {
  const entity = layered(3)
  const turn = Math.abs(entity.pose.head[1])
  assert.ok(turn > 0.1 && turn < 0.95, `half faded, the head is part way round (${turn})`)
})

test('a layer with a speed plays its clip that many times faster', () => {
  assert.equal(layered(5).rigLayerDone, false, 'at speed 1 the clip is not done after 5 steps')
  assert.equal(layered(5, { clip: 'wave', mask: 'upper', speed: 3 }).rigLayerDone, true, 'at speed 3 it is')
})

test('a new startedAt plays the same clip again from its start', () => {
  const entity = layered(12, { clip: 'wave', mask: 'upper', startedAt: 1 })
  assert.equal(entity.rigLayerDone, true)
  entity.rigLayer = { clip: 'wave', mask: 'upper', startedAt: 2 }
  applyLayer(entity, LAYERED_RIG, 1 / 60, clipOf)
  assert.equal(entity.rigLayerDone, false, 'the second press is not done')
  assert.equal(entity._rigLayer.time, 0, 'and starts at the first frame')
})

test('a layer that plays once says when it is done, and fades out when let go', () => {
  const entity = layered(12)
  assert.equal(entity.rigLayerDone, true, 'a two-frame clip at 10 fps is done after 0.2 s')
  entity.rigLayer = null
  for (let step = 0; step < 12; step++) {
    applyClip(entity, CLIP, {})
    applyLayer(entity, LAYERED_RIG, 1 / 60, clipOf)
  }
  assert.deepEqual(entity.pose.head, [0, 0, 0, 1], 'faded out, the head is back on the base clip')
  assert.equal(entity._rigLayer, null, 'and the layer is gone')
})

// ------------------------------------------------------------------ constraints

/** A body with one arm hanging from a shoulder 1.5 m up: upper arm, forearm and hand, 0.3 m each. */
const ARM_SKELETON = widenSkeleton(
  {
    nodes: {
      body: { parent: null, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: 1 },
      arm: { parent: 'body', position: [0, 1.5, 0], rotation: [0, 0, 0, 1], scale: 1 },
      forearm: { parent: 'arm', position: [0, -0.3, 0], rotation: [0, 0, 0, 1], scale: 1 },
      hand: { parent: 'forearm', position: [0, -0.3, 0], rotation: [0, 0, 0, 1], scale: 1 }
    }
  },
  'arm.json'
)

/** An entity posed with the elbow bent a little forward, reaching for `target`. */
function reachingArm(target, extra = {}) {
  const bend = Math.sin(0.2)
  return {
    id: 'reacher',
    pose: { arm: [0, 0, 0, 1], forearm: [bend, 0, 0, Math.cos(0.2)], hand: [0, 0, 0, 1] },
    rigConstraints: [{ kind: 'reach', nodes: ['arm', 'forearm', 'hand'], target, weight: 1, ...extra }]
  }
}

const distance = (first, second) => Math.hypot(...first.map((value, axis) => value - second[axis]))

test('reach puts the hand on a point in a node, solved on the pose itself', () => {
  const entity = reachingArm({ node: 'body', at: [0.3, 1.2, 0.2] })
  applyConstraints(entity, ARM_SKELETON, entity.rigConstraints, 1 / 60)
  const hand = placeOf(ARM_SKELETON, entity.pose, 'hand').position
  assert.ok(distance(hand, [0.3, 1.2, 0.2]) < 1e-3, `the hand is at ${hand.map(value => value.toFixed(3))}`)
})

test('reach takes a world point through the entity place and turn', () => {
  // Turned a quarter round and moved 2 m along X: the world point is the same body point as above.
  const entity = { ...reachingArm({ point: [2 + 0.2, 1.2, -0.3] }), x: 2, y: 0, z: 0, yaw: Math.PI / 2 }
  applyConstraints(entity, ARM_SKELETON, entity.rigConstraints, 1 / 60)
  const hand = placeOf(ARM_SKELETON, entity.pose, 'hand').position
  assert.ok(distance(hand, [0.3, 1.2, 0.2]) < 1e-3, `the hand is at ${hand.map(value => value.toFixed(3))}`)
})

test('reach takes a model point, which turns with the entity and no bone', () => {
  const entity = { ...reachingArm({ model: [0.3, 1.2, 0.2] }), x: 2, y: 0, z: 0, yaw: Math.PI / 2 }
  applyConstraints(entity, ARM_SKELETON, entity.rigConstraints, 1 / 60)
  const hand = placeOf(ARM_SKELETON, entity.pose, 'hand').position
  assert.ok(distance(hand, [0.3, 1.2, 0.2]) < 1e-3, `the hand is at ${hand.map(value => value.toFixed(3))}`)
})

test('reach at weight 0 leaves the pose as the clip wrote it', () => {
  const entity = reachingArm({ node: 'body', at: [0.3, 1.2, 0.2] }, { weight: 0 })
  const before = JSON.stringify(entity.pose)
  applyConstraints(entity, ARM_SKELETON, entity.rigConstraints, 1 / 60)
  assert.equal(JSON.stringify(entity.pose), before)
})

test('a pole sets the side the elbow bends to', () => {
  const entity = reachingArm({ node: 'body', at: [0, 1.1, 0.1] }, { pole: { node: 'body', at: [0, 1.4, -1] } })
  applyConstraints(entity, ARM_SKELETON, entity.rigConstraints, 1 / 60)
  const elbow = placeOf(ARM_SKELETON, entity.pose, 'forearm').position
  assert.ok(elbow[2] < 0, `the elbow bends back towards the pole (z ${elbow[2].toFixed(3)})`)
})

/** A body with one leg: hip 0.9 m up, thigh 0.4 m, shin 0.42 m, so the ankle rests 0.08 m up. And a head. */
const LEG_SKELETON = widenSkeleton(
  {
    nodes: {
      body: { parent: null, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: 1 },
      upLeg: { parent: 'body', position: [0.1, 0.9, 0], rotation: [0, 0, 0, 1], scale: 1 },
      leg: { parent: 'upLeg', position: [0, -0.4, 0], rotation: [0, 0, 0, 1], scale: 1 },
      foot: { parent: 'leg', position: [0, -0.42, 0], rotation: [0, 0, 0, 1], scale: 1 },
      head: { parent: 'body', position: [0, 1.6, 0], rotation: [0, 0, 0, 1], scale: 1 }
    }
  },
  'leg.json'
)

const PLANT = { kind: 'plant', nodes: ['upLeg', 'leg', 'foot'], blend: 0 }

/** The clip's pose this step: hip and knee bent as in a stance, the foot on the ground unless `raised`. */
function standingPose(raised = 0) {
  const turn = angle => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)]
  return { upLeg: turn(-0.3 - raised), leg: turn(0.6), foot: [0, 0, 0, 1], head: [0, 0, 0, 1] }
}

/** One fixed step: the clip writes the pose, then the constraints change it. Answers the foot in the world. */
function stepLeg(entity, raised = 0) {
  entity.pose = standingPose(raised)
  applyConstraints(entity, LEG_SKELETON, [PLANT], 1 / 60)
  return worldPointOf(entity, placeOf(LEG_SKELETON, entity.pose, 'foot').position)
}

test('a planted foot stays where it touched the world while the body slides', () => {
  const entity = { id: 'walker', x: 0, y: 0, z: 0 }
  const touched = stepLeg(entity)
  for (let step = 0; step < 4; step++) {
    entity.x += 0.05
    stepLeg(entity)
  }
  const foot = stepLeg(entity)
  assert.ok(
    distance(foot, touched) < 0.01,
    `the foot is ${(distance(foot, touched) * 100).toFixed(1)} cm from where it touched`
  )
})

test('a planted foot lets go when the leg would overstretch, and plants again under the hip', () => {
  const entity = { id: 'walker', x: 0, y: 0, z: 0 }
  stepLeg(entity)
  entity.x += 1
  const foot = stepLeg(entity)
  assert.ok(Math.abs(foot[0] - 1.1) < 0.02, `the foot stepped under the hip (x ${foot[0].toFixed(3)})`)
})

test('a foot the clip lifts is not planted', () => {
  const entity = { id: 'walker', x: 0, y: 0, z: 0 }
  stepLeg(entity)
  entity.x += 0.1
  const lifted = stepLeg(entity, 0.6)
  const clipFoot = worldPointOf(entity, placeOf(LEG_SKELETON, standingPose(0.6), 'foot').position)
  assert.ok(distance(lifted, clipFoot) < 1e-6, 'the clip moves the lifted foot')
})

test('lookAt points the node forward axis at the target, within its limit', () => {
  const lookAt = { kind: 'lookAt', node: 'head', target: { point: [1, 1.6, 1] }, weight: 1 }
  const forwardOf = entity => rotate(placeOf(LEG_SKELETON, entity.pose, 'head').turn, [0, 0, 1])
  const free = { id: 'looker', x: 0, y: 0, z: 0, pose: standingPose() }
  applyConstraints(free, LEG_SKELETON, [lookAt], 1 / 60)
  const facing = forwardOf(free)
  assert.ok(Math.abs(Math.atan2(facing[0], facing[2]) - Math.PI / 4) < 1e-3, 'it faces the target, 45 degrees round')
  const held = { id: 'looker', x: 0, y: 0, z: 0, pose: standingPose() }
  applyConstraints(held, LEG_SKELETON, [{ ...lookAt, limit: 30 }], 1 / 60)
  const turned = Math.atan2(forwardOf(held)[0], forwardOf(held)[2])
  assert.ok(
    Math.abs(turned - Math.PI / 6) < 1e-3,
    `a limit of 30 degrees stops it at 30 (${((turned * 180) / Math.PI).toFixed(1)})`
  )
})

// ------------------------------------------------------------------ controls

const CONTROLS = {
  hand: { kind: 'limb', nodes: ['arm', 'forearm', 'hand'], pole: { node: 'body', at: [0, 1.3, -1] } },
  look: { kind: 'aim', node: 'head', limit: 40 }
}

test('a control request becomes its constraint, with the control pole unless the request names one', () => {
  const target = { point: [1, 1, 1] }
  const { constraints, refusals } = constraintsForControls(CONTROLS, {
    hand: [
      { target, weight: 1 },
      { target, weight: 0.5, pole: { point: [0, 2, 0] } }
    ],
    look: { target, weight: 1 }
  })
  assert.deepEqual(refusals, [])
  assert.deepEqual(
    constraints.map(constraint => [
      constraint.kind,
      constraint.weight,
      constraint.pole?.node ?? constraint.pole?.point ?? null
    ]),
    [
      ['reach', 1, 'body'],
      ['reach', 0.5, [0, 2, 0]],
      ['lookAt', 1, null]
    ]
  )
  assert.equal(constraints[2].limit, 40)
})

test('a control follows a path over time, fading in and out at its ends', () => {
  const path = [
    { at: 0, value: [0, 1, 0], ease: 'smooth' },
    { at: 1, value: [0.4, 1.2, 0.2] }
  ]
  const request = { path, startedAt: 10, speed: 2 }
  const middle = constraintsForControls(CONTROLS, { hand: request }, 10.25).constraints[0]
  assert.deepEqual(middle.target, { model: [0.2, 1.1, 0.1] })
  assert.equal(middle.weight, 1)
  assert.equal(constraintsForControls(CONTROLS, { hand: request }, 10.5).constraints[0].weight, 0)
  const inNode = constraintsForControls(CONTROLS, { hand: { ...request, node: 'body' } }, 10.25).constraints[0]
  assert.equal(inNode.target.node, 'body')
})

test('a request for a control the type has not got is refused by name', () => {
  const { constraints, refusals } = constraintsForControls(CONTROLS, {
    tail: { target: { point: [0, 0, 0] }, weight: 1 }
  })
  assert.equal(constraints.length, 0)
  assert.match(refusals[0], /no control "tail"; the type has hand, look/)
})

test('a limb control bends the arm through the pose, as a reach does', () => {
  const entity = { id: 'reacher', pose: reachingArm({ node: 'body' }).pose }
  const { constraints } = constraintsForControls(CONTROLS, {
    hand: { target: { node: 'body', at: [0.3, 1.2, 0.2] }, weight: 1 }
  })
  applyConstraints(entity, ARM_SKELETON, constraints, 1 / 60)
  const hand = placeOf(ARM_SKELETON, entity.pose, 'hand').position
  assert.ok(distance(hand, [0.3, 1.2, 0.2]) < 1e-3)
  assert.ok(
    placeOf(ARM_SKELETON, entity.pose, 'forearm').position[2] < 0,
    'the elbow points back, towards the control pole'
  )
})

test('the rig view gives bones and each constraint in world points, after the solve', () => {
  const entity = { ...reachingArm({ node: 'body', at: [0.3, 1.2, 0.2] }), x: 5, y: 0, z: 0 }
  applyConstraints(entity, ARM_SKELETON, entity.rigConstraints, 1 / 60)
  const view = rigView(entity, ARM_SKELETON, entity.rigConstraints)
  assert.equal(view.bones.length, 2, 'upper arm to forearm, forearm to hand')
  const [reach] = view.constraints
  assert.equal(reach.kind, 'reach')
  assert.ok(distance(reach.target, [5.3, 1.2, 0.2]) < 1e-6, 'the target is in the world, moved with the entity')
  assert.ok(distance(reach.end, reach.target) < 1e-3, 'and the hand is on it')
})

test('a new base clip fades in over the one left behind, then that one is dropped', () => {
  // The clip left behind holds the head a half turn about X; the new one leaves it at rest.
  const turned = widenClip({ name: 'turned', framesPerSecond: 10, loop: true, nodes: ['head'], rotations: [[1, 0, 0, 0], [1, 0, 0, 0]] }, 'turned')
  const entity = { pose: { head: [0, 0, 0, 1] }, _rigFrom: crossfadeFrom('turned.json', 0) }
  applyCrossfade(entity, { clipFade: 0.2 }, 0.1, () => turned)
  assert.ok(Math.abs(entity.pose.head[0] - Math.SQRT1_2) < 1e-6, `halfway through the fade, the head is halfway round (${entity.pose.head[0]})`)
  applyCrossfade(entity, { clipFade: 0.2 }, 0.1, () => turned)
  assert.equal(entity._rigFrom, null, 'once faded, the old clip is let go')
})
