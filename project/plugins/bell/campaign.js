/** Persistent company records and expedition settlement; no rendering or storage side effects. */
import { rules } from './rules.js'
import { createJourney } from './loop.js'

export const adventurers = {
  rook: { name: 'Rook, the Deserter', story: 'A soldier without a regiment. His borrowed courage comes with a rusty dagger.', cost: 3, requirement: 0, items: [['dagger', [1, 0]]] },
  nettle: { name: 'Nettle, the Hedge Doctor', story: 'Driven out for treating a baron’s goat before the baron. Still carries a little salve.', cost: 3, requirement: 0, items: [['dagger', [1, 0]], ['salve', [0, 0]]] },
  pip: { name: 'Pip, the Failed Apprentice', story: 'Expelled after the lightning incident. Insists the little totem is perfectly safe now.', cost: 3, requirement: 0, items: [['dagger', [1, 0]], ['stormTotem', [0, 0]]] },
  toll: { name: 'Toll, the Hungry Bell-ringer', story: 'Followed your lantern home. Something in his pocket keeps whispering about supper.', cost: 4, requirement: 4, items: [['dagger', [1, 0]], ['hungryTooth', [0, 0]], ['bloodCup', [2, 0]]] },
  moss: { name: 'Moss, the Pack Keeper', story: 'Arrived with a stubborn yak and an implausible amount of luggage. The yak waits upstairs.', cost: 5, requirement: 8, items: [['salvagePack', [3, 0]], ['dagger', [3, 0]], ['patchKit', [2, 0]]] }
}
export const traits = {
  mend: { name: 'Field Medicine', text: 'Recover 1 health at cycle start.', ability: { id: 'crewMend', trigger: { event: 'cycleStart' }, target: { kind: 'self' }, effects: [{ type: 'heal', amount: 1 }] } },
  brace: { name: 'Stand Firm', text: 'Gain 1 guard at cycle start.', ability: { id: 'crewBrace', trigger: { event: 'cycleStart' }, target: { kind: 'self' }, effects: [{ type: 'guard', amount: 1 }] } }
}
export const createCompany = () => ({ version: 1, coins: 3, roster: {}, cleared: 0, bestDepth: 0, active: null, notice: 'The Last Lantern smells of wet wool and cheap broth. Three strangers want work. You have enough coin to hire one. Choose your first companion.' })
const kitOf = battle => Object.values(battle.items).map(item => ({ id: item.id, type: item.type, position: item.position, ...(item.refinement ? { refinement: structuredClone(item.refinement) } : {}) }))

/** Hiring is permanent and repeat clicks cannot duplicate a recruit or their gear. */
export function hire(company, id) {
  const definition = adventurers[id]
  if (!definition || company.active || company.roster[id] || company.bestDepth < definition.requirement || company.coins < definition.cost) return false
  company.coins -= definition.cost
  company.roster[id] = { id, experience: 0, trait: null, injuries: 0, expeditions: 0, kit: definition.items.map(([type, position], index) => ({ id: 'item-' + (index + 1), type, position: [...position] })) }
  company.notice = `${definition.name} pulls up a chair. Their belongings are yours to arrange, but the person is yours to look after. Choose Enter the cellars when ready.`
  return true
}

/** Start with banked possessions; the active snapshot is the only unbanked expedition. */
export function embark(company, id) {
  const member = company.roster[id]
  if (!member || company.active || member.injuries) return null
  const journey = createJourney()
  const definition = adventurers[id]
  journey.battle = rules.createState({ actors: { recruit: { name: definition.name, campaign: true, team: 'crew', maxHealth: 12, resources: { hunger: 0, salvage: 0 }, resourceCaps: { hunger: 9, salvage: 99 }, abilities: member.trait ? [traits[member.trait].ability] : [] }, enemy: journey.battle.actors.enemy }, items: member.kit.map(item => ({ ...item, owner: 'recruit' })) })
  for (const item of member.kit) if (item.refinement) {
    journey.battle.items[item.id].refinement = structuredClone(item.refinement)
    journey.battle.items[item.id].stats[item.refinement.stat] = (journey.battle.items[item.id].stats[item.refinement.stat] ?? 0) + 1
  }
  journey.nextItem = Math.max(0, ...member.kit.map(item => Number(item.id.split('-')[1]))) + 1
  journey.expedition = { recruit: id, startingKit: structuredClone(member.kit), goal: 8, index: member.expeditions }
  journey.message = `${definition.name} lifts the cellar hatch. Clear rooms for salvage; every fourth room holds a find. Return between fights to keep your discoveries. A warden waits on floor 8.`
  company.active = journey
  return journey
}

/** Settlement is single-use. Defeat restores departure gear; returning banks the current kit. */
export function returnToTavern(company, journey) {
  if (company.active !== journey || !journey.expedition || journey.sandbox || journey.battle.phase === 'resolving') return false
  if (journey.phase === 'battle' && journey.battle.started && !rules.winner(journey.battle)) return false
  const member = company.roster[journey.expedition.recruit]
  const defeated = journey.phase === 'defeat'
  const before = company.bestDepth
  if (defeated) {
    member.kit = structuredClone(journey.expedition.startingKit)
    member.injuries = 1
    company.notice = `${adventurers[member.id].name} is carried through the door. Your departure kit was recovered; unbanked finds and scrap are gone. Rest at the tavern to recover. No one is lost.`
  } else {
    const coin = journey.scrap + (journey.phase === 'reward' ? 1 : 0)
    member.kit = kitOf(journey.battle)
    member.experience += journey.cleared
    company.coins += coin
    company.cleared += journey.cleared
    company.bestDepth = Math.max(company.bestDepth, journey.cleared)
    company.notice = `${adventurers[member.id].name} returns with ${coin} coin and ${journey.cleared} experience. Their current kit is safe. ${journey.cleared >= 8 ? 'The cellar warden is dead. Tonight, the drinks are on the house.' : 'There will be another expedition.'}`
    for (const definition of Object.values(adventurers)) if (definition.requirement > before && definition.requirement <= company.bestDepth) company.notice += ` ${definition.name} is now available to hire.`
  }
  member.expeditions++
  company.active = null
  return true
}
export function rest(company, id) {
  const member = company.roster[id]
  if (company.active || !member?.injuries) return false
  member.injuries = 0; company.notice = 'A bowl of broth and a night beside the hearth. Ready to try again.'
  return true
}
export function learn(company, id, trait) {
  const member = company.roster[id]
  if (company.active || !member || member.trait || member.experience < 4 || !traits[trait]) return false
  member.trait = trait; company.notice = `${adventurers[id].name} learned ${traits[trait].name}. This remains with them on future expeditions.`
  return true
}
export function refine(company, id, itemId) {
  const member = company.roster[id], item = member?.kit.find(item => item.id === itemId)
  if (company.active || !item || item.refinement || company.coins < 3) return false
  const stat = ['damage', 'heal', 'guard'].find(stat => rules.catalog.items[item.type].stats[stat] > 0)
  if (!stat) return false
  company.coins -= 3; item.refinement = { stat, amount: 1 }
  company.notice = `${rules.catalog.items[item.type].name} is refined: +1 ${stat}. This particular item keeps its improvement.`
  return true
}
