/**
 * The Forge: an item made from parts. WHEN picks the trigger, DO the effect, TO the target and POWER the strength.
 * A forged item is a plain record `{ id, when, do, to, power, art }`; `forgedItem` turns it into a catalog item.
 * Every number is in these tables.
 */
import { addRuntimeItems } from '../rules.js'

export const forgeParts = {
  when: {
    turn: { label: 'On its turn', word: 'Steady', trigger: { event: 'ownTurn' }, cost: 3 },
    start: { label: 'At cycle start', word: 'Dawn', trigger: { event: 'cycleStart' }, cost: 3 },
    hit: { label: 'When you are hit', word: 'Spite', trigger: { event: 'damageTaken', target: { kind: 'owner' } }, cost: 2 },
    strike: { label: 'When a touching weapon hits', word: 'Echo', trigger: { event: 'damageDealt', source: { kind: 'adjacentItems', tags: ['weapon'], ownerOnly: true } }, cost: 2, limit: { perCycle: 1 } },
    end: { label: 'At cycle end', word: 'Dusk', trigger: { event: 'cycleEnd' }, cost: 3 }
  },
  do: {
    strike: { label: 'Deal damage', word: 'Blade', stat: 'damage', base: 3, cost: 4, tags: ['weapon', 'combat'], targets: ['enemy', 'attacker'], art: 'shortSword' },
    poison: { label: 'Poison', word: 'Fang', stat: 'potency', base: 2, cost: 4, tags: ['alchemy'], targets: ['enemy', 'attacker'], art: 'roundPotion' },
    sap: { label: 'Sap their damage', word: 'Thorn', stat: 'potency', base: 1, cost: 5, tags: ['growth'], targets: ['enemy', 'attacker'], art: 'thornVine' },
    heal: { label: 'Heal', word: 'Balm', stat: 'potency', base: 3, cost: 3, tags: ['herb', 'growth'], targets: ['you'], art: 'oakLeaf' },
    guard: { label: 'Guard', word: 'Ward', stat: 'potency', base: 3, cost: 3, tags: ['armour'], targets: ['you'], art: 'kiteShield' },
    regen: { label: 'Regenerate', word: 'Seed', stat: 'potency', base: 2, cost: 4, tags: ['herb', 'growth'], targets: ['you'], art: 'seedPod' },
    hone: { label: 'Hone a weapon', word: 'Whet', stat: 'potency', base: 2, cost: 3, tags: ['tool'], targets: ['right', 'below'], art: 'crystalShard' }
  },
  to: {
    enemy: { label: 'the enemy', target: { kind: 'enemy' } },
    attacker: { label: 'whoever hit you', target: { kind: 'eventSource' }, needs: 'hit' },
    you: { label: 'you', target: { kind: 'owner' } },
    right: { label: 'the weapon to its right', target: { kind: 'directionalNeighbour', direction: 'right', tags: ['weapon'], ownerOnly: true } },
    below: { label: 'the weapon below it', target: { kind: 'directionalNeighbour', direction: 'down', tags: ['weapon'], ownerOnly: true } }
  },
  power: {
    spark: { label: 'Spark', word: '', scale: 1, cost: 1 },
    flame: { label: 'Flame', word: 'Burning', scale: 2, cost: 2.2 },
    blaze: { label: 'Blaze', word: 'Blazing', scale: 3, cost: 3.6 }
  }
}
/** Art the forge can give an item, from the ink library. */
export const forgeArt = ['shortSword', 'curvedSword', 'roundPotion', 'tallPotion', 'thornVine', 'oakLeaf', 'kiteShield', 'seedPod', 'crystalShard', 'mushroom', 'antlerCharm', 'moonAmulet', 'runeTablet', 'ritualSkull', 'waxCandle', 'feather']
/** How many forged items a profile may keep. */
export const forgeLimit = 12

const effectFor = {
  strike: amount => [{ type: 'damage', amount }, { type: 'applyStatus', status: 'poison', amount: { stat: 'poisonOnHit' } }],
  poison: amount => [{ type: 'applyStatus', status: 'poison', amount }],
  sap: amount => [{ type: 'applyStatus', status: 'sapped', amount }],
  heal: amount => [{ type: 'heal', amount }],
  guard: amount => [{ type: 'guard', amount }],
  regen: amount => [{ type: 'applyStatus', status: 'regeneration', amount }],
  hone: amount => [{ type: 'modifyStat', stat: 'damage', amount, duration: 'nextAction', expires: 'cycle' }]
}

/** The TO choices a WHEN and DO allow; the first is the default. */
export function forgeTargets(when, effect) {
  return forgeParts.do[effect].targets.filter(id => !forgeParts.to[id].needs || forgeParts.to[id].needs === when)
}
/** True when the parts name real choices that fit together. */
export function isForgeValid(record) {
  return Boolean(forgeParts.when[record.when] && forgeParts.do[record.do] && forgeParts.power[record.power]) && forgeTargets(record.when, record.do).includes(record.to)
}
/** The Bell price of a record. */
export const forgeCost = record => Math.round((forgeParts.when[record.when].cost + forgeParts.do[record.do].cost) * forgeParts.power[record.power].cost)
/** The name a record gets, such as "Burning Spite Fang". */
export const forgeName = record => [forgeParts.power[record.power].word, forgeParts.when[record.when].word, forgeParts.do[record.do].word].filter(Boolean).join(' ')
/** One sentence saying what the item does. */
export function forgeDescription(record) {
  const effect = forgeParts.do[record.do]
  return `${forgeParts.when[record.when].label}: ${effect.label.toLowerCase()} (${effect.base * forgeParts.power[record.power].scale}) → ${forgeParts.to[record.to].label}. Forged at the Lantern.`
}

/** The catalog item and its one ability for a forged record. */
export function forgedItem(record) {
  const when = forgeParts.when[record.when], effect = forgeParts.do[record.do], power = forgeParts.power[record.power]
  const stats = { [effect.stat]: effect.base * power.scale, ...(record.do === 'strike' ? { poisonOnHit: 0 } : {}) }
  const ability = { trigger: structuredClone(when.trigger), target: structuredClone(forgeParts.to[record.to].target), effects: effectFor[record.do]({ stat: effect.stat }), ...(when.limit ? { limit: { ...when.limit } } : {}) }
  return { item: { name: forgeName(record), mark: '✦', footprint: [1, 1], tags: ['forged', ...effect.tags], stats, abilities: [record.id + 'Ability'], art: record.art, description: forgeDescription(record) }, ability }
}

/** Make every forged record of a profile usable by the rules. Call before reading a save that may hold them. */
export function registerForged(records) {
  const items = {}, abilities = {}
  for (const record of records) {
    const { item, ability } = forgedItem(record)
    items[record.id] = item
    abilities[record.id + 'Ability'] = ability
  }
  addRuntimeItems(items, abilities)
}

/** Buy a forged item: it must be valid, affordable and under the limit. Returns the new record, or null. */
export function forgeItem(profile, parts) {
  const record = { id: 'forged' + (profile.forged.length ? Math.max(...profile.forged.map(item => Number(item.id.slice(6)))) + 1 : 1), ...parts, art: forgeArt.includes(parts.art) ? parts.art : forgeParts.do[parts.do]?.art }
  if (!isForgeValid(record) || profile.forged.length >= forgeLimit || profile.journey || profile.bells < forgeCost(record)) return null
  profile.bells -= forgeCost(record)
  profile.forged.push(record)
  registerForged(profile.forged)
  return record
}
