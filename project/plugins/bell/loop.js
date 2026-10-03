/** Endless rooms and loot are separate from combat rules and contain no item effect logic. */
import { campaignEnemy, campaignChoices } from './campaign-rules.js'
import { familyItems } from './catalog/families.js'
import { labItems } from './catalog/lab.js'
import { rules, itemDefinition } from './rules.js'

const encounters = [
  { name: 'Cellar Rat', mark: 'r', effects: [] },
  { name: 'Grave Robber', mark: 'x', effects: [] },
  { name: 'Venom Leech', mark: 'v', effects: [{ type: 'applyStatus', status: 'poison', amount: 1 }] }
]
export const cacheCost = 12
export const findInterval = 4
const firstFinds = ['venom', 'stormTotem', 'salve']
const lootPool = Object.keys(rules.catalog.items).filter(type => !labItems[type])

function enemyFor(room, campaign) {
  if (campaign) return campaignEnemy(room)
  const encounter = encounters[(room - 1) % encounters.length]
  return { name: encounter.name, mark: encounter.mark, team: 'dungeon', maxHealth: 4 + Math.floor((room - 1) / 4) * 2 + (room % findInterval === 0 ? 2 : 0),
    stats: { damage: 1 + Math.floor((room - 1) / 12) }, abilities: [{ id: 'enemyAttack', trigger: { event: 'ownTurn' }, target: { kind: 'enemy' },
      effects: [{ type: 'damage', amount: { stat: 'damage' } }, ...encounter.effects] }] }
}
function battleFor(room, previous, health) {
  const crew = previous?.actors.recruit
  const battle = rules.createState({ columns: previous?.baseColumns ?? 3, rows: 3,
    actors: { recruit: { name: crew?.name ?? 'Nameless Recruit', ...(crew?.campaign ? { campaign: true } : {}), abilities: crew?.abilities ?? [], team: 'crew', maxHealth: crew?.maxHealth ?? 12, health: health ?? 12, resources: { hunger: 0, salvage: 0 }, resourceCaps: { hunger: 9, salvage: 99 } }, enemy: enemyFor(room, crew?.campaign) },
    items: previous ? Object.values(previous.items).map(item => ({ id: item.id, type: item.type, owner: 'recruit', position: item.position })) : [{ id: 'item-1', type: 'dagger', owner: 'recruit', position: [1, 0] }] })
  for (const item of Object.values(previous?.items ?? {})) if (item.refinement) {
    battle.items[item.id].refinement = structuredClone(item.refinement)
    battle.items[item.id].stats[item.refinement.stat] = (battle.items[item.id].stats[item.refinement.stat] ?? 0) + item.refinement.amount
  }
  return battle
}

/** The caller supplies the engine's random value; tests supply a fixed value. */
export function createJourney() {
  return { room: 1, cleared: 0, scrap: 0, nextItem: 2, phase: 'battle', rewardKind: null, choices: [], battle: battleFor(1), roomStartHealth: 12,
    message: 'A nameless recruit, a rusty dagger. Survive the cellars and claim what is left.' }
}

function choicesFor(journey, random) {
  if (journey.expedition?.index > 0 && journey.rewardKind === 'room') return campaignChoices(journey, rules.catalog, random)
  if (journey.room === findInterval && journey.rewardKind === 'room') return [...firstFinds]
  if (journey.room === findInterval * 2 && journey.rewardKind === 'room') return ['pouch', 'pack', 'sword']
  const available = [...lootPool]
  const owned = new Set(Object.values(journey.battle.items).map(item => item.type))
  const familyPool = Object.keys(familyItems)
  const unowned = familyPool.filter(type => !owned.has(type))
  const featured = unowned.length ? unowned : familyPool
  const selected = featured[Math.min(featured.length - 1, Math.floor(Math.max(0, random()) * featured.length))]
  const choices = [selected]
  available.splice(available.indexOf(selected), 1)
  while (choices.length < 3) {
    const index = Math.min(available.length - 1, Math.floor(Math.max(0, random()) * available.length))
    choices.push(available.splice(index, 1)[0])
  }
  return choices
}

/** A victory opens exactly one reward. Repeated notifications cannot grant another. */
export function finishBattle(journey, random) {
  if (journey.phase !== 'battle') return false
  const winner = rules.winner(journey.battle)
  if (!winner && journey.battle.cycle <= 30) return false
  if (journey.sandbox) {
    journey.phase = 'practiceComplete'
    journey.message = winner === 'crew' ? 'Dummy defeated. Reset this arrangement or choose another family.' : 'Test complete. Reset, rearrange and try again.'
    return true
  }
  if (winner !== 'crew') {
    journey.phase = 'defeat'
    journey.message = journey.expedition ? 'Your companion has fallen. Return to the tavern: their departure kit is safe, but unbanked discoveries will be lost.' : winner ? 'Your recruit fell. Retry this room to adjust the build, or begin a new run.' : 'The fight stalled after 30 cycles. Retry with an attacking item equipped.'
    return true
  }
  journey.cleared++
  journey.phase = 'reward'; journey.rewardKind = journey.room % findInterval === 0 ? 'room' : 'salvage'
  journey.choices = journey.rewardKind === 'room' ? choicesFor(journey, random) : []
  journey.message = journey.rewardKind === 'room' ? 'Hard-earned find. Keep one item. Recover 3 health and gather 1 scrap.' : `Room cleared. Gather 1 scrap and recover 3 health. Next item find: room ${Math.ceil((journey.room + 1) / findInterval) * findInterval}.`
  return true
}

function nextRoom(journey) {
  journey.room++
  journey.scrap++
  const health = Math.min(12, journey.battle.actors.recruit.health + 3)
  journey.battle = battleFor(journey.room, journey.battle, health)
  journey.roomStartHealth = health
}

/** Ordinary victories grant salvage once, with an explicit pause before the next room. */
export function descend(journey) {
  if (journey.expedition && journey.cleared >= journey.expedition.goal) return false
  if (journey.phase !== 'reward' || journey.rewardKind !== 'salvage') return false
  nextRoom(journey)
  journey.phase = 'battle'; journey.rewardKind = null; journey.choices = []
  journey.message = `Salvage gathered. Item find in room ${Math.ceil(journey.room / findInterval) * findInterval}. Keep your kit ready.`
  return true
}

/** A claimed find becomes a unique instance in reserve; room rewards also open the next room. */
export function claim(journey, type) {
  if (journey.phase !== 'reward' || !journey.choices.includes(type)) return false
  const roomReward = journey.rewardKind === 'room'
  const complete = journey.expedition && journey.cleared >= journey.expedition.goal
  if (roomReward && !complete) nextRoom(journey)
  if (complete) { journey.scrap++; journey.battle.phase = 'planning' }
  const id = 'item-' + journey.nextItem++
  rules.addItem(journey.battle, id, type, 'recruit')
  journey.phase = complete ? 'expeditionComplete' : 'battle'; journey.choices = []; journey.rewardKind = null
  journey.message = complete ? `${rules.catalog.items[type].name} recovered from the warden. Return to the tavern to bank this kit and meet your new recruit.` : `${rules.catalog.items[type].name} acquired. Tap it in reserve, then a grid cell.`
  return id
}

/** Spare gear can fund a cache; the last owned weapon cannot be salvaged. */
export function salvage(journey, id) {
  if (journey.phase !== 'battle' || journey.battle.phase !== 'planning' || !journey.battle.items[id]) return false
  const weapons = Object.keys(journey.battle.items).filter(item => itemDefinition(journey.battle, item).tags.includes('weapon'))
  if (weapons.includes(id) && weapons.length === 1) { journey.message = 'Keep your last weapon; the recruit needs a way to attack.'; return false }
  if (!rules.place(journey.battle, id, null)) { journey.message = 'Empty this pack and detach packs to its right before salvaging.'; return false }
  delete journey.battle.items[id]
  journey.scrap++
  journey.message = 'Salvaged for 1 scrap. Search a cache for 12 scrap.'
  return true
}
export function searchCache(journey, random) {
  if (journey.phase !== 'battle' || journey.battle.phase !== 'planning' || journey.scrap < cacheCost) return false
  journey.scrap -= cacheCost; journey.phase = 'reward'; journey.rewardKind = 'cache'
  journey.choices = choicesFor(journey, random)
  journey.message = 'Cache opened. Keep one item. Cache leftovers grant no scrap.'
  return true
}
export function retryRoom(journey) {
  if (journey.phase !== 'defeat') return false
  journey.battle = battleFor(journey.room, journey.battle, journey.roomStartHealth)
  journey.phase = 'battle'; journey.message = 'Same room, same loot. Rearrange and try again.'
  return true
}
