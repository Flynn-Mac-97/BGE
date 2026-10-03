/** Reversible practice kits expose the whole item shelf without changing dungeon acquisition. */
import { rules } from './rules.js'
export const familyKits = {
  growth: { name: 'Growth', hint: 'Root Totem heals through nearby weapons. Move it and inspect the links.', placed: [['dagger', [1, 0]], ['rootTotem', [2, 1]], ['salve', [0, 0]], ['sprig', [0, 1]], ['hammer', [3, 1]]] },
  combat: { name: 'Combat', hint: 'Whetstone prepares the hammer to its right. The hammer strips guard before damage.', placed: [['stone', [0, 0]], ['hammer', [1, 0]], ['banner', [2, 0]], ['sword', [3, 0]]] },
  scholarship: { name: 'Scholarship & Alchemy', hint: 'Storm Totem empowers touching weapons. Venom prepares the dagger to its right.', placed: [['venom', [0, 0]], ['dagger', [1, 0]], ['stormTotem', [2, 1]], ['hammer', [3, 1]], ['echo', [3, 0]]] },
  hunger: { name: 'Hunger & Curses', hint: 'Curse Idol feeds Reaping Seal over two cycles. Hungry Tooth feeds Blood Cup.', placed: [['curseIdol', [0, 0]], ['reapingSeal', [1, 0]], ['dagger', [2, 0]], ['hungryTooth', [3, 0]], ['bloodCup', [4, 0]], ['banner', [1, 1]]] },
  scavenging: { name: 'Scavenging & Fortune', hint: 'The dagger inside Salvager Pack generates Salvage. Patch Kit spends 2 for guard.', placed: [['salvagePack', [5, 0]], ['dagger', [5, 0]], ['patchKit', [4, 0]], ['hammer', [1, 0]]] }
}
function practiceBattle(items) {
  return rules.createState({ columns: 5, rows: 3, actors: {
    recruit: { name: 'Practice Recruit', team: 'crew', maxHealth: 30, health: 20, resources: { hunger: 0, salvage: 0 }, resourceCaps: { hunger: 9, salvage: 99 } },
    enemy: { name: 'Armoured Dummy', mark: 'T', team: 'dungeon', maxHealth: 60, stats: { damage: 2 }, abilities: [
      { id: 'dummyGuard', trigger: { event: 'cycleStart' }, target: { kind: 'self' }, effects: [{ type: 'guard', amount: 2 }] },
      { id: 'dummyAttack', trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, effects: [{ type: 'damage', amount: 2 }] }
    ] }
  }, items })
}
/** Every catalog item is available in reserve; selected family pieces start equipped. */
export function createFamilyJourney(family) {
  const kit = familyKits[family]
  if (!kit) throw new TypeError('Unknown test family ' + family)
  const placements = new Map(kit.placed)
  const items = Object.keys(rules.catalog.items).map(type => ({ id: 'lab-' + type, type, owner: 'recruit', position: placements.get(type) ?? null }))
  return { sandbox: family, room: 1, cleared: 0, scrap: 0, nextItem: 100, phase: 'battle', rewardKind: null, choices: [], battle: practiceBattle(items), roomStartHealth: 20, message: kit.hint }
}
/** Replay the current arrangement with fresh health, charges and resources. */
export function resetPractice(journey) {
  if (!journey.sandbox) return false
  journey.battle = practiceBattle(Object.values(journey.battle.items).map(item => ({ id: item.id, type: item.type, owner: item.owner, position: item.position })))
  journey.phase = 'battle'; journey.message = familyKits[journey.sandbox].hint
  return true
}
