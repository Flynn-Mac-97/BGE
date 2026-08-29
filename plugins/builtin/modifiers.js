/**
 * Modifiers — stat changes that stack, and can be taken back off.
 *
 * "+10% move speed" is easy once and a mess the fifth time. Written the obvious
 * way — `entity.properties.speed *= 1.1` — the original number is gone, the
 * order of the picks changes the answer, and nothing can ever be removed. This
 * keeps the base value, keeps every change by the name of whatever asked for
 * it, and recomputes from scratch:
 *
 *   value = (base + every add) * every scale
 *
 * Adds before scales, always, so "+1 armour" and "+10% armour" mean the same
 * thing whichever order they were taken in. That is the property that lets an
 * upgrade screen offer them in any order at all.
 *
 *   context.modifiers.add(entity, 'wings', { speed: '+10%', pickupRadius: 0.5 })
 *   context.modifiers.remove(entity, 'wings')
 *
 * A plain number is an add. A percentage is a scale. Anything more exact is
 * written out: `{ add: 2 }`, `{ scale: 1.25 }`.
 */

export default {
  name: 'Modifiers',
  about: 'Stack named stat changes onto an entity and recompute its properties from the base values.',
  inspect: context => {
    const rows = []
    for (const entity of context.world.entities) {
      for (const [source, changes] of Object.entries(entity.statModifiers?.sources || {})) {
        rows.push([`${entity.id} · ${source}`, Object.keys(changes).join(', ')])
      }
    }
    return rows.length ? [{ title: 'Applied', rows }] : []
  },

  onLoad(context) {
    /** The bag, made once per entity and never handed out to be written directly. */
    const bagOf = entity => (entity.statModifiers ||= { base: {}, sources: {} })

    /** One change, in whatever shape it was written. */
    function asChange(value) {
      if (typeof value === 'number') return { add: value, scale: 1 }
      if (typeof value === 'string') {
        const percent = value.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*%$/)
        if (percent) return { add: 0, scale: 1 + Number(percent[1]) / 100 }
        return { add: Number(value) || 0, scale: 1 }
      }
      return { add: Number(value?.add) || 0, scale: Number(value?.scale ?? 1) }
    }

    /**
     * Put every key back to base and lay the stack on again.
     *
     * From scratch rather than incrementally: an incremental version drifts the
     * moment one source is removed, and the symptom is a stat that is slightly
     * wrong after a long run — which nobody ever traces back to here.
     */
    function recompute(entity) {
      const bag = bagOf(entity)
      const touched = new Set()
      for (const changes of Object.values(bag.sources)) for (const key of Object.keys(changes)) touched.add(key)

      for (const key of Object.keys(bag.base)) {
        // A key nobody changes any more goes back to what it was, exactly.
        if (!touched.has(key)) { entity.properties[key] = bag.base[key]; delete bag.base[key] }
      }

      for (const key of touched) {
        if (!(key in bag.base)) bag.base[key] = Number(entity.properties[key]) || 0
        let add = 0
        let scale = 1
        for (const changes of Object.values(bag.sources)) {
          if (!(key in changes)) continue
          const change = asChange(changes[key])
          add += change.add
          scale *= change.scale
        }
        entity.properties[key] = (bag.base[key] + add) * scale
      }
      context.bus.emit('modifiers:changed', { entity })
      return entity.properties
    }

    context.modifiers = {
      /**
       * Apply a named set of changes. The same name twice replaces rather than
       * stacks — a source is one thing, and an upgrade taken to rank three is
       * still one source with bigger numbers.
       */
      add(entity, source, changes) {
        if (!entity) return null
        bagOf(entity).sources[source] = { ...changes }
        return recompute(entity)
      },

      remove(entity, source) {
        if (!entity?.statModifiers) return null
        delete entity.statModifiers.sources[source]
        return recompute(entity)
      },

      clear(entity) {
        if (!entity?.statModifiers) return null
        entity.statModifiers.sources = {}
        return recompute(entity)
      },

      recompute,

      /** What this stat was before anything touched it. */
      base: (entity, key) => entity?.statModifiers?.base?.[key] ?? entity?.properties?.[key],

      list: entity => ({ ...(entity?.statModifiers?.sources || {}) }),

      /** Every source, as one flat list — what a HUD shows as "what you carry". */
      sources: entity => Object.keys(entity?.statModifiers?.sources || {})
    }

    // Reloading a type rebuilds `properties` from the file, which would quietly
    // put every modified stat back to its authored value mid-run. Lay the stack
    // on again — and forget the old bases, which were read from the old file.
    context.bus.on('type:changed', () => {
      for (const entity of context.world.entities) {
        if (!entity.statModifiers) continue
        entity.statModifiers.base = {}
        recompute(entity)
      }
    })
  },

  commands: [{
    id: 'modifiers.list',
    label: 'What is changing an entity\'s stats',
    run: (context, args) => {
      const entity = context.world.byId([].concat(args ?? [])[0])
      if (!entity) return { ok: false, reason: 'name an entity' }
      return { id: entity.id, base: entity.statModifiers?.base || {}, sources: context.modifiers.list(entity) }
    }
  }]
}
