/** Rule trace facts drive text and small monochrome feedback, without item-name branches. */
import { rules, itemDefinition } from './rules.js'
import { escape } from './inspection.js'
const nameOf = (battle, subject) => subject.kind === 'item' ? itemDefinition(battle, subject.id).name : battle.actors[subject.id].name ?? subject.id
const effectText = {
  damage: effect => `${effect.amount} damage${effect.blocked ? ` (${effect.blocked} blocked)` : ''}`,
  heal: effect => `+${effect.amount} health`, guard: effect => `+${effect.amount} guard`,
  applyStatus: effect => `${effect.amount >= 0 ? '+' : ''}${effect.amount} ${rules.catalog.statuses[effect.status].name}`,
  removeStatus: effect => `remove ${effect.amount} ${rules.catalog.statuses[effect.status].name}`,
  modifyStat: effect => `${effect.amount >= 0 ? '+' : ''}${effect.amount} ${effect.stat}`,
  resource: effect => `${effect.amount >= 0 ? '+' : ''}${effect.amount} ${effect.resource}`,
  triggerItem: () => 'extra action'
}
export function describeStep(step) {
  if (step.kind === 'ability') return `${nameOf(step.state, step.source)} → ${step.effects.filter(effect => effect.amount || effect.blocked).map(effect => `${nameOf(step.state, effect.target)}: ${effectText[effect.type](effect)}`).join(' · ') || 'no change'}`
  const messages = { cycleStart: 'Cycle starts. Equipment activates in grid order.', idle: 'Passive item watches for its trigger.', expired: 'Unused preparation expires.', planning: 'Cycle complete. Rearrange or continue.', combatEnd: step.winner === 'crew' ? 'Victory. Search the remains.' : 'The recruit falls.', blocked: `Extra action stopped: ${step.reason}.`, miss: `No action: ${step.reason}.` }
  return messages[step.kind] ?? step.kind
}
export function equipmentFeedback(item) {
  const charges = Object.entries(item.statuses).map(([id, status]) => `<span class="charge">${escape(rules.catalog.statuses[id].name)} ${status.stacks}</span>`)
  for (const modifier of item.modifiers) charges.push(`<span class="charge">+${modifier.amount} ${escape(modifier.stat)}</span>`)
  return `<span class="charge-markers">${charges.join('')}</span>`
}
export function stageFeedback(state) {
  if (state.step?.kind !== 'ability') return ''
  return state.step.effects.filter(effect => effect.target.kind === 'actor' && (effect.amount || effect.blocked)).map(effect => `<span class="combat-result ${effect.target.id === 'enemy' ? 'attack' : 'react'}" data-key="${effect.type}:${state.serial}">${escape(effectText[effect.type](effect))}</span>`).join('')
}
