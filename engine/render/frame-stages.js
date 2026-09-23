/**
 * Kernel: the named, ordered stages one frame runs through.
 *
 * The frame has a fixed shape — the world, the post chain, the viewmodel — and
 * this module is the only place that shape is written down. A plugin may draw
 * before or after a named stage, and may replace or skip the core draw at one,
 * so a plugin that renders the scene its own way takes the world over and the
 * core does not draw underneath it.
 *
 * The three core stages are `world`, `post` and `viewmodel`, in that order. A
 * plugin's own draw takes the frame as its one argument: the camera, the target
 * it draws into, and the viewport size.
 *
 * Nothing registered costs one length check either side of each core draw: no
 * allocation, no closure, and no walk over plugin data the core does not own. A
 * replacement draw is called directly, never wrapped or timed, because the
 * picture it makes is the plugin's business.
 */
import { reportOnce } from './report.js'

export function makeFrameStages(state, coreStages) {
  // One entry per stage, made once and never reallocated. `core` is kept so a
  // replacement can be undone; `run` is what the frame actually calls.
  const stages = coreStages.map(core => ({
    name: core.name,
    core: core.draw,
    run: core.draw,
    before: [],
    after: []
  }))
  const byName = new Map(stages.map(stage => [stage.name, stage]))

  // Where each plugin draw went, so `remove` can take it out and a second
  // `add` under one name replaces the first.
  const placed = new Map()

  /** Drop the draw added under this name, if there is one. */
  function removePlaced(name) {
    const placement = placed.get(name)
    if (!placement) return
    const at = placement.list.indexOf(placement.entry)
    if (at !== -1) placement.list.splice(at, 1)
    placed.delete(name)
  }

  /** Say why a draw was refused. */
  function refuse(what, name) {
    reportOnce(`[render] stages.${what}: no stage called ${JSON.stringify(name)} — one of ${[...byName.keys()].join(', ')}`)
  }

  const stagesApi = {
    /** The core stage names, in the order the frame runs them. */
    get names() { return stages.map(stage => stage.name) },

    /**
     * Add a draw before or after a named stage.
     *
     * `place` is `{ before: 'world' }` or `{ after: 'viewmodel' }`. Draws at
     * one place run in the order they were added. Adding a name again moves
     * that draw rather than running it twice.
     */
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
    },

    /** Take the draw added under this name out of the frame. */
    remove(name) { removePlaced(name) },

    /**
     * Draw this stage with a plugin's own draw instead of the core's.
     *
     * The draw is called as `draw(frame)`. The core draw is kept, so `restore`
     * brings it back and a plugin that removes itself changes nothing.
     */
    replace(name, draw) {
      const stage = byName.get(name)
      if (!stage) { refuse('replace', name); return }
      if (typeof draw !== 'function') {
        reportOnce(`[render] stages.replace: needs a draw function for "${name}", got ${JSON.stringify(draw)}`)
        return
      }
      stage.run = draw
    },

    /** Run no core draw at this stage. Any draws around it still run. */
    skip(name) {
      const stage = byName.get(name)
      if (!stage) { refuse('skip', name); return }
      stage.run = null
    },

    /** Put the core draw back at this stage. */
    restore(name) {
      const stage = byName.get(name)
      if (!stage) { refuse('restore', name); return }
      stage.run = stage.core
    }
  }

  /** Run one list of plugin draws, in the order they were added. */
  function runList(list, frame) {
    for (let i = 0; i < list.length; i++) list[i].draw(frame)
  }

  /**
   * Run one frame's stages in order.
   *
   * The walk reads only its own lists. A stage with nothing before it and
   * nothing after it pays one length check either side of its core draw.
   */
  function runStages(frame) {
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i]
      if (stage.before.length) runList(stage.before, frame)
      if (stage.run) stage.run(frame)
      if (stage.after.length) runList(stage.after, frame)
    }
  }

  state.stages = stagesApi
  state.runStages = runStages
}
