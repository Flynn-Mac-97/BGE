/**
 * Family powers: with 3 items of one power family on the grid that family's power is on; with 5 it is doubled.
 * They are recruit abilities with a `tagCountAtLeast` condition, so they follow the grid live: move a piece off
 * and the power goes out. `familyPowers` holds the words players see; `familyPowerAbilities` the rules.
 */
import { powerFamilies, familyOf } from '../power-families.js'
import { rules } from '../rules.js'

export const familyPowerThresholds = [3, 5]

export const familyPowers = {
  combat: { title: 'Arms Drill', text: 'Weapons deal +25% damage.' },
  growth: { title: 'Living Bark', text: 'Every heal you receive also gives that much guard.' },
  scholarship: { title: 'Resonance', text: 'Every status stack you put on the foe also deals 1 damage, through guard.' },
  hunger: { title: 'Blood Frenzy', text: 'Below half health, weapons deal +40% damage.' },
  scavenging: { title: 'Lucky Haul', text: 'Each cycle, roll a die for Salvage; weapons get +1 damage per 2 Salvage you hold.' }
}

const weapons = { kind: 'allItems', tags: ['weapon'], ownerOnly: true }
const hasFamily = (family, amount) => ({ kind: 'tagCountAtLeast', tag: family, amount, subject: 'self' })

/** One power at one threshold, as a recruit ability. */
const powerAbilities = {
  combat: amount => ({ trigger: { event: 'cycleStart' }, target: weapons, conditions: [hasFamily('combat', amount)], effects: [{ type: 'modifyStat', stat: 'damage', amount: { targetStat: 'damage', scale: 0.25 }, duration: 'cycle' }] }),
  growth: amount => ({ trigger: { event: 'healed', target: { kind: 'self' } }, target: { kind: 'self' }, conditions: [hasFamily('growth', amount)], effects: [{ type: 'guard', amount: { eventAmount: true } }] }),
  scholarship: amount => ({ trigger: { event: 'statusApplied', target: { kind: 'enemy' } }, target: { kind: 'eventTarget' }, conditions: [hasFamily('scholarship', amount)], effects: [{ type: 'damage', amount: { eventAmount: true }, bypassGuard: true }], limit: { perCycle: 8 } }),
  hunger: amount => ({ trigger: { event: 'cycleStart' }, target: weapons, conditions: [hasFamily('hunger', amount), { kind: 'healthBelow', ratio: 0.5, subject: 'self' }], effects: [{ type: 'modifyStat', stat: 'damage', amount: { targetStat: 'damage', scale: 0.4 }, duration: 'cycle' }] }),
  scavenging: amount => ({ trigger: { event: 'cycleStart' }, target: weapons, conditions: [hasFamily('scavenging', amount)], effects: [{ type: 'resource', resource: 'salvage', amount: { roll: 6 }, target: { kind: 'self' } }, { type: 'modifyStat', stat: 'damage', amount: { resource: 'salvage', scale: 0.5 }, duration: 'cycle' }] })
}

/** Every family power at both thresholds, ready to add to the recruit's abilities. */
export const familyPowerAbilities = Object.entries(powerAbilities).flatMap(([family, ability]) => familyPowerThresholds.map(amount => ({ id: `${family}Power${amount}`, ...ability(amount) })))

/** How many placed items of each family an owner has: `{ family: count }`. */
export function familyCounts(battle, owner = 'recruit') {
  const counts = Object.fromEntries(Object.keys(powerFamilies).map(family => [family, 0]))
  for (const item of Object.values(battle.items)) {
    const family = item.position && item.owner === owner ? familyOf(rules.catalog.items[item.type]) : ''
    if (family) counts[family]++
  }
  return counts
}
