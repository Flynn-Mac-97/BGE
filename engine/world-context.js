/**
 * Kernel: the surface a plugin reads and drives the project through.
 *
 * `context` carries the kernel itself — the world, the loop, the loader — set by
 * `start-world.js`, and the commands a plugin calls, set here. One pass so the
 * key list and its order are one thing, because a plugin may replace a key it
 * did not own and the loader names the owner from this order.
 */
import { makeProjector } from './camera-project.js'

/**
 * Add the project commands and the two live readings to a world's context.
 *
 * @param {object} context The world's context, already carrying the kernel.
 * @param {object} parts
 * @param {object} parts.world The entity store.
 * @param {object} parts.bus The event channel.
 * @param {object} parts.editor What the editor holds and can open.
 * @param {object} parts.loop The clock, for the random stream and the timers.
 * @param {Function} parts.importProjectFile `async (file) =>` a project module.
 * @param {Function} parts.saveLevel The save command, as a plugin receives it.
 * @returns {void}
 */
export function attachWorldSurface(context, { world, bus, editor, loop, importProjectFile, saveLevel }) {
  // context surface plugins actually use — mirrors the game-side context on purpose
  Object.assign(context, {
    /**
     * The project's assets, optionally filtered by kind.
     *
     * @param {string} [kind] Keep only assets of this kind.
     * @returns {object[]} One `{ name, ...entry }` per matching asset.
     */
    assets: kind =>
      Object.entries(editor.index.assets)
        .filter(([, a]) => !kind || a.kind === kind)
        .map(([name, a]) => ({ name, ...a })),
    /**
     * The project's types, each with its name.
     *
     * @returns {object[]} One `{ name, ...entry }` per type.
     */
    types: () => Object.entries(editor.index.types).map(([name, t]) => ({ name, ...t })),
    /**
     * The project's behaviours, each with its name.
     *
     * @returns {object[]} One `{ name, ...entry }` per behaviour.
     */
    behaviours: () => Object.entries(editor.index.behaviours || {}).map(([name, b]) => ({ name, ...b })),
    /**
     * The project's levels, each with its name.
     *
     * @returns {object[]} One `{ name, ...entry }` per level.
     */
    levels: () => Object.entries(editor.index.levels).map(([name, l]) => ({ name, ...l })),
    level: () => editor.levelName,
    select: (x, additive) => editor.select(x, additive),
    /**
     * Ask the editor to open a file.
     *
     * @param {string|object} file A file path, or an entry with a `file` path.
     * @returns {void}
     */
    open: file => bus.emit('open:file', typeof file === 'string' ? file : file.file),
    /**
     * Add an entity to the world and announce it.
     *
     * @param {string} t The type name.
     * @param {object} [p] The placement.
     * @returns {object} The spawned entity.
     */
    spawn: (t, p) => {
      const e = world.spawn(t, p)
      bus.emit('world:changed')
      return e
    },
    /**
     * Remove an entity from the world and announce it.
     *
     * @param {object} e The entity to remove.
     * @returns {void}
     */
    destroy: e => {
      world.destroy(e)
      bus.emit('world:changed')
    },
    run: (id, args) => context.engine.run(id, args),
    save: saveLevel,
    // One place that knows how to import a file out of the project, because the
    // browser imports it by URL and node imports it by path. Types, behaviours
    // and tests all go through this rather than each inventing a way.
    importProjectFile,
    // A world with no shell has nothing to redraw, and that is not an error.
    /**
     * Ask the shell to redraw, when the world has a shell.
     *
     * @returns {void}
     */
    redraw: () => context.shell?.draw(),

    // Where a world point lands on screen, the same answer the renderer draws
    // by. Offered here because a project is a directory anywhere on disk, so
    // game code cannot reach an engine module by a relative path.
    /**
     * A projector for the current view and viewport.
     *
     * @returns {object} The projector.
     */
    projector: () => makeProjector(context.view, context.viewport),

    // The deterministic runtime. Game code uses these instead of the wall clock,
    // Math.random and setTimeout — which is what makes simulate() repeatable.
    random: loop.random,
    // For anything that only draws. Kept apart from `random` so a change to an
    // effect cannot move where an enemy spawns.
    drawing: loop.drawing,
    after: (seconds, fn) => loop.after(seconds, fn),
    every: (seconds, fn) => loop.every(seconds, fn),
    cancel: id => loop.cancel(id)
  })

  // A getter, not a copied number: `context.time` has to read the clock at the
  // moment the hook asks, not the moment context was built.
  Object.defineProperty(context, 'time', { enumerable: true, get: () => loop.time })

  // Object.assign would have invoked this getter once and frozen the result —
  // it has to be defined, not copied, or every plugin reads a stale selection.
  Object.defineProperty(context, 'selection', {
    // enumerable matters: the shell hands panels `{ ...context, state }`, and a
    // non-enumerable property is dropped by spread.
    enumerable: true,
    get: () => [...editor.selection].map(id => world.byId(id)).filter(Boolean)
  })
}
