import { sourceOfPlugin } from '../../../engine/plugin-import.js'

const core = (id, title, detail, file, anchor) => ({
  id, title, detail, group: 'Engine Core', source: { scope: 'engine', file, anchor }
})

/** The outline describes kernel control flow; children come from the current registry. */
export function inspectFlow(context, phase = 'fixed') {
  if (!['fixed', 'frame'].includes(phase)) throw new Error('phase must be fixed or frame')
  const loop = 'engine/loop.js'
  const start = 'engine/start-world.js'
  const nodes = phase === 'fixed' ? [
    core('positions', 'Remember positions', 'Capture positions before the step, including during pause.', start, 'onStepStart()'),
    core('pause', 'Pause?', 'Paused: clock and timers stay still; systems and entity updates receive 0 seconds.', loop, 'function fixedStep()'),
    core('clock', 'Advance time + run timers', 'Unpaused: advance by 1/60 second, then call due timers.', loop, 'function runTimers()'),
    core('hit-stop', 'Hit stop?', 'Unpaused hit stop: clock and timers ran; skip systems and entity updates.', loop, 'function fixedStep()'),
    core('systems', 'Run fixed systems', 'Expand to inspect registered plugins in their current execution order.', start, 'onFixed(seconds)'),
    core('entities', 'Update entities', 'Expand for loaded types and attached behaviours. Each entity runs behaviours first, then its type.', 'engine/world.js', 'function hook(')
  ] : [
    core('frame', 'Presentation callback', 'Live: after catch-up steps. Manual step(count): one presentation callback after all steps.', loop, 'function tick('),
    core('systems', 'Run frame systems', 'Expand to inspect registered plugins in their current execution order.', start, 'onFrame(seconds)'),
    core('sync', 'Sync renderer', 'If attached, copy world state to drawing objects using the interpolation blend.', start, 'context.renderer?.sync'),
    core('draw', 'Draw', 'If attached, render. Headless worlds skip this call.', start, 'context.renderer?.draw')
  ]
  let number = 0
  const occurrences = new Map()
  const systems = context.loader.contrib.systems.filter(system => system.phase === phase).map(system => {
    const definition = context.loader.plugins.get(system.plugin)?.definition
    const occurrence = occurrences.get(system.plugin) || 0
    occurrences.set(system.plugin, occurrence + 1)
    return {
      id: `system:${phase}:${encodeURIComponent(system.plugin)}:${occurrence}`, parent: 'systems', group: 'Plugins',
      title: `${++number}. ${system.plugin}`, detail: `Registered ${phase} system. Declared dependencies: ${(definition?.needs || []).join(', ') || 'none'}.`,
      source: sourceOfPlugin(definition), code: String(system.run), plugin: system.plugin
    }
  })
  const types = new Map()
  if (phase === 'fixed') for (const entity of context.world.entities) {
    if (!types.has(entity.type)) types.set(entity.type, entity)
  }
  const entities = [...types].map(([name, entity]) => {
    const id = `type:${name}`
    const entry = context.editor.index.types?.[name]
    return {
      id, parent: 'entities', group: 'Entity behaviours', title: name,
      detail: 'Representative entity: ' + entity.id + '. Expand to see its update hooks; other placements may attach different behaviours.',
      source: entry ? { scope: 'project', file: entry.file } : null,
      code: typeof entity._definition?.update === 'function' ? String(entity._definition.update) : '// This type has no update hook.',
      children: (entity.behaviours || []).filter(item => typeof item.definition.update === 'function').map((item, index) => ({
        id: `${id}:behaviour:${index}`, parent: id, group: 'Entity behaviours', title: `${index + 1}. ${item.name}`,
        detail: 'Attached behaviour update; runs before the type update.', code: String(item.definition.update),
        source: context.editor.index.behaviours?.[item.name] ? { scope: 'project', file: context.editor.index.behaviours[item.name].file } : null
      }))
    }
  })
  nodes.find(node => node.id === 'systems').children = systems
  if (phase === 'fixed') nodes.find(node => node.id === 'entities').children = entities
  return { phase, basis: 'Kernel outline + current registration order. This is not an execution trace.', nodes }
}

export function findNode(model, id) {
  for (const node of [...(model.nodes || model.children || []), ...(model.plugins || [])]) {
    if (node.id === id) return node
    const found = findNode({ children: node.children }, id)
    if (found) return found
  }
  return null
}
