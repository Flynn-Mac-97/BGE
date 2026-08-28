/**
 * Behaviours — attach and detach, from the editor or from a terminal.
 *
 * The runtime half of this lives in the kernel, because the world is what runs
 * hooks. What is here is only the verbs: the things a person clicks and an
 * agent types, sharing one implementation so they cannot drift.
 *
 * A behaviour is a file shaped like a type with no art:
 *
 *   // project/behaviours/float.js
 *   export default {
 *     about: 'bob up and down around where it started',
 *     properties: { speed: 2, amplitude: 0.3 },
 *     start(e, context, self)     { self.base = e.y },
 *     update(e, seconds, context, self) {
 *       e.y = self.base + Math.sin(context.time * self.speed) * self.amplitude
 *     }
 *   }
 *
 * `self` is the behaviour's own bag on the entity — its properties to start with,
 * and whatever running state it puts there. It is also reachable as `e.float`,
 * which is how the inspector shows it and how other code reads it. Passing it
 * in means the file never has to name itself.
 */
export default {
  name: 'Behaviours',

  commands: [
    {
      id: 'behaviour.attach',
      label: 'Attach a behaviour to an entity',
      // args: ['crate-1', 'float'] or ['crate-1', 'float', { speed: 4 }]
      run: (context, args) => {
        const [id, name, properties] = [].concat(args)
        return change(context, id, e => {
          context.world.attach(e, name, properties || {})
          return { id: e.id, attached: name }
        })
      }
    },
    {
      id: 'behaviour.detach',
      label: 'Take a behaviour off an entity',
      run: (context, args) => {
        const [id, name] = [].concat(args)
        return change(context, id, e => {
          if (!context.world.detach(e, name)) throw new Error(`${e.id} has no "${name}"`)
          return { id: e.id, detached: name }
        })
      }
    },
    {
      id: 'behaviour.list',
      label: 'Every behaviour, what it holds, and who attaches it',
      run: context => context.behaviours().map(b => ({
        name: b.name,
        about: b.about,
        properties: b.properties,
        hooks: b.hooks,
        usedBy: b.usedBy,
        error: b.error
      }))
    }
  ]
}

/**
 * Look the entity up, do the thing, write the level.
 *
 * The simulated guard is the same one placing an entity uses: a level records
 * starting state, so an attachment made mid-run would be thrown away by the
 * next stop without ever saying so.
 */
function change(context, id, fn) {
  const e = context.world.byId(id)
  if (!e) throw new Error(`no entity "${id}"`)

  if (context.world.simulated) {
    console.warn('[behaviour] the world has been simulated — stop first, or the change is lost')
    return { skipped: 'simulated' }
  }

  const out = fn(e)
  context.save()
  context.redraw()
  return out
}
