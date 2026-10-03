/** Planning hints describe geometry and normal scan order, not guaranteed combat outcomes. */
import { rules, itemDefinition, itemReference } from './rules.js'
import { placedItems } from '../grid-game/grid.js'
const eventLabels = { combatStart: 'combat start', ownTurn: 'its turn', cycleStart: 'cycle start', cycleEnd: 'cycle end', itemActivated: 'item activation', damageDealt: 'damage dealt', damageTaken: 'damage taken', statusApplied: 'a status being applied' }

/** Passive listeners and auras have no scheduled turn; they are active from cycle start. */
export function activationOrder(battle) {
  return Object.fromEntries(placedItems(battle).filter(item => itemDefinition(battle, item.id).abilities.some(ability => ability.trigger.event === 'ownTurn')).map((item, index) => [item.id, index + 1]))
}
function preparation(effect) {
  const status = rules.catalog.statuses[effect.status]
  return (effect.duration ?? status?.duration) === 'nextAction' && (effect.expires ?? status?.expires) === 'cycle'
}
function eligibleItems(battle, id, selector) {
  return rules.targets(battle, itemReference(id), selector).filter(target => target.kind === 'item' && target.id !== id)
}

/** Relations preserve their direction: producer → recipient, or watched item → listener. */
export function connectionPreview(battle, selected) {
  const order = activationOrder(battle)
  const links = [], warnings = []
  if (!battle.items[selected]?.position) return { order, links, warnings }
  const append = (source, target, kind, text) => {
    if (![source, target].includes(selected)) return
    const key = `${source}:${target}:${kind}`
    if (!links.some(link => link.key === key)) links.push({ key, source, target, kind, text })
  }
  for (const item of placedItems(battle)) {
    const definition = itemDefinition(battle, item.id)
    for (const ability of definition.abilities) {
      const targets = eligibleItems(battle, item.id, ability.target)
      if (item.id === selected && ability.target.kind === 'directionalNeighbour' && !targets.length) {
        const noun = ability.target.tags?.includes('weapon') ? 'weapon' : 'eligible item'
        const side = { right: 'to the right', left: 'to the left', up: 'above', down: 'below' }[ability.target.direction]
        warnings.push(`No ${noun} ${side}.`)
      }
      for (const target of targets) {
        const targetName = itemDefinition(battle, target.id).name
        const isPreparation = ability.trigger.event === 'ownTurn' && ability.effects.some(preparation)
        const isLate = isPreparation && order[target.id] !== undefined && order[target.id] < order[item.id]
        const kind = isLate ? 'late' : 'target'
        const text = isLate ? `${targetName} acts before ${definition.name}. Preparation expires unless an extra action uses it this cycle.`
          : isPreparation ? `Prepares ${targetName} before its normal turn; still subject to costs and limits.`
          : ability.effects.some(effect => effect.type === 'triggerItem') ? `Can give ${targetName} an extra action; check remaining uses.` : `Targets ${targetName}; check conditions and limits.`
        append(item.id, target.id, kind, text)
        if (isLate && [item.id, target.id].includes(selected)) warnings.push(item.id === selected ? `Too late: ${targetName} acts first.` : `Late preparation from ${definition.name}.`)
      }
      if (ability.trigger.source) {
        for (const source of eligibleItems(battle, item.id, ability.trigger.source)) append(source.id, item.id, 'reaction', `Listens for ${ability.trigger.status ? rules.catalog.statuses[ability.trigger.status].name + ' applied' : eventLabels[ability.trigger.event]}. Scan position does not delay this listener; the event must happen.`)
      }
    }
    for (const grant of definition.grants) for (const target of eligibleItems(battle, item.id, grant.target)) append(item.id, target.id, 'grant', `Grants ${grant.abilities.map(ability => ability.id).join(', ')} while connected. Each recipient has independent limits.`)
    for (const aura of definition.auras) {
      for (const target of eligibleItems(battle, item.id, aura.target)) append(item.id, target.id, 'aura', `While adjacent: ${aura.amount >= 0 ? '+' : ''}${aura.amount} ${aura.stat}. Scan order does not matter.`)
    }
  }
  return { order, links, warnings: [...new Set(warnings)] }
}
