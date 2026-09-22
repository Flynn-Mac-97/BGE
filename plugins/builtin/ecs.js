/**
 * ECS — the external entity-component-system as an opt-in service.
 *
 * The engine's entity model is a flat record plus a behaviour hook. This plugin
 * adds a second, separate model beside it: numeric handles, component values in
 * per-type stores, and systems run as an explicit ordered array. Nothing here
 * touches `world.entities`; the bridge between the two models is a later step
 * and belongs to the game that needs it.
 *
 * The plugin owns one ECS world per engine world, and runs that world's
 * schedule on the engine's fixed step. The `seconds` the engine hands every
 * fixed system is the only delta, so an ECS component moves by the same clock
 * an engine entity does and a headless `simulate` repeats.
 *
 * `./ecs/` is upstream source kept verbatim. Edit the library upstream and copy
 * it again; an edit here is invisible to the library's own tests.
 */
import { createWorld, defineComponent, defineSystem, runSchedule } from './ecs/index.js'

export default {
  name: 'ECS',
  category: 'engine',
  about: 'A second entity model: components, queries and ordered systems.',

  lifecycle: 'scoped',
  provides: ['ecs'],

  onLoad(context, scope) {
    const world = createWorld()
    const systems = []
    // Held so a checkpoint can enumerate what the world contains. The library
    // keeps values in per-token stores with no way to list the tokens, so the
    // plugin records every token it hands out.
    const componentTypes = []

    const define = name => {
      const type = defineComponent(name)
      componentTypes.push(type)
      return type
    }

    // Bound, because the world's methods read private fields through `this`.
    // A consumer that destructured one off the object would lose `this` and the
    // call would throw.
    const ecs = {
      defineComponent: define,
      defineSystem,
      runSchedule,
      // The schedule is the array; order in it is execution order.
      systems,
      world,

      createEntity: () => world.createEntity(),
      destroyEntity: entity => world.destroyEntity(entity),
      isAlive: entity => world.isAlive(entity),
      addComponent: (entity, type, value) => world.addComponent(entity, type, value),
      getComponent: (entity, type) => world.getComponent(entity, type),
      hasComponent: (entity, type) => world.hasComponent(entity, type),
      removeComponent: (entity, type) => world.removeComponent(entity, type),
      query: types => world.query(types),
      get liveEntityCount() { return world.liveEntityCount }
    }

    context.ecs = ecs
    scope.provide('ecs', ecs)
    scope.defer(() => { if (context.ecs === ecs) delete context.ecs })

    // A rewind carries the ECS world with the engine world. An empty world holds
    // nothing and is left out of the moment, the way a solver that has not
    // stepped is.
    context.checkpoints?.add('ECS', {
      capture: () => writeWorld(world, componentTypes),
      restore: moment => { readWorld(world, componentTypes, moment); return true }
    })
  },

  systems: [{
    id: 'ecs.step',
    phase: 'fixed',
    run(engineWorld, seconds, context) {
      const ecs = context.ecs
      if (ecs) runSchedule(ecs.systems, ecs.world, { deltaSeconds: seconds })
    }
  }]
}

/**
 * Write the ECS world down as plain data, or null when it holds no entity.
 *
 * Component values are arbitrary, so each is deep-copied. A value that cannot
 * be copied throws, and the checkpoint registry names it among what the moment
 * could not carry, rather than storing a live reference a later step mutates.
 */
function writeWorld(world, componentTypes) {
  const entities = world.query([])
  if (!entities.length) return null
  const values = []
  for (const entity of entities) {
    for (let index = 0; index < componentTypes.length; index++) {
      if (!world.hasComponent(entity, componentTypes[index])) continue
      values.push([entity, index, structuredClone(world.getComponent(entity, componentTypes[index]))])
    }
  }
  return { entities, values }
}

/**
 * Put the ECS world back to a written moment.
 *
 * Entity handles are not carried: the library exposes no way to set a slot's
 * generation, so a rebuilt entity takes the next free slot. A step-one system
 * reads its handles from a query each step and keeps none, so the difference
 * does not reach behavior yet. A game that stores a handle across a rewind must
 * read it again after the rewind.
 */
function readWorld(world, componentTypes, moment) {
  for (const entity of world.query([])) world.destroyEntity(entity)
  if (!moment) return
  const rebuilt = new Map()
  for (const entity of moment.entities) rebuilt.set(entity, world.createEntity())
  for (const [entity, index, value] of moment.values) {
    world.addComponent(rebuilt.get(entity), componentTypes[index], structuredClone(value))
  }
}
