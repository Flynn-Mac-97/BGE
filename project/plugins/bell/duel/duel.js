/**
 * A same-screen duel: two players draft builds in turn on one phone, then the builds fight.
 * Journey shape: `{ duel: { rules, shelf, players: [player, player], turn, stage, winner, fights, rated }, phase, battle, message }`,
 * where a player is `{ name, portrait, build: [{ type, position }] }` and stage is 'draft', 'handoff', 'fight' or 'result'.
 * `phase` is 'battle' while a grid is in play, so the grid controls work for drafting as well as fighting.
 */
import { rules } from '../rules.js'
import { placedItems } from '../../grid-game/grid.js'
import { descentPool, descentCrew } from '../descent/pool.js'
import { evolvedItems } from '../descent/evolutions.js'
import { levelStat } from '../descent/run.js'

const CYCLE_CAP = 30
const heroes = Object.keys(descentCrew)
const pick = (list, random) => list[Math.min(list.length - 1, Math.floor(Math.max(0, random()) * list.length))]

/** The items the shelf offers under these rules. */
function shelfFor(ruleSet, forgedTypes, random) {
  const all = [...descentPool, ...(ruleSet.evolved === 'on' ? Object.keys(evolvedItems) : []), ...(ruleSet.forged === 'on' ? forgedTypes : [])]
  if (ruleSet.shelf !== 'random 8') return all
  const left = [...all], chosen = []
  while (chosen.length < 8 && left.length) chosen.push(left.splice(left.indexOf(pick(left, random)), 1)[0])
  return chosen
}

const levelled = (battle, level) => { for (const item of Object.values(battle.items)) for (const [stat, base] of Object.entries(rules.catalog.items[item.type].stats)) item.stats[stat] = levelStat(base, level) }

function draftBattle(duel, index) {
  const player = duel.players[index]
  const placed = new Map(player.build.map(entry => [entry.type, entry.position]))
  const battle = rules.createState({ columns: duel.rules.columns, rows: 3,
    actors: { recruit: { name: descentCrew[player.portrait].name, team: 'crew', maxHealth: duel.rules.health }, enemy: { name: 'Rival', team: 'dungeon', maxHealth: 1 } },
    items: duel.shelf.map((type, shelfIndex) => ({ id: `shelf-${shelfIndex}`, type, owner: 'recruit', position: null })) })
  levelled(battle, duel.rules.level)
  for (const item of Object.values(battle.items)) if (placed.has(item.type)) rules.place(battle, item.id, placed.get(item.type))
  return battle
}

function fightBattle(duel) {
  const actor = (index, team) => ({ name: descentCrew[duel.players[index].portrait].name, short: `P${index + 1}`, team, maxHealth: duel.rules.health, inventory: { columns: duel.rules.columns, rows: 3 }, resources: { hunger: 0, salvage: 0 }, resourceCaps: { hunger: 9, salvage: 99 } })
  const items = duel.players.flatMap((player, index) => player.build.map((entry, entryIndex) => ({ id: `p${index + 1}-${entryIndex}`, type: entry.type, owner: index ? 'enemy' : 'recruit', position: entry.position })))
  const battle = rules.createState({ actors: { recruit: actor(0, 'crew'), enemy: actor(1, 'dungeon') }, items })
  levelled(battle, duel.rules.level)
  return battle
}

/** A new duel with these rules; Player 1 drafts first. */
export function createDuel(ruleSet, forgedTypes, random) {
  const duel = { rules: { ...ruleSet }, shelf: shelfFor(ruleSet, forgedTypes, random), players: [{ name: 'Player 1', portrait: 'rook', build: [] }, { name: 'Player 2', portrait: 'toll', build: [] }], turn: 0, stage: 'draft', winner: null }
  return { duel, phase: 'battle', battle: draftBattle(duel, 0), message: 'Player 1: put up to ' + ruleSet.items + ' items on your grid, then tap READY.' }
}

/** True when the drafting player may put one more item on the grid. */
export function canPlaceDraft(journey, id) {
  if (journey.duel?.stage !== 'draft') return true
  return Boolean(journey.battle.items[id]?.position) || placedItems(journey.battle).length < journey.duel.rules.items
}

/** Change the drafting player's hero portrait to the next crew member. */
export function nextHero(journey) {
  if (journey.duel?.stage !== 'draft') return false
  const player = journey.duel.players[journey.duel.turn]
  player.portrait = heroes[(heroes.indexOf(player.portrait) + 1) % heroes.length]
  journey.battle.actors.recruit.name = descentCrew[player.portrait].name
  return true
}

/** Lock in the drafting player's build: hand over to Player 2, or start the fight. */
export function readyDraft(journey) {
  const duel = journey.duel
  if (duel?.stage !== 'draft' || !placedItems(journey.battle).length) return false
  duel.players[duel.turn].build = placedItems(journey.battle).map(item => ({ type: item.type, position: [...item.position] }))
  if (duel.turn === 0) { duel.turn = 1; duel.stage = 'handoff'; journey.phase = 'handoff'; journey.message = 'Pass the phone to Player 2. No peeking.'; return true }
  duel.stage = 'fight'; journey.phase = 'battle'; duel.fights = (duel.fights ?? 0) + 1
  journey.battle = fightBattle(duel)
  journey.message = `${descentCrew[duel.players[0].portrait].name} (P1) faces ${descentCrew[duel.players[1].portrait].name} (P2). Tap FIGHT.`
  return true
}

/** Player 2 has the phone: start their draft. */
export function takeHandoff(journey) {
  if (journey.duel?.stage !== 'handoff') return false
  journey.duel.stage = 'draft'; journey.phase = 'battle'
  journey.battle = draftBattle(journey.duel, 1)
  journey.message = `Player 2: put up to ${journey.duel.rules.items} items on your grid, then tap READY.`
  return true
}

/** Sudden death: from its cycle on, both heroes lose 3 health more each cycle than the cycle before. */
function suddenDeath(journey) {
  const start = journey.duel.rules.suddenDeath, battle = journey.battle
  if (start === 'off' || battle.cycle < start) return
  const loss = 3 * (battle.cycle - start + 1)
  for (const actor of Object.values(battle.actors)) actor.health = Math.max(0, actor.health - loss)
  journey.message = `Sudden death: both heroes lose ${loss}.`
}

/** Called after each resolved cycle. Returns true once the duel is decided. */
export function finishDuel(journey) {
  if (journey.duel?.stage !== 'fight') return false
  if (!rules.winner(journey.battle) && journey.battle.cycle <= CYCLE_CAP) suddenDeath(journey)
  const winner = rules.winner(journey.battle)
  const isDraw = !winner && (journey.battle.cycle > CYCLE_CAP || Object.values(journey.battle.actors).every(actor => actor.health <= 0))
  if (!winner && !isDraw) return false
  journey.duel.winner = winner === 'crew' ? 0 : winner ? 1 : null
  journey.duel.stage = 'result'; journey.phase = 'result'
  journey.message = journey.duel.winner === null ? 'A draw. Nobody is left standing.' : `${journey.duel.players[journey.duel.winner].name} wins!`
  return true
}

/** Store how fun the duel was (1 dull, 2 fine, 3 great) in the profile's duel log, newest first, at most 60. */
export function rateDuel(profile, journey, fun) {
  const duel = journey.duel
  if (duel?.stage !== 'result' || duel.rated || ![1, 2, 3].includes(fun)) return false
  duel.rated = true
  profile.duels = [{ rules: { ...duel.rules }, builds: duel.players.map(player => player.build.map(entry => entry.type)), winner: duel.winner, cycles: journey.battle.cycle, fun }, ...profile.duels].slice(0, 60)
  return true
}

/** Same builds, fresh fight. */
export function fightAgain(journey) {
  if (journey.duel?.stage !== 'result') return false
  Object.assign(journey.duel, { stage: 'fight', winner: null, rated: false, fights: (journey.duel.fights ?? 0) + 1 })
  journey.phase = 'battle'; journey.battle = fightBattle(journey.duel)
  journey.message = 'Same builds, again. Tap FIGHT.'
  return true
}

/** Both players draft again, starting from their last builds. */
export function redraft(journey) {
  if (journey.duel?.stage !== 'result') return false
  Object.assign(journey.duel, { stage: 'draft', turn: 0, winner: null, rated: false })
  journey.phase = 'battle'; journey.battle = draftBattle(journey.duel, 0)
  journey.message = 'Player 1: change your build, then tap READY.'
  return true
}

/** Average fun for each rule option across rated duels: `[{ rule, option, average, count }]`, best first. */
export function funByRule(duels) {
  const totals = new Map()
  for (const duel of duels) for (const [rule, option] of Object.entries(duel.rules)) {
    const key = `${rule}=${option}`
    const total = totals.get(key) ?? { rule, option, sum: 0, count: 0 }
    total.sum += duel.fun; total.count++
    totals.set(key, total)
  }
  return [...totals.values()].map(total => ({ rule: total.rule, option: total.option, average: total.sum / total.count, count: total.count })).sort((first, second) => second.average - first.average || second.count - first.count)
}
