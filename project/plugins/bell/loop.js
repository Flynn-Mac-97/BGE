/** Endless rooms and loot are separate from combat rules and contain no item effect logic. */
import { rules, itemDefinition } from './rules.js'

const encounters = [
  { name: 'Cellar Rat', mark: 'r', effects: [] },
  { name: 'Grave Robber', mark: 'x', effects: [] },
  { name: 'Venom Leech', mark: 'v', effects: [{ type: 'applyStatus', status: 'poison', amount: 1 }] }
]
const firstFinds = ['venom', 'stone', 'salve']
const lootPool = Object.keys(rules.catalog.items)

function enemyFor(room) {
  const encounter = encounters[(room - 1) % encounters.length]
  return { name: encounter.name, mark: encounter.mark, team: 'dungeon', maxHealth: 4 + (room - 1) * 3,
    stats: { damage: 1 + Math.floor((room - 1) / 3) }, abilities: [{ id: 'enemyAttack', trigger: { event: 'ownTurn' }, target: { kind: 'enemy' },
      effects: [{ type: 'damage', amount: { stat: 'damage' } }, ...encounter.effects] }] }
}
function battleFor(room, previous, health) {
  const battle = rules.createState({ columns: previous?.grid.columns ?? 3, rows: 3,
    actors: { recruit: { name: 'Nameless Recruit', team: 'crew', maxHealth: 12, health: health ?? 12, resources: { hunger: 0 }, resourceCaps: { hunger: 9 } }, enemy: enemyFor(room) },
    items: previous ? Object.values(previous.items).map(item => ({ id: item.id, type: item.type, owner: 'recruit', position: item.position })) : [{ id: 'item-1', type: 'dagger', owner: 'recruit', position: [1, 0] }] })
  return battle
}

/** The caller supplies the engine's random value; tests supply a fixed value. */
export function createJourney() {
  return { room: 1, cleared: 0, scrap: 0, nextItem: 2, phase: 'battle', rewardKind: null, choices: [], battle: battleFor(1), roomStartHealth: 12,
    message: 'A nameless recruit, a rusty dagger. Survive the cellars and claim what is left.' }
}

function choicesFor(journey, random) {
  if (journey.room === 1 && journey.rewardKind === 'room') return [...firstFinds]
  const available = [...lootPool]
  const choices = []
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
  if (winner !== 'crew') {
    journey.phase = 'defeat'
    journey.message = winner ? 'Your recruit fell. Retry this room to adjust the build, or begin a new run.' : 'The fight stalled after 30 cycles. Retry with an attacking item equipped.'
    return true
  }
  journey.cleared++
  journey.phase = 'reward'; journey.rewardKind = 'room'
  journey.choices = choicesFor(journey, random)
  journey.message = 'Room cleared. Keep one find. The other two become 1 scrap together. Recover 3 health.'
  return true
}

/** A claimed find becomes a unique instance in reserve; room rewards also open the next room. */
export function claim(journey, type) {
  if (journey.phase !== 'reward' || !journey.choices.includes(type)) return false
  const roomReward = journey.rewardKind === 'room'
  if (roomReward) {
    journey.room++
    journey.scrap++
    const health = Math.min(12, journey.battle.actors.recruit.health + 3)
    journey.battle = battleFor(journey.room, journey.battle, health)
    journey.roomStartHealth = health
    if ([4, 7].includes(journey.room)) rules.resize(journey.battle, journey.battle.grid.columns + 1, 3)
  }
  const id = 'item-' + journey.nextItem++
  rules.addItem(journey.battle, id, type, 'recruit')
  journey.phase = 'battle'; journey.choices = []; journey.rewardKind = null
  journey.message = `${rules.catalog.items[type].name} acquired. Tap it in reserve, then a grid cell.${roomReward && [4, 7].includes(journey.room) ? ' Recovered pack: the grid gained a full-height column.' : ''}`
  return id
}

/** Spare gear can fund a cache; the last owned weapon cannot be salvaged. */
export function salvage(journey, id) {
  if (journey.phase !== 'battle' || journey.battle.phase !== 'planning' || !journey.battle.items[id]) return false
  const weapons = Object.keys(journey.battle.items).filter(item => itemDefinition(journey.battle, item).tags.includes('weapon'))
  if (weapons.includes(id) && weapons.length === 1) { journey.message = 'Keep your last weapon; the recruit needs a way to attack.'; return false }
  delete journey.battle.items[id]
  journey.scrap++
  journey.message = 'Salvaged for 1 scrap. Search a cache for 3 scrap.'
  return true
}
export function searchCache(journey, random) {
  if (journey.phase !== 'battle' || journey.battle.phase !== 'planning' || journey.scrap < 3) return false
  journey.scrap -= 3; journey.phase = 'reward'; journey.rewardKind = 'cache'
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
