/**
 * VFX — the host for effect kinds the particle field cannot express.
 *
 * Particles owns anything that is a cloud of points. This owns everything with
 * a shape: a beam has a direction, a ribbon has a width across it, and neither
 * survives being drawn as a row of dots.
 *
 * One plugin rather than one per kind, because they share a contract and a
 * game reaches them all through one name. A kind is a module in `vfx/`
 * exporting `{ kind, title, about, make, painter }`: `make` builds the field,
 * `painter` is imported only in a browser. Adding a kind is one entry in
 * `KINDS` and one module — nothing here learns what a beam is.
 *
 * Every field is deterministic: the seeded drawing stream and `context.time`
 * only, so a run repeats and a headless test asserts an effect with no browser.
 */

import beams from './vfx/beams.js'

const KINDS = [beams]

const fields = new Map()      // kind name -> the live field
const painters = new Map()    // kind name -> the thing drawing it

/** Every field, built and bound to the engine's clock and drawing stream. */
function build(context) {
  for (const kind of KINDS) {
    const field = kind.make()
    // The drawing stream, not the simulation's: a visual effect must not shift
    // what the game rolls next.
    field.bind(context.drawing || context.random, () => context.time)
    fields.set(kind.kind, field)
  }
}

/**
 * Attach a painter per kind, once the renderer exists.
 *
 * Headless there is no renderer and this never runs, which is not an error —
 * the fields still simulate and still record.
 */
function attachPainters(context) {
  for (const kind of KINDS) {
    if (painters.has(kind.kind) || !kind.painter) continue
    Promise.all([import('three/webgpu'), import('three/tsl'), kind.painter()])
      .then(([THREE, TSL, module]) => {
        painters.set(kind.kind, module.makePainter(THREE, TSL, context.renderer.scene))
      })
      .catch(e => console.error(`[vfx] ${kind.kind} is recorded but not drawn — ${e.message}`))
  }
}

/** The one object a game reaches every kind through. */
function surface() {
  const api = {
    get kinds() { return [...fields.keys()] },
    get state() {
      const all = {}
      for (const [name, field] of fields) all[name] = field.state
      return all
    },
    recent(count = 20) {
      const all = []
      for (const [name, field] of fields) for (const record of field.recent(count)) all.push({ kind: name, ...record })
      return all.sort((a, b) => a.at - b.at).slice(-count)
    },
    clear() {
      for (const field of fields.values()) field.clear()
      for (const kind of KINDS) kind.forget?.()
    }
  }
  for (const [name, field] of fields) api[name] = field
  return api
}

export default {
  name: 'VFX',
  category: 'visuals',
  about: 'Shaped effects on the fixed clock.',
  inspect: context => [...fields].map(([name, field]) => ({ title: name, rows: Object.entries(field.state) })),

  onLoad(context) {
    if (context.vfx) console.error('[vfx] something else already put vfx on context — replacing it')
    build(context)
    context.vfx = surface()
    // The renderer arrives with the shell. A plugin loaded after the shell is
    // already ready never hears the event, so check for it as well as listen.
    const attach = () => { if (context.renderer?.scene) attachPainters(context) }
    context.bus.on('shell:ready', attach)
    attach()
    // A new level is a new run: an old beam is at coordinates that now mean
    // somewhere else, on a clock that went back to zero.
    context.bus.on('level:loaded', () => context.vfx.clear())
  },

  systems: [
    {
      phase: 'fixed',
      run(world, seconds) {
        for (const field of fields.values()) field.step(seconds, world)
      }
    },
    {
      phase: 'frame',
      run(world, seconds, context) {
        const time = context?.time ?? 0
        for (const [name, painter] of painters) painter.sync(fields.get(name), time)
      }
    }
  ],

  commands: [
    { id: 'vfx.state', label: 'Live effects by kind', run: context => context.vfx.state },
    { id: 'vfx.recent', label: 'Recent effects', run: (context, n) => context.vfx.recent(typeof n === 'number' ? n : 20) },
    { id: 'vfx.clear', label: 'Clear effects', run: context => { context.vfx.clear(); return context.vfx.state } },
    {
      id: 'vfx.beam',
      label: 'Make a beam',
      run: (context, argument) => {
        const [name, options] = Array.isArray(argument) ? argument : [argument, {}]
        return context.vfx.beams.effect(name, options || {})
      }
    }
  ]
}
