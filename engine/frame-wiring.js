/**
 * Kernel: wire the world to the clock.
 *
 * `makeLoop` owns the fixed step and the frame tick; this module says what one
 * step and one frame do to the world. The fixed step is the only place time
 * advances, so it is the only place `world.simulated` is set.
 */

/**
 * The four loop callbacks: what one step and one frame do.
 *
 * The loop and the rewind are read through `context`, which carries them once
 * the boot that builds them has finished. A step cannot run before then.
 *
 * @param {object} parts
 * @param {object} parts.world The entity store.
 * @param {object} parts.loader The plugin registry and its compiled schedule.
 * @param {object} parts.context The world's context, which carries the loop.
 * @returns {object} `onError`, `onStepStart`, `onFixed` and `onFrame`.
 */
export function makeFrameWiring({ world, loader, context }) {
  return {
    /**
     * Report a loop error without stopping the loop.
     *
     * @param {Error} error The error the step threw.
     * @returns {void}
     */
    onError(error) {
      console.error('[timer]', error)
    },
    /**
     * Record where every entity is before the step moves it.
     *
     * @returns {void}
     */
    onStepStart() {
      world.rememberPlaces()
      // Before the step, so the mark is the world at the count the clock reads —
      // a mark taken inside a step would be a world that has already moved and a
      // clock that says it has not.
      context.rewind?.observe()
    },
    /**
     * Advance the world by one fixed step: fixed-time systems, then every
     * entity's update.
     *
     * @param {number} seconds The fixed step length in seconds.
     * @returns {void}
     */
    onFixed(seconds) {
      // One flag, set at the only place time advances, so nothing can step the
      // world without marking it — including engine.simulate().
      world.simulated = true
      for (const system of loader.schedule.fixed) {
        if (!loader.plugins.get(system.plugin)?.enabled) continue
        try {
          system.run(world, seconds, context)
        } catch (error) {
          loader.fail(system.plugin, error)
        }
      }
      // world.hook runs the attached behaviours first, then the type's own
      // update — so a type always gets the last word on what it composed. An
      // entity with no behaviours and no update hook has nothing to ask, and at
      // a large entity count asking every one of them is most of the step.
      for (const entity of [...world.entities]) {
        if (!entity.behaviours.length && typeof entity._definition?.update !== 'function') continue
        world.hook(entity, 'update', seconds, context)
      }
    },
    /**
     * Advance one rendered frame: frame-time systems, then draw.
     *
     * @param {number} seconds The frame length in seconds.
     * @returns {void}
     */
    onFrame(seconds) {
      for (const system of loader.schedule.frame) {
        if (!loader.plugins.get(system.plugin)?.enabled) continue
        try {
          system.run(world, seconds, context)
        } catch (error) {
          loader.fail(system.plugin, error)
        }
      }
      // Optional on purpose: a world with no renderer runs the same systems in
      // the same order and simply draws nothing. The world and blend reach the
      // scene pass's extract through the frame record.
      context.renderer?.draw(world, context.loop.blend)
    }
  }
}
