/** Inspection derives connections from the same selectors that combat resolves. */
import { rules, itemDefinition, itemReference } from './rules.js'
export const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

export function itemLinks(battle, selected) {
  const links = []
  for (const item of Object.values(battle.items)) {
    if (!item.position) continue
    const definition = itemDefinition(battle, item.id)
    const selectors = [...definition.abilities.flatMap(ability => [ability.target, ability.trigger.source].filter(Boolean)), ...definition.auras.map(aura => aura.target), ...definition.grants.map(grant => grant.target)]
    for (const selector of selectors) {
      for (const target of rules.targets(battle, itemReference(item.id), selector)) {
        if (target.kind !== 'item' || item.id === target.id || ![item.id, target.id].includes(selected)) continue
        const other = item.id === selected ? target.id : item.id
        if (!links.some(link => link.id === other)) links.push({ id: other, name: itemDefinition(battle, other).name })
      }
    }
  }
  return links
}

export function inspectItem(battle, id) {
  const item = battle.items[id]
  const definition = itemDefinition(battle, id)
  const statuses = Object.entries(item.statuses).map(([type, status]) => `${rules.catalog.statuses[type].name}: ${status.stacks}`)
  const modifiers = item.modifiers.map(modifier => `${modifier.amount > 0 ? '+' : ''}${modifier.amount} ${modifier.stat} · ${modifier.duration}`)
  const abilities = definition.abilities.map(ability => {
    const uses = item.uses['item:' + ability.id]
    const remaining = ability.limit?.perCombat === undefined ? null : Math.max(0, ability.limit.perCombat - (uses?.combatCount ?? 0))
    return `${ability.id} · ${ability.trigger.event}${remaining === null ? '' : ` · ${remaining} use(s) left this combat`}`
  })
  for (const grant of definition.grants) for (const ability of grant.abilities) abilities.push(`Grants ${ability.id} · ${ability.trigger.event} · per linked item`)
  return { item, definition, links: item.position ? itemLinks(battle, id) : [], bonuses: [...statuses, ...modifiers], abilities,
    damage: definition.tags.includes('weapon') ? rules.stat(battle, itemReference(id), 'damage') : null,
    poison: rules.stat(battle, itemReference(id), 'poisonOnHit'),
    status: definition.storage ? item.position ? 'Attached' : 'In reserve' : item.position ? battle.acted.includes(id) ? 'Already acted' : 'Equipped' : 'In reserve' }
}
