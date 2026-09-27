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
 *   run kimodo.takes                           every clip, its prompt and its length
 *   run kimodo.view '{"clip":"motion/hero/take-a.json"}'
 *   run kimodo.use '{"clip":"motion/hero/take-a.json","as":"slash"}'
 *   run kimodo.design '{"clip":"motion/hero/idle.json"}'   design on a take (the board)
 *   run kimodo.designs                                     every saved design
 *   node bin/engine.mjs --headless run kimodo.generate '{"design":"assets/motion/designs/chop.json"}'
 */
import { mountViewer } from './kimodo/viewer.js'
import { designRows, openBoard, sessionOf } from './kimodo/design-board.js'
import { runHeadless } from '../../engine/headless-job.js'

const DESIGNS = 'assets/motion/designs'

/** The node half, loaded only where a program can be started. */
const nodeHalf = () => import('./kimodo/generate.mjs')

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
  board: null
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
  if (state.viewer && take.model) state.viewer.show({ model: take.model, clip: await context.rigAnimation.load(clip) })
  context.redraw?.()
  return take
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
    ui.pick({
      options: targets.map(other => other.name),
      value: state.target,
      onChange: name => {
        state.target = name
      }
    }),
    ui.button(
      state.target ? `Use as ${state.target}` : 'Use as…',
      () => {
        if (state.target) context.run('kimodo.use', { clip: take.clip, as: state.target })
      },
      { primary: Boolean(state.target) }
    ),
    ...(take.model ? [ui.button('Design on this take', () => context.run('kimodo.design', { clip: take.clip }))] : [])
  ]
}

/** The saved designs, each opened on the board when picked. */
function designListRows(ui, context) {
  if (!state.designs.length) return []
  return [
    ui.text('Designs:', { dim: true }),
    ui.list({
      items: state.designs,
      key: file => file,
      row: file => [ui.label(file.split('/').pop().replace('.json', ''))],
      onPick: file => context.run('kimodo.design', { file })
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
  state.board.note = 'Generating. Kimodo takes about two minutes for two seconds of motion.'
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
  const noting = work => () =>
    work().catch(error => {
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
    }
  }
  return ui.stack(designRows(ui, state.board, actions, redraw), { pad: true })
}

function panel(ui, context) {
  // Read once when the panel is first drawn; after that only Read or a use reads again.
  if (!state.hasRead) {
    state.hasRead = true
    queueMicrotask(() => context.run('kimodo.takes'))
  }
  const words = state.filter.toLowerCase()
  const shown = state.takes.filter(take => !words || `${take.clip} ${take.prompt}`.toLowerCase().includes(words))
  const side = state.board
    ? designSide(ui, context)
    : ui.stack(
        [
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
          ui.list({
            items: shown,
            key: take => take.clip,
            selected: state.chosen,
            emptyText: state.error || 'no clips under assets/motion/',
            row: take => [ui.label(take.name), ui.spacer(), ui.meta(`${take.folder} · ${take.seconds}s`)],
            onPick: take => context.run('kimodo.view', { clip: take.clip })
          })
        ],
        { pad: true }
      )
  // The side takes at most 40% so the view keeps room in a narrow dock.
  side.style.cssText += ';width:clamp(220px,40%,360px);flex:none;overflow:auto;height:100%'
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
          state.designs = (await context.files.tree())
            .map(item => item.path)
            .filter(file => file.startsWith(`${DESIGNS}/`) && file.endsWith('.json'))
          state.error = null
        } catch (error) {
          state.error = String(error?.message || error)
        }
        context.redraw?.()
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
        state.isOpen = true
        stageFor()
        state.board = await openBoard(context, { design, take })
        state.viewer.edit(sessionOf(state.board, () => context.redraw?.()))
        context.redraw?.()
        return { designing: state.board.design.name, base: state.board.design.base }
      }
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
