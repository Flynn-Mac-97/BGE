/** Eight effect handlers form the shared vocabulary for items, spells and statuses. */
import { entityOf, sameReference } from './targets.js'
import { amountOf } from './values.js'

const requireActor = target => { if (target.kind !== 'actor') throw new TypeError('Health and guard effects require an actor target') }
const stackRules = { add: (before, amount) => before + amount, replace: (before, amount) => amount, max: Math.max }
const result = (effect, target, amount, extra = {}) => ({ type: effect.type, target, amount, ...extra })

export const effectHandlers = {
  damage(frame, effect, target, amount) {
    requireActor(target)
    const entity = entityOf(frame.state, target)
    const blocked = effect.bypassGuard ? 0 : Math.min(entity.guard, amount)
    entity.guard -= blocked
    const dealt = Math.min(entity.health, amount - blocked)
    entity.health -= dealt
    const report = result(effect, target, dealt, { blocked })
    if (dealt > 0) {
      frame.events.push({ kind: 'damageDealt', source: frame.source, target, amount: dealt })
      frame.events.push({ kind: 'damageTaken', source: frame.source, target, amount: dealt })
    }
    return report
  },
  heal(frame, effect, target, amount) {
    requireActor(target)
    const entity = entityOf(frame.state, target)
    const restored = Math.min(entity.maxHealth - entity.health, amount)
    entity.health += restored
    return result(effect, target, restored)
  },
  guard(frame, effect, target, amount) {
    requireActor(target)
    entityOf(frame.state, target).guard += amount
    return result(effect, target, amount)
  },
  applyStatus(frame, effect, target, amount) {
    const entity = entityOf(frame.state, target)
    if (!amount) return result(effect, target, 0, { status: effect.status })
    const definition = frame.catalog.statuses[effect.status]
    const before = entity.statuses[effect.status]?.stacks ?? 0
    const stacks = Math.min(definition.maxStacks ?? Number.MAX_SAFE_INTEGER, stackRules[definition.stacking ?? 'add'](before, amount))
    entity.statuses[effect.status] = { stacks, duration: effect.duration ?? definition.duration ?? 'combat', expires: effect.expires ?? definition.expires ?? null, source: frame.source }
    frame.events.push({ kind: 'statusApplied', source: frame.source, target, status: effect.status, amount: stacks - before })
    return result(effect, target, stacks - before, { status: effect.status })
  },
  removeStatus(frame, effect, target, amount) {
    const entity = entityOf(frame.state, target)
    const before = entity.statuses[effect.status]?.stacks ?? 0
    const removed = Math.min(before, amount)
    if (removed === before) delete entity.statuses[effect.status]
    else entity.statuses[effect.status].stacks -= removed
    return result(effect, target, removed, { status: effect.status })
  },
  modifyStat(frame, effect, target, amount) {
    const entity = entityOf(frame.state, target)
    const duration = effect.duration ?? 'instant'
    if (duration === 'instant') entity.stats[effect.stat] = (entity.stats[effect.stat] ?? 0) + amount
    else {
      entity.modifiers = entity.modifiers.filter(modifier => !(modifier.stat === effect.stat && sameReference(modifier.source, frame.source) && modifier.ability === frame.ability.id))
      entity.modifiers.push({ stat: effect.stat, amount, duration, expires: effect.expires ?? null, source: frame.source, ability: frame.ability.id })
    }
    return result(effect, target, amount, { stat: effect.stat })
  },
  resource(frame, effect, target, amount) {
    const entity = entityOf(frame.state, target)
    const before = entity.resources[effect.resource] ?? 0
    if (before + amount < 0) throw new RangeError('Insufficient resource; use an ability cost for conditional spending')
    entity.resources[effect.resource] = Math.min(entity.resourceCaps[effect.resource] ?? Number.MAX_SAFE_INTEGER, before + amount)
    return result(effect, target, entity.resources[effect.resource] - before, { resource: effect.resource })
  },
  triggerItem(frame, effect, target) {
    if (target.kind !== 'item') throw new TypeError('triggerItem requires an item target')
    frame.extra.push({ kind: 'activation', subject: target, path: frame.path, extra: true })
    return result(effect, target, 1)
  }
}

/** Amounts are evaluated once per effect/target against the current source state. */
export function applyEffect(frame, effect, target) {
  const amount = effect.type === 'triggerItem' ? 0 : amountOf(frame, effect.amount)
  if (!Number.isFinite(amount) || (amount < 0 && !['modifyStat', 'resource'].includes(effect.type))) throw new RangeError('Invalid resolved effect amount')
  return effectHandlers[effect.type](frame, effect, target, amount)
}
