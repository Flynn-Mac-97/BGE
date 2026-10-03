/** Small numeric operations compose with the same targeting, timing and effect sequence. */
import { entityOf, definitionOf, targets, sameReference } from './targets.js'
import { preparedStates } from './prepared.js'

/** Transfer conserves resources and respects destination capacity; consuming exposes actual removed stacks. */
export const extendedEffects = {
  removeGuard(frame, effect, target, amount) {
    if (target.kind !== 'actor') throw new TypeError('Guard requires actor target')
    const entity = entityOf(frame.state, target), removed = Math.min(entity.guard, amount)
    entity.guard -= removed
    return { type: effect.type, target, amount: removed }
  },
  consumeStatus(frame, effect, target, amount) {
    const entity = entityOf(frame.state, target), status = entity.statuses[effect.status]
    const removed = Math.min(status?.stacks ?? 0, amount)
    if (status) {
      status.stacks -= removed
      if (!status.stacks) {
        delete entity.statuses[effect.status]
        const prepared = preparedStates.get(frame.state)
        if (prepared) prepared.statusListeners = null
      }
    }
    return { type: effect.type, target, amount: removed, status: effect.status }
  },
  transferResource(frame, effect, target, amount) {
    const selected = targets(frame, effect.from)
    if (selected.length !== 1) throw new TypeError('Resource transfer requires exactly one source')
    const source = selected[0], donor = entityOf(frame.state, source), recipient = entityOf(frame.state, target)
    const before = recipient.resources[effect.resource] ?? 0
    const moved = sameReference(source, target) ? 0 : Math.min(amount, donor.resources[effect.resource] ?? 0, (recipient.resourceCaps[effect.resource] ?? Infinity) - before)
    donor.resources[effect.resource] = (donor.resources[effect.resource] ?? 0) - moved
    recipient.resources[effect.resource] = before + moved
    return { type: effect.type, source, target, amount: moved, resource: effect.resource }
  },
  modifyCharges(frame, effect, target, amount) {
    const entity = entityOf(frame.state, target)
    const ability = definitionOf(frame.state, frame.catalog, target).abilities.find(entry => entry.id === effect.ability)
    if (!ability?.limit?.charges) throw new TypeError('Charge modification requires a charged intrinsic ability')
    const identity = 'item:' + ability.id, limit = ability.limit
    const use = entity.uses[identity] ??= { cycle: frame.state.cycle, cycleCount: 0, combatCount: 0, charges: limit.charges }
    if (use.cycle !== frame.state.cycle) {
      use.cycle = frame.state.cycle; use.cycleCount = 0
      if (limit.refill === 'cycle') use.charges = limit.charges
    }
    const before = use.charges
    use.charges = Math.max(0, Math.min(limit.charges, before + amount))
    return { type: effect.type, target, amount: use.charges - before, ability: effect.ability }
  }
}
