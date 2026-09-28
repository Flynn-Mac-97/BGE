/**
 * Animation States — which clip a rigged body plays, chosen by a state graph
 * the type names, with sets of actions layered over it and items held by
 * constraints.
 *
 * Each fixed step, before Rig Animation, every body whose type has
 * `animationStates` (a graph record, or a graph file under assets/) is
 * stepped (animation-states/body-step.js): its machine moves on
 * `entity.animationInputs`, an action asked for in `entity.animationAction`
 * plays as a layer, and the item in `entity.heldItem` is held. Game code sets
 * inputs, actions and the item; it never names a clip.
 *
 * The files: a graph `<name>.states.json`, sets `<set>.set.json`
 * (animation-states/graph.js), holds `<item>.hold.json`
 * (animation-states/held-items.js). An agent builds a graph with
 * `animation.scaffold` and checks it with `animation.graph`.
 */
import { makeOnceReporter } from '../../engine/report-once.js'
import { ITEM_FOLDER, SET_FOLDER, graphOf, heldRecordOf, setNamesOf, setsOf, stepBody } from './animation-states/body-step.js'
import { actionNames, actionOf, machineWith } from './animation-states/graph.js'
import { graphReport } from './animation-states/report.js'
import { scaffoldGraph } from './animation-states/scaffold.js'

const reportOnce = makeOnceReporter().report

/** Where a scaffolded graph is written, under assets/. */
const GRAPH_FOLDER = 'animation'

/** world -> { context, files }: the file reader, and each file read (path -> { value }). */
const worlds = new WeakMap()

/** A JSON file under assets/ as a record, read once; null while it loads or when it cannot be read. */
function readJsonIn(state, path) {
  if (!state.files.has(path)) {
    const entry = { value: null, waiting: null }
    state.files.set(path, entry)
    entry.waiting = state.context.files
      .read(`assets/${path}`)
      .then(text => (entry.value = JSON.parse(text)))
      .catch(error => reportOnce(`[animation-states] cannot read assets/${path} — ${error.message}`))
  }
  return state.files.get(path).value
}

/** The same file, answered when it has been read: null when it cannot be. */
async function loadJsonIn(state, path) {
  readJsonIn(state, path)
  await state.files.get(path).waiting
  return state.files.get(path).value
}

/**
 * Read every file a body's graph needs and load every take it names: the
 * graph, each item's hold and set, each set, and the clips of every state and
 * action. What a headless run awaits before it simulates, as it awaits rig.load.
 */
async function loadBody(state, entity, items) {
  const definition = entity._definition
  const graph = typeof definition.animationStates === 'string' ? await loadJsonIn(state, definition.animationStates) : definition.animationStates
  if (!graph) return []
  const holds = await Promise.all(items.map(item => loadJsonIn(state, `${graph.items ?? ITEM_FOLDER}/${item}.hold.json`)))
  const names = [...new Set([...(graph.sets ?? []), ...holds.map(hold => hold?.set).filter(Boolean)])]
  const sets = (await Promise.all(names.map(name => loadJsonIn(state, `${graph.setsFolder ?? SET_FOLDER}/${name}.set.json`)))).filter(Boolean)
  const machine = machineWith(graph, sets)
  const clips = [
    ...Object.values(machine.states).flatMap(one => one.clips ?? []),
    ...actionNames(sets).flatMap(name => actionOf(sets, name).clips)
  ]
  const files = [...new Set(clips.map(clip => definition.rig?.clips?.[clip] ?? clip))]
  await Promise.all(files.map(file => state.context.rigAnimation?.load(file).catch(error => reportOnce(`[animation-states] ${error.message}`))))
  return files
}

/** Every entity in the world that has a graph. */
const bodiesIn = world => world.entities.filter(entity => entity._definition?.animationStates)

/** An entity's state in words, as the commands and the panel give it. */
const stateReport = entity => ({
  id: entity.id,
  type: entity.type,
  state: entity.animationState ?? null,
  clip: entity._animationClip ?? null,
  clipTime: Number((entity._rigTime ?? 0).toFixed(2)),
  isClipDone: Boolean(entity.rigDone),
  action: entity._animationAction?.name ?? null,
  inputs: entity.animationInputs ?? {},
  held: entity.heldItem ?? null
})

/** The machine a body runs now, and the sets that are on; null while its graph loads. */
function machineOf(state, entity) {
  const readJson = path => readJsonIn(state, path)
  const graph = graphOf(entity._definition, readJson)
  if (!graph) return null
  const sets = setsOf(graph, setNamesOf(graph, heldRecordOf(entity, graph, readJson)), readJson)
  return { graph, sets, machine: machineWith(graph, sets) }
}

/** The asset names under `folder` that end in `ending`, without it. */
async function namesIn(context, folder, ending) {
  const prefix = `assets/${folder}/`
  return (await context.files.tree())
    .map(item => item.path)
    .filter(file => file.startsWith(prefix) && file.endsWith(ending) && !file.slice(prefix.length).includes('/'))
    .map(file => file.slice(prefix.length, -ending.length))
}

/** What the panel last read of the items, so a draw never waits on the disk. */
const panelItems = { names: [], hasRead: false }

/** The rows the panel shows for one body: its state now, what it can do, and its graph with the live state marked. */
function bodyRows(ui, context, state, entity) {
  const report = stateReport(entity)
  const running = machineOf(state, entity)
  const inputs = Object.entries(report.inputs).map(([name, value]) => `${name} ${typeof value === 'number' ? value.toFixed(2) : value}`)
  const transitions = running ? graphReport(running.machine, entity._definition.rig?.clips).transitions : []
  const isLive = line => line.startsWith('any ') || line.split(' -> ')[0].split('|').includes(report.state)
  return [
    ui.text(`${report.id}: ${report.state ?? '—'}${report.action ? ` + ${report.action}` : ''}`),
    ui.text(`clip ${report.clip ?? '—'}`, { dim: true }),
    ui.text(inputs.join(' · ') || 'no inputs set', { dim: true }),
    ui.row(
      ['none', ...panelItems.names].map(item =>
        ui.button(item, () => context.run('animation.hold', { id: report.id, item }), { small: true, primary: (report.held ?? 'none') === item })
      )
    ),
    ...(running && actionNames(running.sets).length
      ? [ui.row(actionNames(running.sets).map(action => ui.button(action, () => context.run('animation.act', { id: report.id, action }), { small: true })))]
      : []),
    ui.text('Transitions from here, in priority order:', { dim: true }),
    ...transitions.filter(isLive).map(line => ui.text(line, { dim: !line.includes(`-> ${report.state} `) }))
  ]
}

export default {
  name: 'Animation States',
  category: 'visuals',
  about: 'Choose a rigged body\'s clip with a state graph, layer sets of actions over it, and hold items by constraints.',

  onLoad(context) {
    const state = { context, files: new Map() }
    worlds.set(context.world, state)
    context.animationStates = {
      /** Metres a second the entity's current clip travels: the speed to move it at so the feet do not slide. 0 while it loads. */
      travelOf: entity => context.rigAnimation?.travelOf(entity, entity._animationClip) ?? 0,
      /** The entity's state, clip, action, inputs and held item. */
      stateOf: stateReport,
      /** Forget every graph, set and hold file read, so edited files are read again. */
      reload: () => state.files.clear()
    }
  },

  systems: [{
    id: 'animation-states',
    phase: 'fixed',
    before: ['rig-animation'],
    run(world, seconds) {
      const state = worlds.get(world)
      if (!state) return
      for (const entity of bodiesIn(world)) {
        stepBody({
          entity,
          readJson: path => readJsonIn(state, path),
          skeletonOf: body => state.context.rigAnimation?.skeletonOf(body) ?? null,
          random: state.context.random,
          seconds,
          report: words => reportOnce(`[animation-states] ${entity.type}: ${words}`)
        })
      }
    }
  }],

  commands: [
    {
      id: 'animation.graph',
      label: 'A body\'s graph in words, its problems, and a flowchart',
      // args: {"type":"player"}; every type with a graph when left out
      run: async (context, options = {}) => {
        const state = worlds.get(context.world)
        const paths = new Set((await context.files.tree()).map(item => item.path))
        const bodies = bodiesIn(context.world).filter(entity => !options.type || entity.type === options.type)
        const byType = new Map(bodies.map(entity => [entity.type, entity]))
        return Object.fromEntries(
          [...byType].map(([type, entity]) => {
            const running = machineOf(state, entity)
            if (!running) return [type, { loading: entity._definition.animationStates }]
            const file = typeof entity._definition.animationStates === 'string' ? entity._definition.animationStates : null
            return [type, { file, sets: running.sets.length, actions: actionNames(running.sets), ...graphReport(running.machine, entity._definition.rig?.clips, paths) }]
          })
        )
      }
    },
    {
      id: 'animation.scaffold',
      label: 'Build a first graph from a folder of takes',
      // args: {"folder":"motion/kimodo-mannequin","name":"hero","skip":["slash"]}; writes assets/animation/hero.states.json
      run: async (context, options = {}) => {
        if (!options.folder || !options.name) return { error: 'name the takes\' folder and the graph: {"folder":"motion/<model>","name":"<graph>"}' }
        const skip = options.skip ?? []
        const takes = (await namesIn(context, options.folder, '.json')).filter(take => !skip.some(word => take.includes(word)))
        if (!takes.length) return { error: `no takes in assets/${options.folder}/` }
        const file = `${GRAPH_FOLDER}/${options.name}.states.json`
        const paths = new Set((await context.files.tree()).map(item => item.path))
        if (paths.has(`assets/${file}`) && !options.replace) return { error: `assets/${file} exists; pass "replace": true to write over it` }
        const { graph, unwired } = scaffoldGraph(options.folder, takes)
        await context.files.write(`assets/${file}`, JSON.stringify(graph, null, 2) + '\n')
        return {
          file: `assets/${file}`,
          type: `animationStates: '${file}'`,
          states: Object.keys(graph.states),
          unwired,
          next: 'Point the type at the file, set the inputs the transitions read (animation.graph lists them), then run animation.graph for problems.'
        }
      }
    },
    {
      id: 'animation.load',
      label: 'Read every graph, set and item, and load their takes',
      // What a headless run or test awaits before it simulates.
      run: async context => {
        const state = worlds.get(context.world)
        const items = await namesIn(context, ITEM_FOLDER, '.hold.json')
        const loaded = await Promise.all(bodiesIn(context.world).map(entity => loadBody(state, entity, items)))
        return { clips: new Set(loaded.flat()).size }
      }
    },
    {
      id: 'animation.state',
      label: 'Each body\'s state, clip, action, inputs and held item now',
      // args: {"id":"player"} for one entity; all of them when left out
      run: (context, options = {}) => bodiesIn(context.world).filter(entity => !options.id || entity.id === options.id).map(stateReport)
    },
    {
      id: 'animation.hold',
      label: 'Hold an item, or let go',
      // args: {"id":"player","item":"sword"}; item null or "none" lets go
      run: (context, options = {}) => {
        const entity = context.world.entities.find(one => one.id === options.id)
        if (!entity) return { error: `no entity ${options.id}` }
        entity.heldItem = options.item && options.item !== 'none' ? options.item : null
        return stateReport(entity)
      }
    },
    {
      id: 'animation.act',
      label: 'Play an action from a set that is on',
      // args: {"id":"player","action":"attack"}
      run: (context, options = {}) => {
        const entity = context.world.entities.find(one => one.id === options.id)
        if (!entity) return { error: `no entity ${options.id}` }
        entity.animationAction = options.action
        return stateReport(entity)
      }
    },
    {
      id: 'animation.library',
      label: 'The items and sets this project has',
      run: async context => ({
        items: await namesIn(context, ITEM_FOLDER, '.hold.json'),
        sets: await namesIn(context, SET_FOLDER, '.set.json'),
        graphs: await namesIn(context, GRAPH_FOLDER, '.states.json')
      })
    },
    {
      id: 'animation.reload',
      label: 'Read graph, set and hold files again',
      run: context => {
        context.animationStates.reload()
        return { reloaded: true }
      }
    }
  ],

  panels: [{
    id: 'animation-states',
    title: 'Animation States',
    dock: 'right',
    order: 7,
    when: context => bodiesIn(context.world).length > 0,
    actions: [{ label: 'Reload', title: 'Read graph, set and hold files again', run: context => context.run('animation.reload') }],
    render(ui, context) {
      if (!panelItems.hasRead) {
        panelItems.hasRead = true
        namesIn(context, ITEM_FOLDER, '.hold.json').then(names => {
          panelItems.names = names
          context.redraw?.()
        })
      }
      const state = worlds.get(context.world)
      return ui.stack(bodiesIn(context.world).flatMap(entity => bodyRows(ui, context, state, entity)), { pad: true })
    }
  }]
}
