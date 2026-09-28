/**
 * Animation States — which clip a rigged body plays, chosen by a state machine
 * the type declares as data, and the item it holds, held by constraints over
 * the clip.
 *
 * Each fixed step, before Rig Animation samples the clip, it reads the
 * entity's `animationInputs`, moves the machine (animation-states/machine.js),
 * and sets `entity.rigClip` to the state's clip, one picked at random when the
 * state is entered. When `entity.heldItem` names an item, it reads the item's
 * hold record and writes the constraints that hold it into
 * `entity.rigConstraints`, and hangs the item in `entity.attachments.held`
 * (animation-states/held-items.js). Rig Animation then plays and solves both.
 *
 * Game code sets inputs and the held item; it never names a clip.
 */
import { machineProblems, nextState, pickClip } from './animation-states/machine.js'
import { heldPose } from './animation-states/held-items.js'
import { yawPitchRollOf } from './game-maths/turns.js'
import { makeOnceReporter } from '../../engine/report-once.js'

const reportOnce = makeOnceReporter().report

/** Where hold records are when a type names no folder: `<folder>/<item>.hold.json` under assets/. */
const ITEM_FOLDER = 'models/items'

/** world -> { context, records }: the file reader, and each hold record read (file -> { value }). */
const worlds = new WeakMap()

/** The hold record for `item`, read once; null while it loads or when it is missing. */
function recordOf(state, entity) {
  const folder = entity._definition.animationStates.items ?? ITEM_FOLDER
  const file = `assets/${folder}/${entity.heldItem}.hold.json`
  if (!state.records.has(file)) {
    const entry = { value: null }
    state.records.set(file, entry)
    state.context.files
      .read(file)
      .then(text => (entry.value = JSON.parse(text)))
      .catch(error => reportOnce(`[animation-states] ${entity.id}: cannot read ${file} — ${error.message}`))
  }
  return state.records.get(file).value
}

/** Enter `name`: remember the state and pick its clip. */
function enter(entity, machine, name, random) {
  entity.animationState = name
  entity._animationClip = pickClip(machine, name, random())
}

/** Move one entity's machine a step and set the clip Rig Animation plays. */
function stepMachine(entity, machine, random) {
  if (!entity.animationState || !machine.states[entity.animationState]) {
    enter(entity, machine, machine.start ?? Object.keys(machine.states)[0], random)
  }
  const inputs = { ...entity.animationInputs, done: Boolean(entity.rigDone) }
  const next = nextState(machine, entity.animationState, inputs)
  if (next !== entity.animationState) enter(entity, machine, next, random)
  if (entity._animationClip) entity.rigClip = entity._animationClip
}

/** Hold the entity's item this step, or let go of one it held. */
function stepHold(state, entity, machine, seconds) {
  const record = entity.heldItem ? recordOf(state, entity) : null
  const skeleton = state.context.rigAnimation?.skeletonOf(entity)
  const weight = machine.states[entity.animationState]?.hold ?? 1
  const held = record && skeleton && entity.pose && heldPose({ record, skeleton, pose: entity.pose, seconds: entity._heldTime ?? 0, memory: (entity._heldMemory ??= {}), weight })
  entity._heldTime = (entity._heldTime ?? 0) + seconds
  if (!held) {
    if (entity._isHolding) {
      entity.attachments = Object.fromEntries(Object.entries(entity.attachments ?? {}).filter(([name]) => name !== 'held'))
      entity.rigConstraints = []
      entity._isHolding = false
    }
    return
  }
  const { model, node, position, turn } = held.attachment
  entity.attachments = { ...entity.attachments, held: { model, node, position, rotation: yawPitchRollOf(turn) } }
  entity.rigConstraints = held.constraints
  entity._isHolding = true
}

/** Every entity in the world that has a machine. */
const machinesIn = world => world.entities.filter(entity => entity._definition?.animationStates)

/** An entity's state in words, as the commands and the panel give it. */
const stateReport = entity => ({
  id: entity.id,
  type: entity.type,
  state: entity.animationState ?? null,
  clip: entity._animationClip ?? null,
  inputs: entity.animationInputs ?? {},
  held: entity.heldItem ?? null
})

/** The item names that have a hold record under the folder. */
async function itemsIn(context, folder = ITEM_FOLDER) {
  const prefix = `assets/${folder}/`
  return (await context.files.tree())
    .map(item => item.path)
    .filter(file => file.startsWith(prefix) && file.endsWith('.hold.json'))
    .map(file => file.slice(prefix.length, -'.hold.json'.length))
}

/** What the panel last read of the items, so a draw never waits on the disk. */
const panelItems = { names: [], hasRead: false }

export default {
  name: 'Animation States',
  category: 'visuals',
  about: 'Choose a rigged body\'s clip with a state machine declared on its type, and hold items by constraints over it.',

  onLoad(context) {
    worlds.set(context.world, { context, records: new Map() })
    context.animationStates = {
      /**
       * Metres a second the entity's current clip travels: the speed to move
       * it at so the feet do not slide. 0 while the clip loads.
       */
      travelOf: entity => context.rigAnimation?.travelOf(entity, entity._animationClip) ?? 0,
      /** The entity's state, clip, inputs and held item. */
      stateOf: stateReport
    }
  },

  systems: [{
    id: 'animation-states',
    phase: 'fixed',
    before: ['rig-animation'],
    run(world, seconds) {
      const state = worlds.get(world)
      if (!state) return
      for (const entity of machinesIn(world)) {
        const machine = entity._definition.animationStates
        const problems = machineProblems(machine, entity._definition.rig?.clips)
        if (problems.length) {
          reportOnce(`[animation-states] ${entity.type}: ${problems.join('; ')}`)
          continue
        }
        stepMachine(entity, machine, state.context.random)
        stepHold(state, entity, machine, seconds)
      }
    }
  }],

  commands: [
    {
      id: 'animation.states',
      label: 'Every type\'s animation states, and what is wrong with them',
      run: context => {
        const types = new Map(machinesIn(context.world).map(entity => [entity.type, entity._definition]))
        return Object.fromEntries(
          [...types].map(([type, definition]) => [
            type,
            {
              states: Object.fromEntries(Object.entries(definition.animationStates.states).map(([name, one]) => [name, one.clips])),
              transitions: definition.animationStates.transitions?.length ?? 0,
              problems: machineProblems(definition.animationStates, definition.rig?.clips)
            }
          ])
        )
      }
    },
    {
      id: 'animation.state',
      label: 'Each body\'s state, clip, inputs and held item now',
      // args: {"id":"player"} for one entity; all of them when left out
      run: (context, options = {}) =>
        machinesIn(context.world)
          .filter(entity => !options.id || entity.id === options.id)
          .map(stateReport)
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
      id: 'animation.items',
      label: 'Items that have a hold record',
      run: async context => ({ items: await itemsIn(context) })
    }
  ],

  panels: [{
    id: 'animation-states',
    title: 'Animation States',
    dock: 'right',
    order: 7,
    when: context => machinesIn(context.world).length > 0,
    render(ui, context) {
      if (!panelItems.hasRead) {
        panelItems.hasRead = true
        itemsIn(context).then(names => {
          panelItems.names = names
          context.redraw?.()
        })
      }
      return ui.stack(
        machinesIn(context.world).flatMap(entity => {
          const report = stateReport(entity)
          const inputs = Object.entries(report.inputs).map(([name, value]) => `${name} ${typeof value === 'number' ? value.toFixed(2) : value}`)
          return [
            ui.text(`${report.id}: ${report.state ?? '—'}`),
            ui.text(`clip ${report.clip ?? '—'}`, { dim: true }),
            ui.text(inputs.join(' · ') || 'no inputs set', { dim: true }),
            ui.row(
              ['none', ...panelItems.names].map(item =>
                ui.button(item, () => context.run('animation.hold', { id: report.id, item }), {
                  small: true,
                  primary: (report.held ?? 'none') === item
                })
              )
            )
          ]
        }),
        { pad: true }
      )
    }
  }]
}
