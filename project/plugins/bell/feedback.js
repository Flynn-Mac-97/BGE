/** Rule trace facts drive text and small monochrome feedback, without item-name branches. */
import { rules, itemDefinition } from './rules.js'
import { escape } from './inspection.js'
import { statusText } from './glance.js'
const nameOf = (battle, subject) => subject.kind === 'item' ? itemDefinition(battle, subject.id).name : battle.actors[subject.id].name ?? subject.id
const effectText = {
  damage: effect => `${effect.amount} damage${effect.blocked ? ` (${effect.blocked} blocked)` : ''}`,
  heal: effect => `+${effect.amount} health`, guard: effect => `+${effect.amount} guard`,
  applyStatus: effect => `${effect.amount >= 0 ? '+' : ''}${effect.amount} ${rules.catalog.statuses[effect.status].name}`,
  removeStatus: effect => `remove ${effect.amount} ${rules.catalog.statuses[effect.status].name}`,
  modifyStat: effect => `${effect.amount >= 0 ? '+' : ''}${effect.amount} ${effect.stat}`,
  resource: effect => `${effect.amount >= 0 ? '+' : ''}${effect.amount} ${effect.resource}`,
  removeGuard: effect => `remove ${effect.amount} guard`,
  consumeStatus: effect => `consume ${effect.amount} ${rules.catalog.statuses[effect.status].name}`,
  transferResource: effect => `transfer ${effect.amount} ${effect.resource}`,
  modifyCharges: effect => `${effect.amount >= 0 ? '+' : ''}${effect.amount} charges`,
  triggerItem: () => 'extra action'
}
export function describeStep(step) {
  if (step.kind === 'ability') return `${nameOf(step.state, step.source)} → ${step.effects.filter(effect => effect.amount || effect.blocked).map(effect => `${nameOf(step.state, effect.target)}: ${effectText[effect.type](effect)}`).join(' · ') || 'no change'}`
  const messages = { cycleStart: 'Cycle starts. Equipment activates in grid order.', idle: 'Passive item watches for its trigger.', expired: 'Unused preparation expires.', planning: 'Cycle complete. Rearrange or continue.', combatEnd: step.winner === 'crew' ? 'Victory. Search the remains.' : 'The recruit falls.', blocked: `Extra action stopped: ${step.reason}.`, miss: `No action: ${step.reason}.` }
  return messages[step.kind] ?? step.kind
}
export function equipmentFeedback(item) {
  const charges = Object.entries(item.statuses).map(([id, status]) => `<span class="charge">${escape(statusText(id, status.stacks))}</span>`)
  for (const modifier of item.modifiers) charges.push(`<span class="charge">+${modifier.amount} ${escape(modifier.stat)}</span>`)
  return `<span class="charge-markers">${charges.join('')}</span>`
}
/** Aggregate actual damage by victim so multi-effect abilities never stack unreadable labels. */
export function damageFeedback(step) {
  if (step?.kind !== 'ability') return []
  const victims = new Map()
  for (const effect of step.effects) {
    if (effect.type !== 'damage' || effect.target.kind !== 'actor' || !(effect.amount || effect.blocked)) continue
    const previous = victims.get(effect.target.id) ?? { id: effect.target.id, amount: 0, blocked: 0 }
    previous.amount += effect.amount
    previous.blocked += effect.blocked ?? 0
    victims.set(effect.target.id, previous)
  }
  return [...victims.values()].map(hit => {
    const actor = step.state.actors[hit.id]
    const healed = step.effects.filter(effect => effect.type === 'heal' && effect.target.kind === 'actor' && effect.target.id === hit.id).reduce((total, effect) => total + effect.amount, 0)
    return { ...hit, healed, side: actor.team === 'crew' ? 'incoming' : 'outgoing', label: actor.team === 'crew' ? hit.amount ? 'YOU TAKE DAMAGE' : 'YOU BLOCK' : hit.amount ? 'YOU DEAL DAMAGE' : 'ENEMY BLOCKS', name: actor.name ?? hit.id, before: actor.health + hit.amount - healed, after: actor.health,
      source: step.statusId ? rules.catalog.statuses[step.statusId].name : nameOf(step.state, step.source) }
  })
}

/** Damage gets a readable hold; ordinary bookkeeping keeps its existing short timing. */
// Seconds each kind of step is held, by playback speed. Fast is for testing builds: a floor plays in a few seconds.
const stepSeconds = {
  damage: { slow: 2.2, normal: 1.5, fast: 0.12 },
  // The end of a fight holds long enough to see the faint and read who fell before any reward screen.
  combatEnd: { slow: 1.8, normal: 1.1, fast: 0.3 },
  // A heal, guard or status on a fighter plays a short effect on its portrait, so it gets time to be read.
  fighterEffect: { slow: 1.2, normal: 0.7, fast: 0.06 },
  other: { slow: 0.8, normal: 0.22, fast: 0.02 }
}
/** How long a step is held at a playback speed: 'slow', 'normal' or 'fast'. */
export function stepDuration(step, speed) {
  if (damageFeedback(step).length) return stepSeconds.damage[speed]
  if (step?.kind === 'combatEnd') return stepSeconds.combatEnd[speed]
  if (step?.kind === 'ability' && step.effects.some(effect => effect.target.kind === 'actor' && effect.amount)) return stepSeconds.fighterEffect[speed]
  return stepSeconds.other[speed]
}

export function stageFeedback(state) {
  const hits = damageFeedback(state.step)
  if (hits.length) return `<div class="damage-readout" role="status" data-key="impact:${state.serial}">${hits.map(hit => `<div class="damage-line ${hit.side}"><b class="hit-direction">${hit.label}</b><span>${escape(hit.source)} → ${escape(hit.name)}</span><strong>${hit.amount ? `−${hit.amount} HP` : 'BLOCKED'}</strong><small>HP ${hit.before} → ${hit.after}${hit.blocked ? ` · ${hit.blocked} blocked` : ''}${hit.healed ? ` · +${hit.healed} healed` : ''}</small></div>`).join('')}</div>`
  if (state.step?.kind !== 'ability') return ''
  return state.step.effects.filter(effect => effect.target.kind === 'actor' && (effect.amount || effect.blocked)).map(effect => `<span class="combat-result ${effect.target.id === 'enemy' ? 'attack' : 'react'}" data-key="${effect.type}:${state.serial}">${escape(effectText[effect.type](effect))}</span>`).join('')
}
