/**
 * Plays seeded Descent runs with the test-bout bot (`descent-bot.mjs`) and the real resolver, and prints how deep each got.
 * `node tools/descent-sim.mjs [runs] [crew] [tower ranks as JSON]`. A balance probe, not a measure of fun.
 */
import { rules } from '../plugins/bell/rules.js'
import { createRun, finishFloor, collectChest, chooseCard, readyEvolutions, readyItem, armReadied, chargesLeft } from '../plugins/bell/descent/run.js'
import { seededRandom } from '../plugins/npc-lab/combo-space.js'
import { arrange, cardChoice } from './descent-bot.mjs'

const runs = Number(process.argv[2] ?? 12)
const crew = process.argv[3] ?? 'rook'
const tower = JSON.parse(process.argv[4] ?? '{}')

/** Tap consumables like a careful player: everything on elites and bosses from the first cycle, the healers when hurt. */
function tapConsumables(journey) {
  const run = journey.descent, hero = journey.battle.actors.recruit
  const isBig = run.enemy.kind !== 'normal', isHurt = hero.health < hero.maxHealth / 2
  for (const [id, item] of Object.entries(run.items)) {
    if (!chargesLeft(item)) continue
    const isHealer = ['mendingDraught', 'brambleWard'].includes(item.type)
    if (isBig ? !isHealer || isHurt : isHealer && isHurt) readyItem(journey, id)
  }
  armReadied(journey)
}

function playRun(seed) {
  const random = seededRandom(seed)
  const journey = createRun({ tower }, crew, random)
  let guard = 0
  const fights = []
  while (journey.phase !== 'dead' && guard++ < 5000) {
    if (journey.phase === 'battle') {
      arrange(journey)
      const kind = journey.descent.enemy.kind, hero = journey.battle.actors.recruit
      if (!journey.battle.started) fights.push({ kind, floor: journey.descent.floor, start: hero.health, max: hero.maxHealth })
      tapConsumables(journey)
      journey.battle = rules.resolveCycle(journey.battle, { afterCycle: ['enemy'] }).state
      const fight = fights.at(-1)
      Object.assign(fight, { cycles: journey.battle.cycle, end: Math.max(0, journey.battle.actors.recruit.health) })
      finishFloor(journey, random)
    } else if (journey.phase === 'chest') collectChest(journey, random)
    else if (journey.phase === 'levelUp') chooseCard(journey, cardChoice(journey), random)
    if (journey.descent.floor > 200) break
  }
  const run = journey.descent
  return { seed, fights, deathKind: run.enemy.kind, killer: run.enemy.name, floor: run.floor, level: run.level, bells: run.bells, evolutions: run.evolutions, ready: readyEvolutions(journey).length,
    items: Object.values(run.items).map(item => `${rules.catalog.items[item.type].name} ${item.level}`).join(', ') }
}

const results = Array.from({ length: runs }, (_, index) => playRun(index + 1))
for (const result of results) console.log(`seed ${result.seed}: floor ${result.floor} (${result.killer}) · level ${result.level} · bells ${result.bells} · evolutions ${result.evolutions} · ${result.items}`)
const floors = results.map(result => result.floor).sort((first, second) => first - second)
console.log(`median floor ${floors[Math.floor(floors.length / 2)]} · min ${floors[0]} · max ${floors.at(-1)}`)

// Per floor kind: how long fights last and how much of the hero's health they take. A smooth curve has normal floors cost something.
const average = list => list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0
for (const kind of ['normal', 'elite', 'boss']) {
  const fights = results.flatMap(result => result.fights).filter(fight => fight.kind === kind)
  const deaths = results.filter(result => result.deathKind === kind).length
  console.log(`${kind}: ${fights.length} fights · ${average(fights.map(fight => fight.cycles)).toFixed(1)} cycles · ${Math.round(100 * average(fights.map(fight => (fight.start - fight.end) / fight.max)))}% HP lost · ${deaths} deaths`)
}
for (const from of [1, 11, 21, 31]) {
  const fights = results.flatMap(result => result.fights).filter(fight => fight.kind === 'normal' && fight.floor >= from && fight.floor < from + 10)
  if (fights.length) console.log(`normal floors ${from}-${from + 9}: ${fights.length} fights · ${Math.round(100 * average(fights.map(fight => (fight.start - fight.end) / fight.max)))}% HP lost · start at ${Math.round(100 * average(fights.map(fight => fight.start / fight.max)))}% HP`)
}
