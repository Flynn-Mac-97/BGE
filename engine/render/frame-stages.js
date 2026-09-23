/**
 * Kernel: the legacy `stages` surface over the pass graph.
 *
 * The frame used to be a fixed list — world, post, viewmodel. The graph replaces
 * that with labelled passes, where `world` is the graph's `scene`. This adapter
 * keeps the old names and the old before/after placement working: it records the
 * draws in the old lists, then republishes them into the graph in the old total
 * order, bracketed by the labels either side of the anchor. New code orders
 * against graph labels directly.
 */
import { reportOnce } from './report.js'

export function makeFrameStages(state, coreDraws) {
  const graph = state.graph
  // The core label chain, and the legacy name each core draw answers to.
  const chain = ['clear', 'scene', 'post', 'viewmodel', 'ui', 'present']
  const alias = { world: 'scene', post: 'post', viewmodel: 'viewmodel' }

  const stages = [
    { name: 'world', before: [], after: [] },
    { name: 'post', before: [], after: [] },
    { name: 'viewmodel', before: [], after: [] }
  ]
  const byName = new Map(stages.map(stage => [stage.name, stage]))
  // Where each added draw went, so `remove` can take it out and a second `add`
  // under one name replaces the first.
  const placed = new Map()

  function refuse(what, name) {
    reportOnce(`[render] stages.${what}: no stage called ${JSON.stringify(name)} — one of ${[...byName.keys()].join(', ')}`)
  }

  function removePlaced(name) {
    const placement = placed.get(name)
    if (!placement) return
    const at = placement.list.indexOf(placement.entry)
    if (at !== -1) placement.list.splice(at, 1)
    placed.delete(name)
  }

  /** Republish every legacy draw into the graph, in the old total order. */
  function publish() {
    // Drop them first: a Map keeps the first insertion order for a replaced
    // key, and the tie-break between two draws in one gap reads that order.
    for (const name of placed.keys()) graph.remove(name)
    for (const stage of stages) {
      for (const side of ['before', 'after']) {
        for (const entry of stage[side]) {
          const anchor = alias[stage.name]
          const at = chain.indexOf(anchor)
          const bracket = side === 'before'
            ? { after: [chain[at - 1]], before: [anchor] }
            : { after: [anchor], before: [chain[at + 1]] }
          graph.add({ name: entry.name, after: bracket.after, before: bracket.before, execute: entry.draw })
        }
      }
    }
  }

  const stagesApi = {
    /** The core stage names, in the order the frame runs them. */
    get names() { return stages.map(stage => stage.name) },

    /** Add a draw before or after a named stage. */
    add(name, draw, place) {
      if (typeof name !== 'string' || !name || typeof draw !== 'function') {
        reportOnce(`[render] stages.add: needs a name and a draw function, got ${JSON.stringify(name)}`)
        return
      }
      const before = place?.before
      const after = place?.after
      const anchor = before !== undefined ? before : after
      const stage = byName.get(anchor)
      if (!stage) { refuse('add', anchor); return }
      removePlaced(name)
      const list = before !== undefined ? stage.before : stage.after
      const entry = { name, draw }
      list.push(entry)
      placed.set(name, { list, entry })
      publish()
    },

    /** Take the draw added under this name out of the frame. */
    remove(name) {
      if (!placed.has(name)) return
      removePlaced(name)
      graph.remove(name)
    },

    /** Draw this stage with a plugin's own draw instead of the core's. */
    replace(name, draw) {
      const anchor = alias[name]
      if (!anchor) { refuse('replace', name); return }
      if (typeof draw !== 'function') {
        reportOnce(`[render] stages.replace: needs a draw function for "${name}", got ${JSON.stringify(draw)}`)
        return
      }
      graph.replace(anchor, { execute: draw })
    },

    /** Run no core draw at this stage. Any draws around it still run. */
    skip(name) {
      const anchor = alias[name]
      if (!anchor) { refuse('skip', name); return }
      graph.disable(anchor)
    },

    /** Put the core draw back at this stage. */
    restore(name) {
      const anchor = alias[name]
      if (!anchor) { refuse('restore', name); return }
      if (coreDraws[name]) graph.replace(anchor, { execute: coreDraws[name] })
      graph.enable(anchor)
    }
  }

  state.stages = stagesApi
}
