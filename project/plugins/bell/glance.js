/** Short grid labels say what each item does and what feeds what, read live from the same blocks combat resolves. */
import { rules, itemDefinition, itemReference } from './rules.js'
import { consumableGlance } from './descent/consumables.js'
import { footprint } from '../grid-game/grid.js'
import { auraAmount } from '../grid-game/values.js'

const statShort = { damage: 'DMG', potency: 'POT', guard: 'GD', heal: 'HP', poisonOnHit: 'PSN' }
const resourceShort = { hunger: 'HUN', salvage: 'SLV' }
const triggerShort = { combatStart: 'FIGHT', cycleStart: 'START', cycleEnd: 'END', damageTaken: 'HIT', damageDealt: 'ON DMG', itemActivated: 'ON USE', statusApplied: 'ON' }
const arrows = { right: '▶', left: '◀', down: '▼', up: '▲' }
/** A stat's short grid name, such as DMG or POT. */
export const shortStat = stat => statShort[stat] ?? stat.slice(0, 3).toUpperCase()
const shortStatus = id => rules.catalog.statuses[id].short ?? rules.catalog.statuses[id].name.toUpperCase()
const signed = amount => amount < 0 ? `−${-amount}` : `+${amount}`

/** A live amount, and whether placement or a modifier changed it from the item's printed stat. */
function liveAmount(battle, id, expression) {
  if (typeof expression === 'number') return { amount: expression, isBoosted: false }
  if (expression.stat) {
    const amount = rules.stat(battle, itemReference(id), expression.stat)
    return { amount, isBoosted: amount !== (itemDefinition(battle, id).stats?.[expression.stat] ?? 0) }
  }
  // A granted ability's amount reads the granting item, which is the item this glance is for.
  if (expression.grantorStat) return liveAmount(battle, id, { stat: expression.grantorStat })
  if (expression.resource) return { amount: battle.items[id].resources[expression.resource] ?? battle.actors[battle.items[id].owner].resources[expression.resource] ?? 0, isBoosted: false }
  return { amount: null, isBoosted: false }
}

/** A status in grid shorthand; one that only changes stats reads as those changes: Sapped is "−1 DMG", not "1 SAPPED". */
export function statusText(id, amount) {
  const modifiers = rules.catalog.statuses[id].modifiers ?? []
  if (!modifiers.length) return `${amount} ${shortStatus(id)}`
  return modifiers.map(modifier => `${signed(typeof modifier.amount === 'number' ? modifier.amount : amount * (modifier.amount.scale ?? 1))} ${shortStat(modifier.stat)}`).join(' ')
}
const effectText = {
  damage: (effect, amount) => `${amount} DMG`, heal: (effect, amount) => `+${amount} HP`, guard: (effect, amount) => `+${amount} GD`,
  applyStatus: (effect, amount) => statusText(effect.status, amount), removeStatus: (effect, amount) => `−${amount} ${shortStatus(effect.status)}`,
  modifyStat: (effect, amount) => `${signed(amount)} ${shortStat(effect.stat)}`, resource: (effect, amount) => `${signed(amount)} ${resourceShort[effect.resource] ?? effect.resource.toUpperCase()}`,
  removeGuard: (effect, amount) => `−${amount} GD`, consumeStatus: (effect, amount) => `SPEND ${amount} ${shortStatus(effect.status)}`,
  transferResource: (effect, amount) => `MOVE ${amount} ${resourceShort[effect.resource] ?? effect.resource.toUpperCase()}`,
  modifyCharges: (effect, amount) => `${signed(amount)} USES`, triggerItem: () => 'AGAIN'
}

/** One effect as a label part; an effect whose live amount is zero says nothing. */
function effectPart(battle, id, effect) {
  if (effect.type === 'triggerItem') return { text: 'AGAIN', isBoosted: false }
  if (effect.amount?.previous) return { text: `${shortStat('damage')} ×${effect.amount.scale ?? 1}`, isBoosted: false }
  const { amount, isBoosted } = liveAmount(battle, id, effect.amount)
  if (!amount) return null
  return { text: effectText[effect.type](effect, amount), isBoosted }
}
function abilityLabel(battle, id, ability) {
  const parts = ability.effects.map(effect => effectPart(battle, id, effect)).filter(Boolean)
  if (!parts.length) return null
  const trigger = ability.trigger.event === 'statusApplied' ? `ON ${shortStatus(ability.trigger.status)}` : triggerShort[ability.trigger.event] ?? ''
  const costs = (ability.costs ?? []).map(cost => `${cost.amount} ${resourceShort[cost.resource] ?? cost.resource.toUpperCase()}→`).join('')
  const arrow = arrows[ability.target.direction] ?? ''
  return { trigger, text: `${costs}${parts.map(part => part.text).join(' ')}${arrow ? ' ' + arrow : ''}${ability.limit?.perCombat ? ' 1×' : ''}`, isBoosted: parts.some(part => part.isBoosted) }
}

/** Every line an item shows on the grid: its own abilities, then what it gives its neighbours. */
export function itemGlance(battle, id) {
  const definition = itemDefinition(battle, id)
  const consumable = consumableGlance[battle.items[id].type]
  if (consumable) return [{ trigger: 'TAP', text: consumable(battle.items[id].stats), isBoosted: false }]
  const lines = definition.abilities.map(ability => abilityLabel(battle, id, ability)).filter(Boolean)
  for (const aura of definition.auras) lines.push({ trigger: 'AURA', text: `${signed(auraAmount(aura, battle.items[id]))} ${shortStat(aura.stat)}`, isBoosted: false })
  for (const grant of definition.grants) for (const ability of grant.abilities) {
    const label = abilityLabel(battle, id, ability)
    if (label) lines.push({ trigger: 'GIVES', text: `${label.trigger ? label.trigger + ' ' : ''}${label.text}`, isBoosted: false })
  }
  return lines
}

/** What a resolved step did, for the item that just fired. */
export function firedGlance(step) {
  return step.effects.filter(effect => effect.amount).map(effect => effectText[effect.type](effect, effect.amount)).join(' ')
}

/** Label for one link badge; links with no useful number collapse to a symbol. */
export function linkLabel(battle, link) {
  const definition = itemDefinition(battle, link.source)
  const kinds = {
    aura: () => definition.auras.map(aura => `${signed(auraAmount(aura, battle.items[link.source]))} ${shortStat(aura.stat)}`).join(' '),
    grant: () => '✦',
    reaction: () => '◉',
    target: () => definition.abilities.map(ability => ability.target.kind === 'directionalNeighbour' ? abilityLabel(battle, link.source, ability)?.text.replace(/ [▶◀▼▲]$/, '') : null).filter(Boolean).join(' ') || '•',
    late: () => '!'
  }
  return kinds[link.kind]()
}

/** One badge per touching pair of items, placed on the shared edge nearest the middle of their contact. */
export function edgeBadges(battle, links) {
  const pairs = new Map()
  for (const link of links) {
    const contact = contactEdge(battle, link.source, link.target)
    if (!contact || (link.kind === 'aura' && !feedsStat(battle, link))) continue
    const key = [link.source, link.target].sort().join('|')
    const entry = pairs.get(key) ?? { ...contact, labels: [] }
    const arrow = arrows[contact.side]
    const label = linkLabel(battle, link)
    // Contact is measured from the first link's source, so a reverse link points the other way.
    const towards = link.source === contact.source ? arrow : arrows[opposite[contact.side]]
    entry.labels.push(`${label} ${towards}`)
    entry.kinds = [...new Set([...(entry.kinds ?? []), link.kind])]
    pairs.set(key, entry)
  }
  return [...pairs.values()]
}
// An aura on an item that never reads the stat changes nothing, so it gets no badge.
const feedsStat = (battle, link) => itemDefinition(battle, link.source).auras.some(aura => itemDefinition(battle, link.target).stats?.[aura.stat] !== undefined)
const opposite = { right: 'left', left: 'right', up: 'down', down: 'up' }
const sides = Object.entries({ right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] })
function contactEdge(battle, source, target) {
  const targetCells = new Set(footprint(itemDefinition(battle, target), battle.items[target].position).map(cell => cell.join(',')))
  const touching = []
  for (const cell of footprint(itemDefinition(battle, source), battle.items[source].position)) {
    for (const [side, [dx, dy]] of sides) if (targetCells.has(`${cell[0] + dx},${cell[1] + dy}`)) touching.push({ source, cell, side })
  }
  return touching[Math.floor(touching.length / 2)] ?? null
}
