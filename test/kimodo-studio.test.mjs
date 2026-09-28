#!/usr/bin/env node
/**
 * Kimodo's studio and its mannequin. A mannequin whose limbs the designer or
 * Rig Animation cannot find shows no handles or the wrong knee, and one whose
 * rest pose differs from Kimodo's shows a take that is not the one Kimodo
 * made; nothing says so in either case.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.env.ENGINE_PROJECTS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kimodo-studio-'))
const { makeStudio, copyTakeToGame } = await import('../plugins/builtin/kimodo/studio.mjs')
const { chainOf, HANDLES } = await import('../plugins/builtin/kimodo/designer.js')
const { rolesOf } = await import('../plugins/builtin/rig-animation/clip-reading.js')
const { readSource } = await import('../tools/lib/retarget-clips.mjs')
const { SKELETONS } = await import('../tools/lib/motion-clip.mjs')

const STUDIO = { name: 'kimodo-studio', model: 'models/kimodo-mannequin.glb' }
const { directory } = makeStudio(CHECKOUT, STUDIO)
const readJson = file => JSON.parse(fs.readFileSync(path.join(directory, 'assets', file), 'utf8'))
const skeleton = readJson('motion/kimodo-mannequin.skeleton.json')
const clip = readJson('motion/kimodo-mannequin/kimodo-idle.json')

test('the designer finds every limb on the mannequin, and the knee is the shin', () => {
  for (const handle of Object.keys(HANDLES)) assert.ok(chainOf(skeleton, handle), handle)
  const roles = rolesOf(skeleton)
  assert.equal(roles.left.hip, 'LeftUpLeg')
  assert.equal(roles.left.knee, 'LeftLeg')
  assert.equal(roles.chest, 'Spine2')
})

test("the mannequin's feet rest at 0, as Kimodo measures body and joint keys", async () => {
  const { restOf } = await import('../plugins/builtin/rig-animation/clip-reading.js')
  const { widenSkeleton } = await import('../plugins/builtin/rig-animation/skeleton.js')
  const rest = restOf(widenSkeleton(skeleton, 'kimodo-mannequin.skeleton.json'))
  assert.ok(Math.abs(Math.min(rest.left.toe[1], rest.right.toe[1])) < 0.01)
  assert.ok(rest.hips[1] > 0.8)
})

const { multiply, inverse, rotate: turned } = await import('../plugins/builtin/game-maths/turns.js')

/** Joint positions in the hips' own space, from a turn for each soma joint. */
function jointPlaces(turnOf) {
  const soma = SKELETONS['soma-30']
  const world = []
  const places = []
  soma.names.forEach((unused, joint) => {
    const parent = soma.parents[joint]
    const turn = turnOf(joint)
    world[joint] = parent < 0 ? turn : multiply(world[parent], turn)
    places[joint] = parent < 0 ? [0, 0, 0] : places[parent].map((value, axis) => value + turned(world[parent], soma.offsets[joint])[axis])
  })
  return places.map(place => turned(inverse(world[0]), place))
}

test("the mannequin's first frame puts each hand, foot and the head where Kimodo did", () => {
  const soma = SKELETONS['soma-30']
  const motion = readSource(path.join(directory, 'assets/motion/source/kimodo-idle'))
  const first = clip.source.kept[0]
  const raw = jointPlaces(joint => Array.from(motion.rotations.slice((first * 30 + joint) * 4, (first * 30 + joint) * 4 + 4)))
  // The mannequin names nine soma joints its own way; its node order is the soma order less the leaves.
  const mannequinNames = Object.keys(skeleton.nodes)
  const posed = jointPlaces(joint => {
    const node = clip.nodes.indexOf(mannequinNames[joint])
    return node < 0 ? skeleton.nodes[mannequinNames[joint]].rotation : Array.from(clip.rotations[0].slice(node * 4, node * 4 + 4))
  })
  for (const name of ['Head', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot']) {
    const joint = soma.names.indexOf(name)
    const apart = Math.hypot(...raw[joint].map((value, axis) => value - posed[joint][axis]))
    assert.ok(apart < 0.005, `${name} is ${(apart * 100).toFixed(1)} cm from Kimodo's`)
  }
})

test('a take is not copied into the studio, nor into a game with no skinned model', () => {
  assert.throws(() => copyTakeToGame(CHECKOUT, directory, { clip: 'motion/kimodo-mannequin/kimodo-idle.json', game: STUDIO.name }), /not the studio/)
  const game = path.join(process.env.ENGINE_PROJECTS_ROOT, 'bare-game')
  fs.mkdirSync(game)
  fs.writeFileSync(path.join(game, 'game.json'), '{}')
  assert.throws(() => copyTakeToGame(CHECKOUT, directory, { clip: 'motion/kimodo-mannequin/kimodo-idle.json', game: 'bare-game' }), /no skinned model/)
})

test('a keyed hips height and head look pose the preview body, and an unkeyed field leaves it', async () => {
  const { poseBody } = await import('../plugins/builtin/kimodo/body-rig.js')
  const { placeOf, widenSkeleton } = await import('../plugins/builtin/rig-animation/skeleton.js')
  const { restOf } = await import('../plugins/builtin/rig-animation/clip-reading.js')
  const widened = widenSkeleton(skeleton, 'kimodo-mannequin.skeleton.json')
  const rest = restOf(widened)
  const roles = rolesOf(widened)
  const restPose = () => Object.fromEntries(Object.entries(skeleton.nodes).map(([name, node]) => [name, [...node.rotation, ...node.position]]))
  const design = { body: [{ at: 0, height: 0.7, head: [0.6, 0, 0] }] }
  const pose = restPose()
  poseBody(widened, pose, design, 0, rest, roles)
  assert.ok(Math.abs(placeOf(widened, pose, roles.hips).position[1] - 0.7) < 1e-6)
  const headTurn = placeOf(widened, pose, roles.head).turn
  const restHeadTurn = placeOf(widened, {}, roles.head).turn
  const front = turned(multiply(headTurn, inverse(restHeadTurn)), [0, 0, 1])
  assert.ok(Math.abs(Math.atan2(front[0], front[2]) - 0.6) < 0.01, 'the head faces the keyed yaw')
  const untouched = restPose()
  poseBody(widened, untouched, { body: [{ at: 0, head: [0.6, 0, 0] }] }, 0, rest, roles)
  assert.deepEqual(untouched[roles.hips], restPose()[roles.hips])
})

test('a planted foot keeps its place and its turn when the hips drop and the leg bends', async () => {
  const { poseBody, footTurnsOf, holdFootTurns } = await import('../plugins/builtin/kimodo/body-rig.js')
  const { placeOf, widenSkeleton } = await import('../plugins/builtin/rig-animation/skeleton.js')
  const { restOf } = await import('../plugins/builtin/rig-animation/clip-reading.js')
  const { bendChain } = await import('../plugins/builtin/rig-animation/solvers/reach.js')
  const widened = widenSkeleton(skeleton, 'kimodo-mannequin.skeleton.json')
  const pose = Object.fromEntries(Object.entries(skeleton.nodes).map(([name, node]) => [name, [...node.rotation, ...node.position]]))
  const leg = chainOf(widened, 'LeftFoot')
  const standing = placeOf(widened, pose, leg[2]).position
  const turns = footTurnsOf(widened, pose, [leg[2]])
  poseBody(widened, pose, { body: [{ at: 0, height: 0.6 }] }, 0, restOf(widened), rolesOf(widened))
  bendChain(widened, pose, leg, standing, [standing[0], standing[1] + 0.5, standing[2] + 1], 1)
  holdFootTurns(widened, pose, turns)
  const foot = placeOf(widened, pose, leg[2])
  assert.ok(Math.hypot(...foot.position.map((value, axis) => value - standing[axis])) < 0.005, 'the foot stays where it stood')
  const alike = Math.abs(foot.turn.reduce((sum, value, axis) => sum + value * turns[leg[2]][axis], 0))
  assert.ok(alike > 0.9999, 'the foot keeps its turn')
})

// A lunge as a pose record would hold it: model space, feet on the floor, hips 0.8 m up.
const LUNGE = {
  people: [
    {
      points: {
        left_hip: [0.1, 0.8, 0], right_hip: [-0.1, 0.8, 0],
        left_knee: [0.12, 0.45, 0.35], right_knee: [-0.12, 0.4, -0.2],
        left_ankle: [0.12, 0.08, 0.4], right_ankle: [-0.12, 0.08, -0.55],
        left_shoulder: [0.18, 1.35, 0.05], right_shoulder: [-0.18, 1.35, 0.05],
        left_elbow: [0.3, 1.1, 0.2], right_elbow: [-0.3, 1.1, 0.1],
        left_wrist: [0.25, 1.2, 0.45], right_wrist: [-0.2, 1.25, 0.4],
        neck: [0, 1.45, 0.08], nose: [0.05, 1.6, 0.2], left_ear: [0.08, 1.58, 0.08], right_ear: [-0.08, 1.58, 0.08]
      }
    }
  ]
}

test("a photo's pose keys the hands and feet, bends the knees its way, and keeps its crouch on the rig's legs", async () => {
  const { withPoseKeys } = await import('../plugins/builtin/kimodo/pose-keys.js')
  const { newDesign } = await import('../plugins/builtin/kimodo/designer.js')
  const { restOf } = await import('../plugins/builtin/rig-animation/clip-reading.js')
  const { widenSkeleton } = await import('../plugins/builtin/rig-animation/skeleton.js')
  const rest = restOf(widenSkeleton(skeleton, 'kimodo-mannequin.skeleton.json'))
  const design = withPoseKeys(newDesign({ name: 'lunge', model: STUDIO.model, base: 'motion/kimodo-mannequin/kimodo-idle.json' }), LUNGE, { seconds: 0.5, rest })
  const { lengthOf, subtract } = await import('../plugins/builtin/game-maths/space.js')
  const legOf = (hip, knee, ankle) => lengthOf(subtract(knee, hip)) + lengthOf(subtract(ankle, knee))
  const points = LUNGE.people[0].points
  const photoLeg = (legOf(points.left_hip, points.left_knee, points.left_ankle) + legOf(points.right_hip, points.right_knee, points.right_ankle)) / 2
  const rigLeg = (legOf(rest.left.hip, rest.left.knee, rest.left.foot) + legOf(rest.right.hip, rest.right.knee, rest.right.foot)) / 2
  const size = rigLeg / photoLeg
  assert.deepEqual(design.keys.LeftHand[0].value, LUNGE.people[0].points.left_wrist.map(value => Number((value * size).toFixed(3))))
  assert.deepEqual(Object.keys(design.keys).sort(), ['LeftElbow', 'LeftFoot', 'LeftHand', 'LeftKnee', 'RightElbow', 'RightFoot', 'RightHand', 'RightKnee'])
  assert.ok(design.keys.LeftKnee[0].value[2] > LUNGE.people[0].points.left_knee[2] * size, 'the front knee is pulled forward, the way it bends')
  const [body] = design.body
  assert.equal(body.at, 0.5)
  assert.ok(Math.abs(body.height - 0.8 * size) < 0.002, 'the hips are as high as the photo, on legs as long as the rig')
  assert.ok(body.height < rest.hips[1] - 0.05, 'the lunge stays a crouch')
  assert.ok(body.head[0] > 0, 'the head looks to its left, as the nose does')
  assert.ok(body.torso[1] > 0, 'the chest leans forward')
  // Photographed side-on: the same pose turned a quarter about +Y keys the same.
  const sideOn = { people: [{ points: Object.fromEntries(Object.entries(points).map(([name, [x, y, z]]) => [name, [z, y, -x]])) }] }
  const turned = withPoseKeys(newDesign({ name: 'lunge', model: STUDIO.model, base: 'motion/kimodo-mannequin/kimodo-idle.json' }), sideOn, { seconds: 0.5, rest })
  for (const [limb, keys] of Object.entries(design.keys)) {
    turned.keys[limb][0].value.forEach((value, axis) => assert.ok(Math.abs(value - keys[0].value[axis]) < 0.002, `${limb} faces forward`))
  }
})

test('a cut keeps exactly the frames chosen, and the whole take is still there to cut again', async () => {
  const { cutTake, fullTake } = await import('../plugins/builtin/kimodo/take-files.mjs')
  const take = 'motion/kimodo-mannequin/kimodo-idle.json'
  const whole = fullTake(directory, take)
  assert.equal(whole.clip.rotations.length, whole.frames, 'the whole take is every frame Kimodo made')
  // A loop closes onto its last frame, so it plays last - first frames.
  assert.deepEqual(cutTake(directory, take, 10, 70), { clip: take, frames: 60 })
  assert.deepEqual(readJson(take).source.kept, [10, 70])
  assert.equal(readJson(take).name, 'kimodo-idle')
  assert.equal(fullTake(directory, take).clip.rotations.length, whole.frames)
  assert.throws(() => cutTake(directory, take, 10, whole.frames), /within 0\.\./)
})

test('a held item locks each hand to its socket on the item, place and turn', async () => {
  const { heldPose } = await import('../plugins/builtin/animation-states/held-items.js')
  const { applyConstraints } = await import('../plugins/builtin/rig-animation/constraints.js')
  const { widenSkeleton, placeOf } = await import('../plugins/builtin/rig-animation/skeleton.js')
  const { widenClip, applyClip } = await import('../plugins/builtin/rig-animation.js')
  const { multiply, rotate } = await import('../plugins/builtin/game-maths/turns.js')
  const rig = widenSkeleton(skeleton, 'kimodo-mannequin.skeleton.json')
  const idle = widenClip(clip, 'kimodo-idle.json')
  const distanceOf = (first, second) => Math.hypot(...first.map((value, axis) => value - second[axis]))
  const held = record => {
    const entity = { id: 'held', pose: null, _rigTime: 0.3 }
    applyClip(entity, idle, {})
    const answer = heldPose({ record, skeleton: rig, pose: entity.pose, seconds: 0.3, memory: {} })
    applyConstraints(entity, rig, answer.constraints, 1 / 60)
    return { pose: entity.pose, attachment: answer.attachment }
  }
  const still = { stiffness: 0, damping: 0, sway: 0, swaySpeed: 0 }
  const hilt = { turn: [0, 0, 1, 0] }
  const greatsword = {
    model: 'models/items/greatsword.glb',
    hand: 'right',
    points: { axis: [0, -1, 0], upAxis: [0, 0, 1], up: 'outward' },
    grip: { sockets: { right: { ...hilt, position: [-0.1, -0.2, 0] }, left: { ...hilt, position: [0.1, -0.1, 0] } } },
    guard: { distance: 0.25, height: -0.15, side: 0, pitch: 60, yaw: 0, roll: 0 },
    motion: still
  }
  const { pose } = held(greatsword)
  const chest = placeOf(rig, pose, 'Spine2')
  const guard = [chest.position[0], chest.position[1] - 0.15, chest.position[2] + 0.25]
  const right = placeOf(rig, pose, 'RightHand')
  const handMiss = distanceOf(right.position, guard)
  assert.ok(handMiss < 0.03, `the right hand is at the guard (off by ${handMiss.toFixed(3)} m)`)
  // Where the item is, from the right hand and its socket; the left hand must be on the left socket, turned as it says.
  const sockets = greatsword.grip.sockets
  const itemTurn = multiply(right.turn, [0, 0, -1, 0])
  const origin = right.position.map((value, axis) => value - rotate(itemTurn, sockets.right.position)[axis])
  const leftSocket = origin.map((value, axis) => value + rotate(itemTurn, sockets.left.position)[axis])
  const left = placeOf(rig, pose, 'LeftHand')
  const leftMiss = distanceOf(left.position, leftSocket)
  assert.ok(leftMiss < 0.03, `the left hand is on its socket (off by ${leftMiss.toFixed(3)} m)`)
  const wanted = multiply(itemTurn, sockets.left.turn)
  const alike = Math.abs(wanted.reduce((sum, value, axis) => sum + value * left.turn[axis], 0))
  assert.ok(alike > 0.999, `the left hand is turned as its socket says (${alike.toFixed(4)})`)
  const pitch = (60 * Math.PI) / 180
  const pointing = rotate(chest.turn, [0, Math.sin(pitch), Math.cos(pitch)])
  const blade = rotate(itemTurn, [0, -1, 0])
  assert.ok(blade.reduce((sum, value, axis) => sum + value * pointing[axis], 0) > 0.999, 'the blade points by the pitch')

  // A shield rides the forearm it is strapped to; the hand is still at the guard.
  const shield = {
    model: 'models/items/shield.glb',
    hand: 'left',
    grip: { mount: { on: 'forearm', position: [0.5, 0.066, 0], turn: [-0.5, -0.5, -0.5, 0.5] } },
    elbow: [0.45, -0.6, 0.1],
    guard: { distance: 0.3, height: 0.05, side: 0.12 },
    motion: still
  }
  const strapped = held(shield)
  assert.equal(strapped.attachment.node, 'LeftForeArm')
  const shieldChest = placeOf(rig, strapped.pose, 'Spine2').position
  const shieldGuard = [shieldChest[0] + 0.12, shieldChest[1] + 0.05, shieldChest[2] + 0.3]
  const shieldMiss = distanceOf(placeOf(rig, strapped.pose, 'LeftHand').position, shieldGuard)
  assert.ok(shieldMiss < 0.03, `the shield hand is at its guard (off by ${shieldMiss.toFixed(3)} m)`)
})

test('a path action turns the spine by its share of the item\'s yaw, and the hips stay', async () => {
  const { followOf } = await import('../plugins/builtin/animation-states/guard-path.js')
  const { applyConstraints } = await import('../plugins/builtin/rig-animation/constraints.js')
  const { placeOf, widenSkeleton } = await import('../plugins/builtin/rig-animation/skeleton.js')
  const widened = widenSkeleton(skeleton, 'kimodo-mannequin.skeleton.json')
  const roles = rolesOf(widened)
  const entity = { id: 'follow', pose: Object.fromEntries(Object.entries(skeleton.nodes).map(([name, node]) => [name, [...node.rotation, ...node.position]])) }
  const before = { hips: placeOf(widened, entity.pose, roles.hips).turn, chest: placeOf(widened, entity.pose, roles.chest).turn }
  const follow = followOf(widened, { yaw: 60, pitch: 45 }, { yaw: 0, pitch: 45 }, 0.5)
  assert.ok(!follow.nodes.includes(roles.hips) && follow.nodes.at(-1) === roles.chest)
  applyConstraints(entity, widened, [follow], 1 / 60)
  assert.deepEqual(placeOf(widened, entity.pose, roles.hips).turn, before.hips)
  const chestTurn = multiply(placeOf(widened, entity.pose, roles.chest).turn, inverse(before.chest))
  const front = turned(chestTurn, [0, 0, 1])
  assert.ok(Math.abs(Math.atan2(front[0], front[2]) - (30 * Math.PI) / 180) < 0.01, 'the chest turns half the item\'s 60 degrees')
})

test('a drawn path ends at the tip, the item\'s length from the hand, and a set saves as it was read', async () => {
  const { motionOf, pathLineOf } = await import('../plugins/builtin/animation-states/guard-path.js')
  const { setText } = await import('../plugins/builtin/kimodo/path-board.js')
  const record = { hand: 'right', points: { axis: [0, -1, 0], upAxis: [0, 0, 1], up: 'outward' }, grip: { sockets: { right: { position: [0, 0, 0] } } }, guard: { distance: 0.3, height: 0, side: 0.2, pitch: 0, yaw: 0, roll: 0 }, length: 0.8 }
  const path = [{ at: 0, guard: {} }, { at: 0.3, guard: { pitch: 90 } }]
  const line = pathLineOf(record, motionOf({ path }, record.guard), { position: [0, 1.4, 0], turn: [0, 0, 0, 1] }, { hand: [0], blade: [0, 0.3] }).tip
  assert.equal(line.keys.length, 2)
  assert.deepEqual(line.keys[0].map(value => Number(value.toFixed(6))), [-0.2, 1.4, 1.1], 'pointing ahead, the tip is 0.8 m in front of the hand')
  assert.deepEqual(line.keys[1].map(value => Number(value.toFixed(6))), [-0.2, 2.2, 0.3], 'pointing up, the tip is 0.8 m above it')
  const set = { actions: { attack: { path, body: 0.4 } } }
  const text = setText(set)
  assert.deepEqual(JSON.parse(text), set)
  assert.ok(text.includes('{"at":0.3,"guard":{"pitch":90}}'), 'each key on one line')
})
