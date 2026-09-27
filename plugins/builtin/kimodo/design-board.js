/**
 * The Kimodo board's design mode: the rows a person edits a design with, and
 * the session the viewer poses and draws from (viewer.js `edit`). The design
 * record and what it means are in designer.js.
 *
 * `board` is the panel's design state, kept between draws:
 * `{ design, clip, skeleton, entity, time, playFrom, selected, dragged, free, items, rigs, takes, note }`.
 * `rigs` are the project's models with a skeleton file; `takes` are the clips
 * kimodo.takes lists, the base a design can start from; `poses` are the pose
 * records Image Models wrote, `assets/poses/*.json`.
 * `free` is each limb's end as the last preview frame had it before the keys
 * moved it: the feet where the base take plants them, the hands where the body
 * carries them.
 * `playFrom` is `{ wall, time }` while it plays, null while paused.
 */
import { applyClip } from '../rig-animation.js'
import { applyConstraints } from '../rig-animation/constraints.js'
import { placeOf, widenSkeleton } from '../rig-animation/skeleton.js'
import { add, dot, lengthOf, scaled, subtract, unit } from '../game-maths/space.js'
import { restOf, rolesOf } from '../rig-animation/clip-reading.js'
import {
  HANDLES,
  POLES,
  chainOf,
  guidesAt,
  newDesign,
  previewConstraints,
  targetsAt,
  withKey,
  withoutKey
} from './designer.js'

export { newDesign }
import {
  BODY_HANDLES,
  bodyChangeOf,
  bodyHandlePoints,
  bodyReachedOf,
  poseBody,
  footTurnsOf,
  holdFootTurns,
  bodyTargetAt,
  withBodyKey,
  withoutBodyField
} from './body-rig.js'

const DEGREES = Math.PI / 180

/** The body key fields each body handle sets. */
const BODY_FIELDS = { Hips: ['height', 'ground'], Chest: ['torso'], Head: ['head'] }

/** How far an elbow or knee target starts from its joint, in metres. */
const POLE_REACH = 0.35

/** Which way a limb bends when it is straight, as the model faces: knees forward, elbows back. */
const STRAIGHT_BEND = { RightElbow: [0, 0, -1], LeftElbow: [0, 0, -1], RightKnee: [0, 0, 1], LeftKnee: [0, 0, 1] }
const STEP = 1 / 30

/** The folder a model's clips and skeleton are named by: `models/fighter.glb` is `fighter`. */
const folderOf = model =>
  model
    .split('/')
    .pop()
    .replace(/\.[^.]+$/, '')

/** An item model a hand can hold; `bow-drawn-3.glb` is one frame of a bow's draw, not an item. */
const isHoldable = file => /^assets\/models\/items\/[^/]+\.glb$/.test(file) && !/-\d+\.glb$/.test(file)

/**
 * A board for a design, its base take loaded and its model's skeleton read.
 * `design` is a stored design, or null to start one on `take`
 * (`{ clip, model, name }`, as kimodo.takes lists it).
 */
export async function openBoard(context, { design, take, takes = [] }) {
  const started =
    design ?? newDesign({ name: `${take.name.replace(/^take-/, '')}-design`, model: take.model, base: take.clip })
  const raw = JSON.parse(await context.files.read(`assets/motion/${folderOf(started.model)}.skeleton.json`))
  const tree = await context.files.tree()
  const paths = new Set(tree.map(item => item.path))
  return {
    rigs: [...paths]
      .filter(file => /^assets\/models\/[^/]+\.glb$/.test(file))
      .map(file => file.slice('assets/'.length))
      .filter(model => paths.has(`assets/motion/${folderOf(model)}.skeleton.json`)),
    takes: takes.filter(one => one.model),
    poses: [...paths].filter(file => /^assets\/poses\/.+\.json$/.test(file)),
    poseChosen: null,
    design: started,
    clip: await context.rigAnimation.load(started.base),
    skeleton: widenSkeleton(raw, `motion/${folderOf(started.model)}.skeleton.json`),
    entity: { id: 'kimodo-design', x: 0, y: 0, z: 0, yaw: 0, pose: null, _rigTime: 0 },
    time: 0,
    playFrom: null,
    selected: 'RightHand',
    dragged: null,
    items: tree
      .map(item => item.path)
      .filter(isHoldable)
      .map(file => file.slice('assets/'.length)),
    note: null
  }
}

/** The board's time now: moving while it plays, looping over the design's length. */
function clockOf(board) {
  if (!board.playFrom) return board.time
  const passed = performance.now() / 1000 - board.playFrom.wall
  return (board.playFrom.time + passed) % board.design.seconds
}

/** Each limb's end under `pose`: `{ limb: point }`, for the limbs the skeleton has. */
function limbEnds(skeleton, pose) {
  return Object.fromEntries(
    Object.keys(HANDLES).flatMap(limb => {
      const chain = chainOf(skeleton, limb)
      return chain ? [[limb, placeOf(skeleton, pose, chain[2]).position]] : []
    })
  )
}

/** The foot nodes the skeleton has, by the designer's foot chains. */
const footNodesOf = skeleton =>
  ['RightFoot', 'LeftFoot'].flatMap(foot => {
    const chain = chainOf(skeleton, foot)
    return chain ? [chain[2]] : []
  })

/**
 * Pose the board's model at `seconds`: the base take, then the body keys,
 * then the limbs, then each foot turned as the take turns it. `shown` is the
 * design as the pointer is changing it. Keeps each limb's free end on the
 * board and answers the pose.
 */
function poseBoardAt(board, seconds, shown, rest, roles) {
  const entity = board.entity
  entity._rigTime = seconds
  applyClip(entity, board.clip, {})
  const planted = limbEnds(board.skeleton, entity.pose)
  const footTurns = footTurnsOf(board.skeleton, entity.pose, footNodesOf(board.skeleton))
  poseBody(board.skeleton, entity.pose, shown, seconds, rest, roles)
  const carried = limbEnds(board.skeleton, entity.pose)
  board.free = { ...carried, RightFoot: planted.RightFoot, LeftFoot: planted.LeftFoot, ...kneeTargets(board.skeleton, entity.pose) }
  applyConstraints(
    entity,
    board.skeleton,
    previewConstraints(board.design, board.skeleton, seconds, board.dragged, board.free),
    STEP
  )
  holdFootTurns(board.skeleton, entity.pose, footTurns)
  return entity.pose
}

/**
 * A knee target in front of each knee, as the model faces, for a knee with no
 * key: a leg straight or nearly so has no bend of its own to keep, and would
 * fold sideways when the hips drop.
 */
function kneeTargets(skeleton, pose) {
  return Object.fromEntries(
    ['RightKnee', 'LeftKnee'].flatMap(knee => {
      const chain = chainOf(skeleton, POLES[knee])
      return chain ? [[knee, add(placeOf(skeleton, pose, chain[1]).position, scaled(STRAIGHT_BEND[knee], POLE_REACH))]] : []
    })
  )
}

/** Where an elbow or knee target is drawn before it is keyed: out from the joint the way the limb bends. */
function poleRestPoint(skeleton, pose, pole) {
  const chain = chainOf(skeleton, POLES[pole])
  const [upper, joint, end] = chain.map(name => placeOf(skeleton, pose, name).position)
  const along = unit(subtract(end, upper))
  const across = subtract(subtract(joint, upper), scaled(along, dot(subtract(joint, upper), along)))
  const bend = lengthOf(across) > 0.01 ? unit(across) : STRAIGHT_BEND[pole]
  return add(joint, scaled(bend, POLE_REACH))
}

/**
 * The design with `solved`: where the preview puts each elbow and knee at each
 * of its target keys, which Kimodo is sent (designer.js kimodoRecord).
 */
export function withSolvedJoints(board) {
  const rest = restOf(board.skeleton)
  const roles = rolesOf(board.skeleton)
  const solved = Object.fromEntries(
    Object.entries(board.design.keys)
      .filter(([pole]) => POLES[pole] && chainOf(board.skeleton, POLES[pole]))
      .map(([pole, keys]) => [
        pole,
        keys.map(key => {
          const pose = poseBoardAt(board, key.at, board.design, rest, roles)
          const joint = placeOf(board.skeleton, pose, chainOf(board.skeleton, POLES[pole])[1]).position
          return { at: key.at, value: joint.map(value => Number(value.toFixed(3))) }
        })
      ])
  )
  return { ...board.design, solved }
}

/** How a handle is drawn (viewer.js): picked first, then keyed, else free. */
function lookOf(isSelected, isKeyed) {
  if (isSelected) return 'selected'
  return isKeyed ? 'keyed' : 'free'
}

/** The session viewer.js poses and draws from; `redraw` redraws the panel. */
export function sessionOf(board, redraw) {
  const skeleton = board.skeleton
  const handNode = chainOf(skeleton, 'RightHand')?.[2]
  const rest = restOf(skeleton)
  const roles = rolesOf(skeleton)
  // A body handle is dropped on the board's time; its body key changes as it moves.
  const bodyDropped = (handle, point) => {
    const target = bodyHandleTarget(board.design, rest, board.time)
    const key = (board.design.body ?? []).find(candidate => Math.abs(candidate.at - board.time) < 1e-6)
    return withBodyKey(board.design, board.time, bodyChangeOf(handle, point, target, key))
  }
  const shownDesign = () =>
    board.dragged && BODY_HANDLES[board.dragged.handle]
      ? bodyDropped(board.dragged.handle, board.dragged.point)
      : board.design
  const isBodyKeyed = handle =>
    (board.design.body ?? []).some(key => BODY_FIELDS[handle].some(field => key[field] !== undefined))
  const bodyLook = handle => lookOf(handle === board.selected, isBodyKeyed(handle))
  const keyLook = handle => lookOf(handle === board.selected, Boolean(board.design.keys[handle]))
  const draggedAt = (handle, point) => (board.dragged?.handle === handle ? board.dragged.point : point)
  // An unkeyed pelvis ring is drawn where the take's hips are, which bob.
  const hipsPoint = point => (isBodyKeyed('Hips') ? point : placeOf(skeleton, board.entity.pose, roles.hips).position)
  return {
    model: board.design.model,
    clock: () => clockOf(board),
    poseAt: seconds => poseBoardAt(board, seconds, shownDesign(), rest, roles),
    handles() {
      const pose = board.entity.pose
      if (!pose) return []
      const seconds = clockOf(board)
      const asked = targetsAt(board.design, seconds)
      const limbs = Object.keys(HANDLES)
        .filter(handle => chainOf(skeleton, handle))
        .map(handle => {
          const point = placeOf(skeleton, pose, chainOf(skeleton, handle)[2]).position
          return { handle, point: draggedAt(handle, point), look: keyLook(handle), shape: 'sphere' }
        })
      const poles = Object.keys(POLES)
        .filter(pole => chainOf(skeleton, POLES[pole]))
        .map(pole => ({
          handle: pole,
          point: draggedAt(pole, asked[pole] ?? board.free?.[pole] ?? poleRestPoint(skeleton, pose, pole)),
          look: keyLook(pole),
          shape: 'pole',
          joint: placeOf(skeleton, pose, chainOf(skeleton, POLES[pole])[1]).position
        }))
      const body = Object.entries(bodyHandlePoints(shownDesign(), rest, seconds)).map(([handle, point]) => ({
        handle,
        point: draggedAt(handle, handle === 'Hips' ? hipsPoint(point) : point),
        look: bodyLook(handle),
        shape: handle === 'Hips' ? 'ring' : 'sphere'
      }))
      return [...limbs, ...poles, ...body]
    },
    // The handle held by the pointer is its own target, so it has no guide target.
    guides: seconds =>
      guidesAt(board.design, seconds).map(guide =>
        board.dragged?.handle === guide.handle ? { ...guide, target: null } : guide
      ),
    body(seconds) {
      const target = bodyTargetAt(shownDesign(), rest, seconds)
      return target && board.entity.pose ? { target, reached: bodyReachedOf(skeleton, board.entity.pose, roles) } : null
    },
    grab(handle) {
      board.time = clockOf(board)
      board.playFrom = null
      board.selected = handle
      redraw()
    },
    move(handle, point) {
      board.dragged = { handle, point }
    },
    drop(handle, point) {
      board.design = BODY_HANDLES[handle]
        ? bodyDropped(handle, point)
        : withKey(board.design, handle, board.time, point)
      // Moving the pelvis keys each foot where it stands, so Kimodo keeps it planted too.
      if (handle === 'Hips') board.design = withPlantedFeet(board.design, board)
      board.dragged = null
      redraw()
    },
    get hold() {
      const hold = board.design.hold
      return hold && handNode
        ? { ...hold, node: handNode, rotation: hold.rotation.map(value => value * DEGREES) }
        : null
    }
  }
}

/** `design` with a key at the board's time for each foot that has none there, where the foot stands now. */
function withPlantedFeet(design, board) {
  const keyTime = Math.round(board.time * 30) / 30
  return ['RightFoot', 'LeftFoot']
    .filter(foot => board.free?.[foot])
    .filter(foot => !(design.keys[foot] ?? []).some(key => Math.abs(key.at - keyTime) < 1e-6))
    .reduce((planted, foot) => withKey(planted, foot, board.time, board.free[foot]), design)
}

/** The body target a body handle is dropped against: the body keys at `seconds`, or rest before there are any. */
function bodyHandleTarget(design, rest, seconds) {
  return bodyTargetAt({ body: design.body?.length ? design.body : [{ at: 0 }] }, rest, seconds)
}

/** Three numbers from a field's text, `x y z`; the old ones when it is not three numbers. */
function threeOf(text, old) {
  const numbers = String(text)
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  return numbers.length === 3 && numbers.every(Number.isFinite) ? numbers : old
}

/**
 * Rows for what the take is made with: the Kimodo model, the rig it goes on,
 * and where it starts. `kimodoModels` is kimodo.models' list, empty until it
 * is read; `rebase(change)` reopens the board on another rig or base take.
 */
function kimodoRows(ui, board, kimodoModels, rebase) {
  const design = board.design
  const onRig = board.takes.filter(take => take.model === design.model)
  const wordsOnly = 'words only'
  const models = kimodoModels.length ? kimodoModels : [{ model: design.kimodoModel, about: '', isInstalled: true }]
  const chosen = models.find(entry => entry.model === design.kimodoModel)
  return [
    ui.select({
      k: 'model',
      options: models.map(entry => ({
        value: entry.model,
        label: `${entry.model}${entry.about ? ` · ${entry.about}` : ''}${entry.isInstalled ? '' : ' (not installed)'}`,
        disabled: !entry.isInstalled
      })),
      value: design.kimodoModel,
      note: chosen?.isInstalled === false ? chosen.install : undefined,
      onChange: model => {
        board.design = { ...board.design, kimodoModel: model }
      }
    }),
    ui.select({
      k: 'rig',
      options: board.rigs.map(model => ({ value: model, label: folderOf(model) })),
      value: design.model,
      onChange: model => rebase({ model })
    }),
    ui.select({
      k: 'starts from',
      options: [wordsOnly, ...onRig.map(take => take.name)],
      value: design.fromBase ? onRig.find(take => take.clip === design.base)?.name : wordsOnly,
      onChange: name => {
        const take = onRig.find(one => one.name === name)
        if (take) rebase({ base: take.clip, fromBase: true })
        else board.design = { ...board.design, fromBase: false }
      }
    })
  ]
}

/** Rows for the design's words and length. */
function settingRows(ui, board) {
  const design = board.design
  const set = change => {
    board.design = { ...board.design, ...change }
  }
  return [
    ui.field({
      k: 'name',
      v: design.name,
      onChange: value => set({ name: value.replace(/[^a-z0-9-]/gi, '-').toLowerCase() })
    }),
    ui.textarea({
      value: design.prompt,
      placeholder: 'what the body does, in words: a person swings a sword down from over the head',
      onChange: value => set({ prompt: value })
    }),
    ui.field({
      k: 'seconds',
      v: design.seconds,
      kind: 'number',
      onChange: value => set({ seconds: Math.max(0.5, Math.min(10, value || 2)) })
    }),
    ui.field({
      k: 'seed',
      v: design.seed,
      kind: 'number',
      onChange: value => set({ seed: Math.max(0, Math.round(value || 0)) })
    }),
    ui.select({
      k: 'takes',
      options: ['1', '2', '3', '4', '5', '6', '7', '8'],
      value: String(design.takes ?? 1),
      onChange: value => set({ takes: Number(value) })
    }),
    ui.toggle({ label: 'loops', value: design.loop, onChange: value => set({ loop: value }) })
  ]
}

/** Rows for time: the slider and play or pause. */
function timeRows(ui, board, redraw) {
  const now = clockOf(board)
  return [
    ui.slider({
      k: 'time',
      min: 0,
      max: board.design.seconds,
      step: STEP,
      value: Number(now.toFixed(2)),
      onChange: value => {
        board.time = value
        board.playFrom = null
      }
    }),
    ui.button(board.playFrom ? 'Pause' : 'Play', () => {
      board.time = clockOf(board)
      board.playFrom = board.playFrom ? null : { wall: performance.now() / 1000, time: board.time }
      redraw()
    })
  ]
}

/** Rows that key a photo's pose (a pose record) at the board's time; none when there are no records. */
function poseRecordRows(ui, board, keyPose) {
  if (!board.poses.length) return []
  const chosen = board.poseChosen ?? board.poses[0]
  return [
    ui.select({
      k: 'photo pose',
      options: board.poses.map(file => ({ value: file, label: file.replace(/^assets\/poses\//, '').replace(/\.json$/, '') })),
      value: chosen,
      onChange: file => {
        board.poseChosen = file
      }
    }),
    ui.button(`Key this pose at ${board.time.toFixed(2)} s`, () => keyPose(chosen))
  ]
}

/** Rows for keys: which limb, its keys, and keying it where it is now. */
function keyRows(ui, board, redraw) {
  const handle = board.selected
  const fields = BODY_FIELDS[handle]
  const keys = fields
    ? (board.design.body ?? []).filter(key => fields.some(field => key[field] !== undefined))
    : (board.design.keys[handle] ?? [])
  const shown = key => (fields ? fields.flatMap(field => [key[field] ?? []].flat()) : key.value)
  const removed = key =>
    fields
      ? fields.reduce((design, field) => withoutBodyField(design, key.at, field), board.design)
      : withoutKey(board.design, handle, key.at)
  const hasLimb = name => chainOf(board.skeleton, HANDLES[name] ? name : POLES[name])
  return [
    ui.select({
      k: 'control',
      options: [...Object.keys(HANDLES), ...Object.keys(POLES)].filter(hasLimb).concat(Object.keys(BODY_HANDLES)),
      value: handle,
      onChange: name => {
        board.selected = name
      }
    }),
    ui.text(
      'Drag a handle in the view: it is keyed at the time shown. Orange handles have keys. The ring moves the pelvis and plants the feet; diamonds are elbow and knee targets; Chest sets the lean, Head the look.',
      { dim: true }
    ),
    ui.list({
      items: keys,
      key: key => String(key.at),
      emptyText: `no keys on ${handle}`,
      row: key => [
        ui.label(`${key.at.toFixed(2)} s`),
        ui.meta(
          shown(key)
            .map(value => value.toFixed(2))
            .join(' ')
        ),
        ui.spacer(),
        ui.button('×', () => {
          board.design = removed(key)
          redraw()
        })
      ],
      onPick: key => {
        board.time = key.at
        board.playFrom = null
        redraw()
      }
    })
  ]
}

/** Rows for the item shown in the right hand while designing. */
function holdRows(ui, board) {
  const hold = board.design.hold
  const set = change => {
    board.design = {
      ...board.design,
      hold: change && { ...(hold ?? { position: [0, 0, 0], rotation: [0, 0, 0] }), ...change }
    }
  }
  return [
    ui.select({
      k: 'item',
      options: ['nothing', ...board.items.map(file => file.split('/').pop().replace('.glb', ''))],
      value: hold ? hold.model.split('/').pop().replace('.glb', '') : 'nothing',
      onChange: name =>
        set(name === 'nothing' ? null : { model: board.items.find(file => file.endsWith(`/${name}.glb`)) })
    }),
    ...(hold
      ? [
          ui.field({
            k: 'grip place (m)',
            v: hold.position.join(' '),
            onChange: value => set({ position: threeOf(value, hold.position) })
          }),
          ui.field({
            k: 'grip turn (°)',
            v: hold.rotation.join(' '),
            onChange: value => set({ rotation: threeOf(value, hold.rotation) })
          })
        ]
      : [])
  ]
}

/**
 * Every row of the design mode. `actions` is `{ save, generate, close, rebase, keyPose }`;
 * `kimodoModels` is kimodo.models' list; `redraw` redraws the panel.
 */
export function designRows(ui, board, actions, redraw, kimodoModels = []) {
  const open = { open: true }
  const takes = board.design.takes ?? 1
  return [
    ui.fold('Kimodo', kimodoRows(ui, board, kimodoModels, actions.rebase), open),
    ui.fold('Move', settingRows(ui, board), open),
    ui.fold('Time', timeRows(ui, board, redraw), open),
    ui.fold('Keys', [...keyRows(ui, board, redraw), ...poseRecordRows(ui, board, actions.keyPose)], open),
    ui.fold('Hold (preview only)', holdRows(ui, board), open),
    ui.row([
      ui.button('Save', actions.save),
      ui.button(takes > 1 ? `Generate ${takes} takes` : 'Generate take', actions.generate, { primary: true }),
      ui.spacer(),
      ui.button('Back to takes', actions.close)
    ]),
    ...(board.note ? [ui.text(board.note, { dim: true })] : [])
  ]
}
