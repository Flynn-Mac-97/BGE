/**
 * A scoped plugin a core test adds to a world, so a checkpoint and a rewind can
 * be tested against a plugin's own state without a plugin file anywhere.
 *
 * It counts fixed steps and holds the entities it owns, moving an owned entity by
 * its count each step. It hands the count and the membership to
 * `context.checkpoints`, so a moment that loses either one loses the motion — which
 * is what a test notices. It resets on `level:loaded`, because the entities it held
 * belong to the level that ended.
 *
 * A test adds it with `context.loader.add(stepCounterPlugin)`. One definition is
 * shared; `onLoad` builds the state, so every world gets its own.
 */
export const stepCounterPlugin = {
  name: 'Step Counter',
  lifecycle: 'scoped',
  provides: ['stepCounter'],

  onLoad(context, scope) {
    const state = { steps: 0, held: [], restores: 0 }

    const counter = {
      get steps() { return state.steps },
      get held() { return [...state.held] },
      get restores() { return state.restores },
      step(world) {
        state.steps += 1
        for (const entity of world.entities) {
          if (entity.properties?.held !== true) continue
          if (!state.held.includes(entity.id)) state.held.push(entity.id)
          entity.y -= 0.001 * state.steps
        }
      }
    }

    context.stepCounter = counter
    scope.provide('stepCounter', counter)
    scope.defer(() => { if (context.stepCounter === counter) delete context.stepCounter })

    context.checkpoints.add('Step Counter', {
      capture: () => ({ steps: state.steps, held: [...state.held] }),
      restore: held => {
        state.restores += 1
        state.steps = held ? held.steps : 0
        state.held = held ? [...held.held] : []
        return true
      }
    })

    // A level load replaces every entity, so the membership of the world that
    // ended goes with it.
    scope.on('level:loaded', () => { state.steps = 0; state.held = [] })
  },

  systems: [{
    id: 'stepCounter.step',
    phase: 'fixed',
    run(world, seconds, context) {
      context.stepCounter?.step(world)
    }
  }]
}
