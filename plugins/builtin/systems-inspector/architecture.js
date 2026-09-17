import { sourceOfPlugin } from '../../../engine/plugin-import.js'

const node = (id, title, detail, file, x, y, group = 'Engine Core', anchor) => ({
  id, title, detail, group, x, y, width: 200, height: 76,
  source: file ? { scope: 'engine', file, anchor } : null
})

/** Explicit module relationships, with plugin membership read from this world. */
export function inspectArchitecture(context) {
  const installed = [...context.loader.plugins.values()].filter(plugin => plugin.enabled)
  const systems = context.loader.contrib.systems
  const nodes = [
    node('boot', 'World setup', 'startWorld creates the core objects, configures update callbacks, boots plugins and loads the project.', 'engine/start-world.js', 400, 60, 'Engine Core', 'export async function startWorld'),
    node('world', 'World', 'Owns entities and dispatches their behaviour and type hooks. Stores current and previous positions.', 'engine/world.js', 40, 270, 'Engine Core', 'export function makeWorld'),
    node('loop', 'Loop', 'Owns time, timers and random streams. Calls the fixed and frame callbacks supplied by world setup.', 'engine/loop.js', 280, 270, 'Engine Core', 'export function makeLoop'),
    node('loader', 'Plugin Loader', 'Loads plugin definitions and collects their systems, commands and panels. Dependencies determine installation order.', 'engine/loader.js', 520, 270, 'Engine Core', 'export function makeLoader'),
    node('bus', 'Event Bus', 'Delivers named events to registered listeners. This node shows the event API, not inferred subscriptions.', 'engine/bus.js', 760, 270, 'Engine Core', 'export function makeBus'),
    node('renderer', 'Renderer', 'The optional browser renderer reads world state. Headless simulation can run without it.', 'engine/render.js', 40, 470),
    node('context', 'Shared Context', 'An object containing access to core parts and plugin services. It is shared access, not a scheduler.', 'engine/start-world.js', 520, 470, 'Engine Core', 'const context = {}'),
    node('entities', 'Entity behaviours', 'Game types and attached behaviours supply hooks dispatched by World. Select Simulation step to inspect representative entities.', 'engine/world.js', 40, 700, 'Game code', 'function hook('),
    node('plugins', `${installed.length} enabled plugins`, `${systems.filter(system => system.phase === 'fixed').length} fixed systems and ${systems.filter(system => system.phase === 'frame').length} frame systems. Select a plugin below to inspect its source and declared dependencies.`, null, 650, 700, 'Plugins')
  ]
  const edges = [
    { from: 'boot', to: 'world', label: 'creates', labelAt: [250,182], points: [[430,136],[430,190],[140,190],[140,270]] },
    { from: 'boot', to: 'loop', label: 'configures', labelAt: [400, 235], points: [[470,136],[470,215],[380,215],[380,270]] },
    { from: 'boot', to: 'loader', label: 'boots', labelAt: [555, 182], points: [[530,136],[530,190],[620,190],[620,270]] },
    { from: 'boot', to: 'bus', label: 'creates', labelAt: [765,157], points: [[570,136],[570,165],[860,165],[860,270]] },
    { from: 'world', to: 'renderer', label: 'state for drawing', labelAt: [150, 410], points: [[140,346],[140,470]] },
    { from: 'world', to: 'entities', label: 'dispatches hooks', labelAt: [35, 640], points: [[40,308],[15,308],[15,738],[40,738]] },
    { from: 'boot', to: 'context', label: 'assembles', labelAt: [845, 498], points: [[600,98],[1000,98],[1000,508],[720,508]] },
    { from: 'loader', to: 'plugins', label: 'loads / collects', labelAt: [760, 570], points: [[620,346],[750,346],[750,700]] },
    { from: 'context', to: 'plugins', label: 'passed to plugins', labelAt: [635, 628], points: [[620,546],[620,635],[690,635],[690,700]] },
    { from: 'bus', to: 'plugins', label: 'event API', labelAt: [885,630], points: [[860,346],[930,346],[930,738],[850,738]] },
    { from: 'loop', to: 'plugins', label: 'runs systems via callbacks', labelAt: [405, 592], points: [[380,346],[380,600],[730,600],[730,700]] }
  ]
  return {
    phase: 'architecture', width: 1030, height: 820, nodes, edges,
    groups: [{ title: 'ENGINE CORE', x: 25, y: 15, width: 955, height: 550 }, { title: 'GAME CODE', x: 25, y: 660, width: 290, height: 145 }, { title: 'PLUGINS', x: 570, y: 660, width: 410, height: 145 }],
    basis: 'Module relationships, not time order. Core connections are curated from code; plugin membership and dependencies come from the current loader.',
    plugins: installed.map(plugin => ({ id: `plugin:${plugin.definition.name}`, title: plugin.definition.name, group: 'Plugins',
      detail: plugin.definition.about || 'Plugin registered in this world.',
      dependencies: plugin.definition.needs || [], source: sourceOfPlugin(plugin.definition),
      code: typeof plugin.definition.onLoad === 'function' ? String(plugin.definition.onLoad) : '// This plugin has no onLoad hook. Use Full file to inspect its contributions.' }))
  }
}
