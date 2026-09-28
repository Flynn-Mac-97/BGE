/**
 * Kimodo — watch generated motion takes, choose which one a clip uses, and
 * design new ones: key hands and feet on a take, preview them with the game's
 * own solver, and generate a take through them (kimodo/designer.js).
 *
 * kimodo.cpp makes clips from a written prompt; `tools/make-rig-clip.mjs` runs
 * it and writes `assets/motion/<model>/<name>.json`. Several takes of one move
 * are several such files. This plugin lists every clip in the project, plays
 * the chosen one on its model in a view of its own, and copies a take over the
 * clip a type plays. It generates nothing: that is a program, run from a
 * terminal (see the guide).
 *
 * A clip's model is `models/<folder>.glb`, the folder its clip is in, which is
 * where `make-rig-clip --onto` writes it.
 *
 * Takes are made in the studio, a project of Kimodo's own (kimodo/studio.mjs)
 * whose model is a mannequin of Kimodo's own skeleton, so no game is needed to
 * make one. **Copy to game** puts a take on a game's models.
 *
 *   run kimodo.takes                           every clip, its prompt and its length
 *   run kimodo.view '{"clip":"motion/hero/take-a.json"}'
 *   run kimodo.use '{"clip":"motion/hero/take-a.json","as":"slash"}'
 *   run kimodo.design '{"clip":"motion/hero/idle.json"}'   design on a take (the board)
 *   run kimodo.new                                         design a new move, starting from words
 *   run kimodo.models                                      the Kimodo models and which are installed
 *   run kimodo.delete '{"clip":"motion/hero/take-a.json"}'  delete a take and its stored motion
 *   run kimodo.key-pose '{"pose":"assets/poses/lunge.sam-3d-body.json","at":0.5}'   a photo's pose as keys
 *   run kimodo.designs                                     every saved design
 *   run kimodo.studio                                      make the studio if it is missing, then open it
 *   run kimodo.copy '{"clip":"motion/kimodo-mannequin/take-a.json","game":"arena-brawler"}'
 *   node bin/engine.mjs --headless run kimodo.generate '{"design":"assets/motion/designs/chop.json"}'
 */
import { mountViewer } from './kimodo/viewer.js'
import { designRows, newDesign, openBoard, sessionOf, withSolvedJoints } from './kimodo/design-board.js'
import { runHeadless } from '../../engine/headless-job.js'
import { withPoseKeys } from './kimodo/pose-keys.js'
import { restOf } from './rig-animation/clip-reading.js'
import { compareDesign, designFromPoses, poseMenu } from './kimodo/poser.js'
import { cutPreview, cutRows, openCut } from './kimodo/cut-board.js'
import { ITEMS, editedRecord, holdFileOf, holdRows, holdSession, newHold } from './kimodo/hold-board.js'
import { SETS, setFileOf, setText } from './kimodo/path-board.js'
import { widenSkeleton } from './rig-animation/skeleton.js'

const DESIGNS = 'assets/motion/designs'

/** The node half, loaded only where a program can be started. */
const nodeHalf = () => import('./kimodo/generate.mjs')

/** The take-files half; node only, because the page removes no files. */
const takeFilesHalf = () => import('./kimodo/take-files.mjs')

/** The studio's half; node only, because it writes a .glb and retargets. */
const studioHalf = () => import('./kimodo/studio.mjs')

/** Kimodo's own project, in the projects folder, and the mannequin every take in it is on. */
const STUDIO = { name: 'kimodo-studio', model: 'models/kimodo-mannequin.glb' }

/** The command that generates a design at a terminal. Shown where the browser cannot. */
const generateCommand = file =>
  `node bin/engine.mjs --headless run kimodo.generate '${JSON.stringify({ design: file })}'`

const CLIP_FILE = /^assets\/motion\/([^/]+)\/([^/]+)\.json$/

/** What the panel last read. Rebuilt by `kimodo.takes`, never by a draw. */
const state = {
  isOpen: false,
  isGenerating: false,
  hasRead: false,
  takes: [],
  designs: [],
  chosen: null,
  filter: '',
  target: null,
  error: null,
  stage: null,
  viewer: null,
  board: null,
  games: [],
  copyTo: null,
  copyNote: null,
  kimodoModels: [],
  thumbnails: new Map(),
  isDrawingThumbnails: false,
  // The take list's scroll, kept because every redraw builds the side again.
  sideScroll: 0,
  // The take being cut on the cut board (kimodo/cut-board.js), or null.
  cut: null,
  // What the chosen take holds, and how (kimodo/hold-board.js).
  hold: newHold(),
  holdNote: '',
  // The items with a hold record in the project, read when the takes are read.
  items: []
}

/** One take as the panel lists it. */
function takeRow({ clip, folder, name, model, raw }) {
  return {
    clip,
    folder,
    name,
    model,
    prompt: raw.source?.prompt ?? '',
    frames: raw.rotations?.length ?? 0,
    seconds: Math.round(((raw.rotations?.length ?? 0) / (raw.framesPerSecond || 30)) * 100) / 100,
    loop: raw.loop !== false
  }
}

/** Every clip file in the project, read for its prompt and length. */
async function readTakes(context) {
  const paths = (await context.files.tree()).map(item => item.path)
  const models = new Set(paths.filter(file => file.startsWith('assets/models/')))
  const takes = []
  for (const file of paths.sort()) {
    const match = CLIP_FILE.exec(file)
    if (!match) continue
    const [, folder, name] = match
    const model = models.has(`assets/models/${folder}.glb`) ? `models/${folder}.glb` : null
    const raw = JSON.parse(await context.files.read(file))
    // Bone maps and designs are in assets/motion/ too, and have no frames.
    if (!raw.rotations) continue
    takes.push(takeRow({ clip: file.replace(/^assets\//, ''), folder, name, model, raw }))
  }
  return takes
}

/**
 * The take for a clip, reading the takes again when it is not in the last list:
 * a headless command is a new process, and a take made since is not listed yet.
 */
async function takeFor(context, clip) {
  const listed = state.takes.find(take => take.clip === clip)
  if (listed) return listed
  state.takes = await readTakes(context)
  return state.takes.find(take => take.clip === clip)
}

/** Show a take in the panel's view. A headless run has no view, and answers the take alone. */
async function viewTake(context, clip) {
  const take = await takeFor(context, clip)
  if (!take) throw new Error(`no clip ${clip} — run kimodo.takes`)
  state.chosen = clip
  state.target = null
  // Playing a take leaves design mode; the side would still show the old design.
  state.board = null
  // Playing a take in the editor opens the board, so a take asked for is seen.
  if (context.shell) {
    state.isOpen = true
    stageFor()
  }
  if (state.viewer && take.model) state.viewer.show({ model: take.model, clip: await context.rigAnimation.load(clip) })
  if (state.viewer && take.model && state.hold.record) await holdOnView(context, take)
  context.redraw?.()
  return take
}

/** Hold `item` over `take`: its hold record read from its file, or nothing. */
async function holdItem(context, take, item) {
  const record = item === 'none' ? null : JSON.parse(await context.files.read(holdFileOf(item)))
  // The item's set, for the path board; a set with no file here is said on the board.
  const setSource = record?.set ? await context.files.read(setFileOf(record.set)).catch(() => null) : null
  state.hold = { ...newHold(), item, record, set: setSource ? { name: record.set, record: JSON.parse(setSource) } : null }
  state.holdNote = ''
  await holdOnView(context, take)
  context.redraw?.()
}

/** Write the hold as the board shows it back to the item's file, and fold the grip edits into it. */
async function saveHold(context) {
  const record = editedRecord(state.hold)
  const file = holdFileOf(state.hold.item)
  await context.files.write(file, JSON.stringify(record, null, 2) + '\n')
  state.hold = { ...state.hold, record, edits: {} }
  state.holdNote = `Saved ${file}.`
  context.redraw?.()
}

/** Write the path board's set back to its file. */
async function saveSet(context) {
  const file = setFileOf(state.hold.set.name)
  await context.files.write(file, setText(state.hold.set.record))
  state.holdNote = `Saved ${file}. Copy it to the game's ${SETS}/.`
  context.redraw?.()
}

/** How long a take that plays once rests on its last frame before it plays again, as the viewer does. */
const ONCE_REST_SECONDS = 0.6

/** Play `take` in the view with the hold's item held over it, or plainly when it holds nothing. */
async function holdOnView(context, take) {
  const clip = await context.rigAnimation.load(take.clip)
  if (!state.hold.record) {
    state.viewer.show({ model: take.model, clip })
    return
  }
  const skeletonFile = `motion/${take.folder}.skeleton.json`
  const skeleton = widenSkeleton(JSON.parse(await context.files.read(`assets/${skeletonFile}`)), skeletonFile)
  const started = performance.now() / 1000
  const length = clip.count / clip.framesPerSecond
  const clock = () => {
    const passed = performance.now() / 1000 - started
    return clip.loop ? passed : passed % (length + ONCE_REST_SECONDS)
  }
  state.viewer.edit(holdSession({ model: take.model, clip, skeleton, hold: state.hold, clock }))
}

/** Copy the take's file over `<as>.json` beside it, so every type that plays `as` plays this take. */
async function useTake(context, clip, as) {
  const take = await takeFor(context, clip)
  if (!take) throw new Error(`no clip ${clip} — run kimodo.takes`)
  if (!/^[a-z0-9-]+$/.test(as ?? '')) throw new Error('"as" is a clip name: lower case, digits and dashes')
  if (as === take.name) return { clip, unchanged: true }
  const raw = JSON.parse(await context.files.read(`assets/${clip}`))
  const written = `motion/${take.folder}/${as}.json`
  await context.files.write(`assets/${written}`, JSON.stringify({ ...raw, name: as }))
  // Clip files are cached as unchanging; this one just changed.
  context.rigAnimation.forget()
  return { clip: written, from: clip }
}

/**
 * Draw a still for each listed take that has none, one at a time, redrawing
 * the grid as each lands. A take that cannot be drawn keeps its blank card.
 */
async function drawThumbnails(context) {
  if (state.isDrawingThumbnails || !state.viewer) return
  state.isDrawingThumbnails = true
  try {
    for (const take of state.takes.filter(one => one.model && !state.thumbnails.has(one.clip))) {
      const picture = await state.viewer
        .thumbnail({ model: take.model, clip: await context.rigAnimation.load(take.clip) })
        .catch(() => null)
      state.thumbnails.set(take.clip, picture)
      context.redraw?.()
    }
  } finally {
    state.isDrawingThumbnails = false
  }
}

/** Delete a take, then list the takes again; a failure is shown under the grid. */
async function deleteFromBoard(context, clip) {
  try {
    await context.run('kimodo.delete', { clip })
    state.thumbnails.delete(clip)
    if (state.chosen === clip) state.chosen = null
    context.rigAnimation.forget()
    await context.run('kimodo.takes')
  } catch (error) {
    state.error = String(error?.message || error)
    context.redraw?.()
  }
}

/** The takes as a grid of stills; picking one plays it, and each can be deleted. */
function takeGrid(ui, context, shown) {
  return ui.grid({
    items: shown,
    cols: 2,
    key: take => take.clip,
    selected: state.chosen,
    emptyText: state.error || 'no clips under assets/motion/',
    cell: take => [
      ui.card({
        media: state.thumbnails.get(take.clip) ? ui.picture(state.thumbnails.get(take.clip)) : ui.thumb('', { glyph: '…' }),
        title: take.name,
        sub: `${take.seconds} s · ${take.loop ? 'loops' : 'once'}`,
        actions: [ui.button('Delete', () => deleteFromBoard(context, take.clip), { small: true, confirm: 'Delete?' })]
      })
    ],
    onPick: take => context.run('kimodo.view', { clip: take.clip })
  })
}

/** True when the open project is the studio: its takes are on the mannequin. */
const isStudio = () => state.takes.some(take => take.model === STUDIO.model)

// --------------------------------------------------------------------- panel

/** The element the view draws in, kept across draws so the model is loaded once. */
function stageFor() {
  if (state.stage) return state.stage
  state.stage = document.createElement('div')
  state.stage.style.cssText = 'flex:1;min-width:0;height:100%;overflow:hidden'
  state.viewer = mountViewer(state.stage)
  return state.stage
}

/** Close the board and free its view, which holds a renderer of its own. */
function closeBoard() {
  state.isOpen = false
  state.viewer?.dispose()
  state.viewer = null
  state.stage = null
}

function chosenRows(ui, context) {
  const take = state.takes.find(one => one.clip === state.chosen)
  if (!take) return [ui.text('Pick a take to play it.', { dim: true })]
  // A take is used as one of the clips beside it that is not itself a take.
  const targets = state.takes.filter(
    other => other.folder === take.folder && other.clip !== take.clip && !other.name.startsWith('take-')
  )
  return [
    ui.text(take.prompt || 'no prompt recorded', { dim: !take.prompt }),
    ui.text(
      `${take.frames} frames, ${take.seconds} s, ${take.loop ? 'loops' : 'plays once'}${take.model ? '' : ' — no model for its folder'}`,
      { dim: true }
    ),
    ui.text('Use this take as:', { dim: true }),
    ui.select({
      k: 'clip',
      options: [{ value: '', label: 'choose a clip' }, ...targets.map(other => other.name)],
      value: state.target ?? '',
      onChange: name => {
        state.target = name || null
      }
    }),
    ui.button(
      state.target ? `Use as ${state.target}` : 'Use as…',
      () => {
        if (state.target) context.run('kimodo.use', { clip: take.clip, as: state.target })
      },
      { primary: Boolean(state.target) }
    ),
    ...(take.model ? [ui.button('Design on this take', () => context.run('kimodo.design', { clip: take.clip }))] : []),
    ...(take.model ? [ui.button('Cut this take', () => cutFromBoard(context, take))] : []),
    ...(take.model
      ? holdRows(
          ui,
          state.hold,
          state.items,
          {
            pickItem: item => holdItem(context, take, item).catch(error => (state.error = String(error?.message || error))),
            save: () => saveHold(context),
            redraw: () => context.redraw?.(),
            saveSet: () => saveSet(context).catch(error => (state.error = String(error?.message || error)))
          },
          state.holdNote
        )
      : []),
    ...copyRows(ui, context, take)
  ]
}

/** Outside the studio, the way into it; in any project with a rig, the way to design a new move. */
function studioRows(ui, context) {
  const newMove = state.takes.some(take => take.model)
    ? [ui.button('New move', () => context.run('kimodo.new'), { primary: isStudio() })]
    : []
  if (isStudio()) return newMove
  return [ui.button('Open Kimodo Studio', () => context.run('kimodo.studio'), { primary: !state.takes.length }), ...newMove]
}

/** Copy a take and say on the board what was written or why not; a button has no other place to answer. */
async function copyFromBoard(context, clip, game) {
  state.copyNote = `Copying to ${game}…`
  context.redraw?.()
  try {
    const done = await context.run('kimodo.copy', { clip, game })
    state.copyNote = done.error ?? `Wrote ${done.written.join(', ')}.`
  } catch (error) {
    state.copyNote = String(error?.message || error)
  }
  context.redraw?.()
}

/** In the studio, the rows that copy the chosen take into a game. */
function copyRows(ui, context, take) {
  if (!isStudio()) return []
  const games = state.games.filter(name => name !== STUDIO.name)
  return [
    ui.text('Copy this take to a game:', { dim: true }),
    ui.select({
      k: 'game',
      options: [{ value: '', label: 'choose a game' }, ...games],
      value: state.copyTo ?? '',
      onChange: name => {
        state.copyTo = name || null
      }
    }),
    ui.button(
      state.copyTo ? `Copy to ${state.copyTo}` : 'Copy to…',
      () => {
        if (state.copyTo) copyFromBoard(context, take.clip, state.copyTo)
      },
      { primary: Boolean(state.copyTo) }
    ),
    ...(state.copyNote ? [ui.text(state.copyNote, { dim: true })] : [])
  ]
}

/** The saved designs, each opened on the board when picked. */
function designListRows(ui, context) {
  if (!state.designs.length) return []
  return [
    ui.select({
      k: 'design',
      options: [
        { value: '', label: 'open a saved design' },
        ...state.designs.map(file => ({ value: file, label: file.split('/').pop().replace('.json', '') }))
      ],
      value: '',
      onChange: file => {
        if (file) context.run('kimodo.design', { file })
      }
    })
  ]
}

/**
 * Save the board's design, then make its take: here in node, or from the
 * browser by a headless engine (engine/headless-job.js). The new take is shown
 * when it is made; the design stays in the Designs list.
 */
async function generateBoard(context) {
  if (state.isGenerating) return
  const { file } = await context.run('kimodo.save-design')
  state.isGenerating = true
  const takes = state.board.design.takes ?? 1
  state.board.note = `Generating ${takes > 1 ? `${takes} takes` : 'the take'}. Kimodo takes about two minutes for two seconds of motion, per take.`
  context.redraw?.()
  try {
    const answer = context.host
      ? await context.run('kimodo.generate', { design: file })
      : await runHeadless('kimodo.generate', { design: file })
    // A take made again under its old name is a changed file the cache still holds.
    context.rigAnimation.forget()
    await context.run('kimodo.takes')
    state.board = null
    await context.run('kimodo.view', { clip: answer.clip })
  } finally {
    state.isGenerating = false
    context.redraw?.()
  }
}

/** The design mode's side column. */
function designSide(ui, context) {
  const redraw = () => context.redraw?.()
  // A failed save or generate is shown on the board; a button has no other place to answer.
  const noting = work => change =>
    work(change).catch(error => {
      // Generate closes the board once the take is made; a later failure has no board to show on.
      if (state.board) state.board.note = error.message
      redraw()
    })
  const actions = {
    save: noting(async () => {
      const { file } = await context.run('kimodo.save-design')
      state.board.note = `Saved ${file}.`
      redraw()
    }),
    generate: noting(() => generateBoard(context)),
    close: () => {
      state.board = null
      state.viewer?.stopEditing()
      redraw()
    },
    rebase: noting(change => rebaseBoard(context, change)),
    keyPose: noting(pose => context.run('kimodo.key-pose', { pose }))
  }
  return ui.stack(designRows(ui, state.board, actions, redraw, state.kimodoModels), { pad: true })
}

/**
 * Open the board on `design`, its base take loaded, and pose it in the view.
 * Reads the Kimodo models once, in the background, for the board's picker.
 */
async function openDesign(context, design, take = null) {
  state.isOpen = true
  stageFor()
  state.board = await openBoard(context, { design, take, takes: state.takes })
  state.viewer.edit(sessionOf(state.board, () => context.redraw?.()))
  context.redraw?.()
  if (!state.kimodoModels.length)
    context.run('kimodo.models').then(models => {
      state.kimodoModels = Array.isArray(models) ? models : []
      context.redraw?.()
    })
}

/**
 * Reopen the board with the design changed to another rig or base take.
 * Keys are points on the old rig, so a new rig starts the design without them.
 */
async function rebaseBoard(context, change) {
  const design = state.board.design
  const isNewRig = change.model && change.model !== design.model
  const base = change.base ?? (isNewRig ? state.takes.find(take => take.model === change.model)?.clip : design.base)
  if (!base) throw new Error(`no take on ${change.model} to start from; make one on that rig first`)
  const cleared = isNewRig ? { keys: {}, body: [], solved: {} } : {}
  await openDesign(context, { ...design, ...change, base, ...cleared })
}

/** The side column: the design board, the cut board, or the list of takes. */
function sideFor(ui, context, shown) {
  if (state.board) return designSide(ui, context)
  if (state.cut) return ui.stack(cutSide(ui, context), { pad: true })
  return ui.stack(
    [
      ...studioRows(ui, context),
      ...chosenRows(ui, context),
      ...designListRows(ui, context),
      ui.search({
        value: state.filter,
        placeholder: 'filter takes',
        count: shown.length,
        onChange: value => {
          state.filter = value
          context.redraw?.()
        }
      }),
      ...(state.error && state.takes.length ? [ui.text(state.error, { dim: true })] : []),
      takeGrid(ui, context, shown)
    ],
    { pad: true }
  )
}

/** Load the whole take and open the cut board on it. A failure is shown on the take's rows. */
async function cutFromBoard(context, take) {
  try {
    state.cut = openCut(take, await context.run('kimodo.full', { clip: take.clip }))
    state.viewer?.show({ model: take.model, clip: state.cut.whole })
  } catch (error) {
    state.error = String(error?.message || error)
  }
  context.redraw?.()
}

/** The cut board's rows, with what each of its buttons does. */
function cutSide(ui, context) {
  const cut = state.cut
  const show = (clip, at = null) => state.viewer?.show({ model: cut.model, clip, at })
  const actions = {
    showFrame: frame => show(cut.whole, frame / cut.whole.framesPerSecond),
    showWhole: () => show(cut.whole),
    showCut: () => show(cutPreview(cut)),
    save: async () => {
      cut.note = 'Saving…'
      context.redraw?.()
      try {
        await context.run('kimodo.cut', { clip: cut.clip, first: cut.first, last: cut.last })
        // The clip file changed under its old name, which the cache and the still both hold.
        context.rigAnimation.forget()
        state.thumbnails.delete(cut.clip)
        state.cut = null
        await context.run('kimodo.takes')
        await context.run('kimodo.view', { clip: cut.clip })
      } catch (error) {
        cut.note = String(error?.message || error)
        context.redraw?.()
      }
    },
    close: async () => {
      state.cut = null
      await context.run('kimodo.view', { clip: cut.clip })
    }
  }
  return cutRows(ui, cut, actions)
}

function panel(ui, context) {
  // Read once when the panel is first drawn; after that only Read or a use reads again.
  if (!state.hasRead) {
    state.hasRead = true
    queueMicrotask(() => context.run('kimodo.takes'))
  }
  const words = state.filter.toLowerCase()
  const shown = state.takes.filter(take => !words || `${take.clip} ${take.prompt}`.toLowerCase().includes(words))
  const side = sideFor(ui, context, shown)
  // The side takes at most 40% so the view keeps room in a narrow dock.
  side.style.cssText += ';width:clamp(220px,40%,360px);flex:none;overflow:auto;height:100%'
  if (!state.board && !state.cut) {
    side.addEventListener('scroll', () => (state.sideScroll = side.scrollTop))
    // A detached element cannot scroll, so the position is put back once it is drawn.
    requestAnimationFrame(() => (side.scrollTop = state.sideScroll))
  }
  const board = ui.row([ui.raw(stageFor()), side])
  // The row must fill the panel body, or the view has no height to fill.
  board.style.cssText += ';height:100%;align-items:stretch'
  return board
}

export default {
  name: 'Kimodo',
  category: 'editor',
  about: 'Watch generated motion takes on their model, and choose which take a clip uses.',

  menus: [
    {
      id: 'kimodo.board',
      label: 'KIMODO',
      title: 'Watch motion takes and choose one',
      on: () => state.isOpen,
      run: context => context.run('kimodo.panel')
    }
  ],

  panels: [
    {
      id: 'kimodo',
      title: 'Kimodo · motion takes',
      dock: 'centre',
      order: 6,
      scroll: false,
      when: () => state.isOpen,
      actions: [
        { label: 'Read', run: context => context.run('kimodo.takes') },
        { label: 'Close ×', title: 'Close the board', run: closeBoard }
      ],
      render: panel
    }
  ],

  commands: [
    {
      id: 'kimodo.panel',
      label: 'Show or hide the takes board',
      run: context => {
        if (!context.shell) return { open: false, why: 'this is a headless world — there is no panel' }
        if (state.isOpen) closeBoard()
        else state.isOpen = true
        context.redraw()
        return { open: state.isOpen }
      }
    },
    {
      id: 'kimodo.takes',
      label: 'Motion takes',
      run: async context => {
        try {
          state.takes = await readTakes(context)
          const paths = (await context.files.tree()).map(item => item.path)
          state.designs = paths.filter(file => file.startsWith(`${DESIGNS}/`) && file.endsWith('.json'))
          state.items = paths
            .filter(file => file.startsWith(`${ITEMS}/`) && file.endsWith('.hold.json'))
            .map(file => file.slice(ITEMS.length + 1, -'.hold.json'.length))
          if (isStudio() && context.shell) state.games = (await context.run('project.list')).names ?? []
          state.error = null
        } catch (error) {
          state.error = String(error?.message || error)
        }
        context.redraw?.()
        if (context.shell) drawThumbnails(context)
        return state.error ? { error: state.error } : { takes: state.takes }
      }
    },
    {
      id: 'kimodo.view',
      label: 'Play a take',
      // args: {"clip":"motion/hero/take-a.json"}, as kimodo.takes names it
      run: (context, options = {}) => viewTake(context, options.clip)
    },
    {
      id: 'kimodo.design',
      label: 'Design a move on a take',
      // args: {"clip":"motion/hero/idle.json"} to start on a take, or {"file":"assets/motion/designs/chop.json"} to open one
      run: async (context, options = {}) => {
        if (!context.shell)
          return { open: false, why: 'the design board needs the editor; a headless world has no panel' }
        const design = options.file ? JSON.parse(await context.files.read(options.file)) : null
        const take = design ? null : await takeFor(context, options.clip)
        if (!design && !take?.model)
          return { error: `no take ${options.clip} with a model to design on — run kimodo.takes` }
        await openDesign(context, design, take)
        return { designing: state.board.design.name, base: state.board.design.base }
      }
    },
    {
      id: 'kimodo.new',
      label: 'Design a new move',
      // Starts from words: on the studio mannequin when there is one, else the first rig with a take.
      run: async context => {
        if (!context.shell) return { open: false, why: 'the design board needs the editor; a headless world has no panel' }
        if (!state.takes.length) state.takes = await readTakes(context)
        const onRig = state.takes.filter(take => take.model)
        const take = onRig.find(one => one.model === STUDIO.model && one.name === 'kimodo-idle') ?? onRig[0]
        if (!take) return { error: 'no take on a rig to design on: open Kimodo Studio, or retarget a clip onto a model' }
        await openDesign(context, { ...newDesign({ name: 'new-move', model: take.model, base: take.clip }), fromBase: false })
        return { designing: state.board.design.name, rig: take.model }
      }
    },
    {
      id: 'kimodo.key-pose',
      label: "Key a photo's pose on the design",
      // args: {"pose":"assets/poses/<image>.<model>.json","at":0.5,"person":0}; at is the board's time when left out
      run: async (context, options = {}) => {
        if (!state.board) return { error: 'no design is open: kimodo.design or kimodo.new first' }
        const record = JSON.parse(await context.files.read(options.pose))
        const seconds = options.at ?? state.board.time
        state.board.design = withPoseKeys(state.board.design, record, {
          seconds,
          rest: restOf(state.board.skeleton),
          person: options.person ?? 0
        })
        state.board.note = `Keyed ${options.pose} at ${seconds.toFixed(2)} s.`
        context.redraw?.()
        return { keyed: Object.keys(state.board.design.keys), at: seconds }
      }
    },
    {
      id: 'kimodo.delete',
      label: 'Delete a take',
      // args: {"clip":"motion/hero/take-a.json"}; removes the clip and, unless another clip names it, its stored motion
      run: async (context, options = {}) =>
        context.host
          ? (await takeFilesHalf()).deleteTake(context.host.project, options.clip)
          : runHeadless('kimodo.delete', options)
    },
    {
      id: 'kimodo.full',
      label: 'The whole take, to cut',
      // args: {"clip":"motion/hero/take-a.json"}; answers { clip, frames, kept }, every frame Kimodo made
      run: async (context, options = {}) =>
        context.host ? (await takeFilesHalf()).fullTake(context.host.project, options.clip) : runHeadless('kimodo.full', options)
    },
    {
      id: 'kimodo.cut',
      label: 'Cut a take again',
      // args: {"clip":"motion/hero/take-a.json","first":12,"last":57}; keeps capture frames first to last - 1
      run: async (context, options = {}) =>
        context.host
          ? (await takeFilesHalf()).cutTake(context.host.project, options.clip, options.first, options.last)
          : runHeadless('kimodo.cut', options)
    },
    {
      id: 'kimodo.models',
      label: 'Kimodo models, and which are installed',
      // Answers [{ model, skeleton, about, isInstalled, install }]; reading kimodo.cpp needs node.
      run: async context =>
        context.host ? (await nodeHalf()).kimodoModels(context.host.checkout) : runHeadless('kimodo.models')
    },
    {
      id: 'kimodo.designs',
      label: 'Saved designs',
      run: async context => ({
        designs: (await context.files.tree())
          .map(item => item.path)
          .filter(file => file.startsWith(`${DESIGNS}/`) && file.endsWith('.json'))
      })
    },
    {
      id: 'kimodo.save-design',
      label: 'Save the design on the board',
      run: async context => {
        if (!state.board) return { error: 'no design is open: kimodo.design first' }
        // Kimodo is sent where each elbow and knee is, so the design is saved with them solved.
        state.board.design = withSolvedJoints(state.board)
        const file = `${DESIGNS}/${state.board.design.name}.json`
        await context.files.write(file, JSON.stringify(state.board.design, null, 2) + '\n')
        return { file }
      }
    },
    {
      id: 'kimodo.generate',
      label: 'Generate a take from a design',
      // args: {"design":"assets/motion/designs/chop.json"}; runs kimodo.cpp, so only headless
      run: async (context, options = {}) => {
        if (!options.design) return { error: 'name the design: {"design":"assets/motion/designs/<name>.json"}' }
        if (!context.host)
          return {
            refused: 'kimodo.cpp is a program, and only a headless run can start one',
            run: generateCommand(options.design)
          }
        return (await nodeHalf()).generateDesign(context.host, options.design)
      }
    },
    {
      id: 'kimodo.studio',
      label: 'Open Kimodo Studio',
      // Makes the studio when it is missing. Headless, it only makes it; the editor then opens it.
      run: async context => {
        if (context.host) return (await studioHalf()).makeStudio(context.host.checkout, STUDIO)
        const made = await runHeadless('kimodo.studio')
        await context.run('project.open', made.studio)
        return made
      }
    },
    {
      id: 'kimodo.copy',
      label: 'Copy a studio take to a game',
      // args: {"clip":"motion/kimodo-mannequin/take-a.json","game":"arena-brawler"}; run in the studio
      run: async (context, options = {}) => {
        if (!options.clip || !options.game) return { error: 'name the take and the game: {"clip":"...","game":"..."}' }
        if (context.host) return (await studioHalf()).copyTakeToGame(context.host.checkout, context.host.project, options)
        return runHeadless('kimodo.copy', options)
      }
    },
    {
      id: 'kimodo.poses',
      label: 'Key poses by name',
      run: () => poseMenu()
    },
    {
      id: 'kimodo.pose',
      label: 'Design a move from key poses',
      // args: {"name":"chop","prompt":"a person chops down hard with a sword","model":"models/fighter.glb","base":"motion/fighter/idle.json","keys":[{"at":0,"pose":"guard"},{"at":0.5,"pose":"wind-up"}]}
      run: (context, options = {}) => designFromPoses(context, options, DESIGNS)
    },
    {
      id: 'kimodo.compare',
      label: 'How close a take came to its key poses',
      // args: {"design":"assets/motion/designs/chop.json"}, after kimodo.generate
      run: (context, options = {}) => compareDesign(context, options)
    },
    {
      id: 'kimodo.use',
      label: 'Use a take as a clip',
      // args: {"clip":"motion/hero/take-a.json","as":"slash"}: `as` is the clip beside it that the take replaces
      run: async (context, options = {}) => {
        const done = await useTake(context, options.clip, options.as)
        state.takes = await readTakes(context)
        context.redraw?.()
        return done
      }
    }
  ]
}
