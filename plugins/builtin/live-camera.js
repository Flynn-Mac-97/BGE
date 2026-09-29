/**
 * Live Camera — cameras for play, updated on every drawn frame.
 *
 * A level lists cameras in its `cameras` block. Each has a `kind` (how it moves)
 * and a `priority`; the highest priority is live. This runs as a frame system,
 * after the fixed steps and before the draw, so mouse turn reaches the screen on
 * the frame it arrived and the camera reads bodies where they are drawn.
 *
 * Kinds are modules with `start(camera)` and `frame(camera, seconds, context)`.
 * A game adds its own through `context.cameras.registerKind`.
 */
import thirdPerson from './live-camera/third-person.js'

const BUILTIN_KINDS = { 'third-person': thirdPerson }

export default {
  name: 'Live Camera',
  category: 'engine',
  about: 'The level\'s highest-priority camera, every drawn frame.',

  inspect: context => {
    const live = context.cameras?.state()
    if (!live) return []
    return [{ title: 'Live camera', rows: stateRows(live) }]
  },

  onLoad(context) {
    const kinds = new Map(Object.entries(BUILTIN_KINDS))
    const rig = { cameras: [], chosen: null, live: null, report: null, editorView: null, frameSeconds: 0 }

    context.cameras = {
      /** Every camera the level declared or a plugin added, in the level's order. */
      list: () => rig.cameras.map(camera => ({ id: camera.id, kind: camera.kind, priority: camera.priority })),
      /** Make one camera live regardless of priority. `null` goes back to priority. */
      activate(id) {
        if (id !== null && !rig.cameras.some(camera => camera.id === id)) throw new Error(`no camera "${id}"`)
        rig.chosen = id
        return id
      },
      add(definition) { return addCamera(rig, kinds, definition) },
      remove(id) { rig.cameras = rig.cameras.filter(camera => camera.id !== id) },
      registerKind(name, kind) {
        if (typeof kind?.frame !== 'function') throw new Error(`camera kind "${name}" has no frame(camera, seconds, context)`)
        kinds.set(name, kind)
      },
      kinds: () => [...kinds].map(([name, kind]) => ({ name, about: kind.about || '', defaults: kind.defaults || {} })),
      /** The live camera's ground forward, for movement relative to the view. */
      forward: () => ({ x: -Math.sin(context.view.yaw || 0), y: 0, z: -Math.cos(context.view.yaw || 0) }),
      right: () => ({ x: Math.cos(context.view.yaw || 0), y: 0, z: -Math.sin(context.view.yaw || 0) }),
      state: () => describeState(rig, context)
    }
    rigs.set(context.cameras, rig)

    context.bus.on('level:loaded', (name, camera, level) => {
      rig.cameras = []
      rig.chosen = null
      rig.live = null
      for (const definition of level?.cameras || []) {
        try { addCamera(rig, kinds, definition) } catch (error) { console.error(`[live-camera] level ${name}: ${error.message}`) }
      }
    })

    context.bus.on('play:started', () => {
      const view = context.view
      rig.editorView = { x: view.x, y: view.y, z: view.z, zoom: view.zoom, mode: view.mode, yaw: view.yaw, pitch: view.pitch, fov: view.fov }
      rig.live = null
    })

    context.bus.on('play:stopped', () => {
      if (rig.editorView && rig.cameras.length) Object.assign(context.view, rig.editorView)
      rig.editorView = null
      rig.live = null
    })
  },

  systems: [{
    phase: 'frame',
    run(world, seconds, context) {
      const rig = context.cameras && rigOf(context)
      // A tool that aims the view for one picture marks it borrowed until it gives it back.
      if (!rig || !rig.cameras.length || context.view.borrowedBy) return
      const camera = liveCamera(rig)
      if (rig.live !== camera) {
        rig.live = camera
        camera.kindModule.start?.(camera, context)
      }
      rig.report = camera.kindModule.frame(camera, seconds, context) || {}
      rig.frameSeconds = seconds
      context.view.follows = rig.report.following ?? null
    }
  }],

  panels: [{
    id: 'live-camera',
    title: 'Cameras',
    dock: 'right',
    collapsed: true,
    order: 60,
    actions: [{ label: 'Refresh', run: context => context.redraw?.() }],
    render(ui, context) {
      const live = context.cameras?.state()
      if (!live || !live.cameras.length) return ui.text('No cameras. Add a `cameras` list to the level.', { dim: true })
      return ui.stack([
        ...stateRows(live).map(([key, value]) => ui.text(`${key}: ${value}`)),
        ...live.cameras.map(camera => ui.row([
          ui.text(`${camera.id} — ${camera.kind}, priority ${camera.priority}`),
          ui.button('Live', () => context.run('cameras.activate', { id: camera.id }))
        ]))
      ])
    }
  }],

  commands: [
    {
      id: 'cameras.state',
      label: 'Live camera state',
      run: context => context.cameras.state()
    },
    {
      id: 'cameras.activate',
      label: 'Activate a camera',
      run: (context, options = {}) => ({ live: context.cameras.activate(options.id ?? null) })
    },
    {
      id: 'cameras.kinds',
      label: 'Camera kinds',
      run: context => context.cameras.kinds()
    }
  ]
}

// Per context, so two headless worlds in one process keep separate cameras.
const rigs = new WeakMap()
const rigOf = context => rigs.get(context.cameras)

function addCamera(rig, kinds, definition) {
  const kindModule = kinds.get(definition.kind)
  if (!kindModule) throw new Error(`camera "${definition.id}" has kind "${definition.kind}", which is not one of ${[...kinds.keys()].join(', ')}`)
  if (!definition.id) throw new Error('a camera needs an id')
  const camera = {
    id: definition.id,
    kind: definition.kind,
    priority: definition.priority ?? 0,
    settings: { ...(kindModule.defaults || {}), ...definition },
    kindModule,
    state: null
  }
  rig.cameras = rig.cameras.filter(existing => existing.id !== camera.id).concat(camera)
  return camera
}

/** The chosen camera, or the highest priority; the first listed wins a tie. */
function liveCamera(rig) {
  const chosen = rig.chosen && rig.cameras.find(camera => camera.id === rig.chosen)
  if (chosen) return chosen
  return rig.cameras.reduce((best, camera) => (camera.priority > best.priority ? camera : best))
}

function describeState(rig, context) {
  const view = context.view
  const round = value => (Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value)
  return {
    live: rig.live?.id ?? null,
    kind: rig.live?.kind ?? null,
    following: rig.report?.following ?? null,
    problem: rig.report?.problem ?? null,
    view: { mode: view.mode, x: round(view.x), y: round(view.y), z: round(view.z), yaw: round(view.yaw), pitch: round(view.pitch), fov: view.fov },
    distance: round(rig.live?.state?.distance),
    frameSeconds: round(rig.frameSeconds),
    blend: round(context.loop?.blend),
    cameras: rig.cameras.map(camera => ({ id: camera.id, kind: camera.kind, priority: camera.priority })),
    notes: rig.live ? [] : ['no camera has run yet — cameras run only while the world plays or is simulated']
  }
}

function stateRows(live) {
  return [
    ['live', live.live ?? '—'],
    ['kind', live.kind ?? '—'],
    ['following', live.following ?? '—'],
    ['distance', live.distance ?? '—'],
    ['frame ms', live.frameSeconds ? Math.round(live.frameSeconds * 1000 * 10) / 10 : '—'],
    ...(live.problem ? [['problem', live.problem]] : [])
  ]
}
