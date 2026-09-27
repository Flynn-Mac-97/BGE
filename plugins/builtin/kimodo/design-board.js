/**
 * The Kimodo board's design mode: the rows a person edits a design with, and
 * the session the viewer poses and draws from (viewer.js `edit`). The design
 * record and what it means are in designer.js.
 *
 * `board` is the panel's design state, kept between draws:
 * `{ design, clip, skeleton, entity, time, playFrom, selected, dragged, items, note }`.
 * `playFrom` is `{ wall, time }` while it plays, null while paused.
 */
import { applyClip } from '../rig-animation.js'
import { applyConstraints } from '../rig-animation/constraints.js'
import { placeOf, widenSkeleton } from '../rig-animation/skeleton.js'
import { HANDLES, chainOf, guidesAt, newDesign, previewConstraints, withKey, withoutKey } from './designer.js'

const DEGREES = Math.PI / 180
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
export async function openBoard(context, { design, take }) {
  const started =
    design ?? newDesign({ name: `${take.name.replace(/^take-/, '')}-design`, model: take.model, base: take.clip })
  const raw = JSON.parse(await context.files.read(`assets/motion/${folderOf(started.model)}.skeleton.json`))
  const tree = await context.files.tree()
  return {
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

/** The session viewer.js poses and draws from; `redraw` redraws the panel. */
export function sessionOf(board, redraw) {
  const skeleton = board.skeleton
  const handNode = chainOf(skeleton, 'RightHand')?.[2]
  return {
    model: board.design.model,
    clock: () => clockOf(board),
    poseAt(seconds) {
      const entity = board.entity
      entity._rigTime = seconds
      applyClip(entity, board.clip, {})
      applyConstraints(entity, skeleton, previewConstraints(board.design, skeleton, seconds, board.dragged), STEP)
      return entity.pose
    },
    handles: () =>
      Object.keys(HANDLES).flatMap(handle => {
        const chain = chainOf(skeleton, handle)
        if (!chain || !board.entity.pose) return []
        const point =
          board.dragged?.handle === handle
            ? board.dragged.point
            : placeOf(skeleton, board.entity.pose, chain[2]).position
        const look = handle === board.selected ? 'selected' : board.design.keys[handle] ? 'keyed' : 'free'
        return [{ handle, point, look }]
      }),
    // The handle held by the pointer is its own target, so it has no guide target.
    guides: seconds =>
      guidesAt(board.design, seconds).map(guide =>
        board.dragged?.handle === guide.handle ? { ...guide, target: null } : guide
      ),
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
      board.design = withKey(board.design, handle, board.time, point)
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

/** Three numbers from a field's text, `x y z`; the old ones when it is not three numbers. */
function threeOf(text, old) {
  const numbers = String(text)
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  return numbers.length === 3 && numbers.every(Number.isFinite) ? numbers : old
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
    ui.toggle({ label: 'loops', value: design.loop, onChange: value => set({ loop: value }) }),
    ui.toggle({ label: 'starts in the base pose', value: design.fromBase, onChange: value => set({ fromBase: value }) })
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

/** Rows for keys: which limb, its keys, and keying it where it is now. */
function keyRows(ui, board, redraw) {
  const handle = board.selected
  const keys = board.design.keys[handle] ?? []
  return [
    ui.pick({
      options: Object.keys(HANDLES).filter(name => chainOf(board.skeleton, name)),
      value: handle,
      onChange: name => {
        board.selected = name
      }
    }),
    ui.text('Drag a handle in the view: it is keyed at the time shown. Orange handles have keys.', { dim: true }),
    ui.list({
      items: keys,
      key: key => String(key.at),
      emptyText: `no keys on ${handle}`,
      row: key => [
        ui.label(`${key.at.toFixed(2)} s`),
        ui.meta(key.value.map(value => value.toFixed(2)).join(' ')),
        ui.spacer(),
        ui.button('×', () => {
          board.design = withoutKey(board.design, handle, key.at)
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
    ui.pick({
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

/** Every row of the design mode. `actions` is `{ save, generate, close }`; `redraw` redraws the panel. */
export function designRows(ui, board, actions, redraw) {
  const open = { open: true }
  return [
    ui.fold('Move', settingRows(ui, board), open),
    ui.fold('Time', timeRows(ui, board, redraw), open),
    ui.fold('Keys', keyRows(ui, board, redraw), open),
    ui.fold('Hold (preview only)', holdRows(ui, board), open),
    ui.row([
      ui.button('Save', actions.save),
      ui.button('Generate take', actions.generate, { primary: true }),
      ui.spacer(),
      ui.button('Back to takes', actions.close)
    ]),
    ...(board.note ? [ui.text(board.note, { dim: true })] : [])
  ]
}
