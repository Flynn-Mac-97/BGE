/**
 * Plays one seeded Descent run to its end with the test-bout bot and the real resolver. Shared by `descent-sim.mjs`
 * (many fresh runs) and `descent-prestige.mjs` (runs in a row on one profile).
 *   playRun(profile, crew, seed) → { journey, fights: [{ kind, floor, start, end, max, cycles, damage }] }
 * `damage` is the fight's damage to the foe by source: `{ weapon, poison, status, tire, other }`, each present once it deals any (see `damageSource`).
 */
import { rules } from '../plugins/bell/rules.js'
import { createRun, finishFloor, collectChest, chooseCard, readyItem, armReadied, chargesLeft, trainItem, leavePeddler } from '../plugins/bell/descent/run.js'
import { seededRandom } from '../plugins/npc-lab/combo-space.js'
import { arrange, cardChoice, trainChoice, shop } from './descent-bot.mjs'

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

/** What dealt a traced damage effect: poison, another status tick, the foe's own tiring, a weapon, or anything else. */
function damageSource(battle, step) {
  if (step.statusId) return step.statusId === 'poison' ? 'poison' : 'status'
  if (step.ability?.id === 'tire') return 'tire'
  const item = step.source?.kind === 'item' ? battle.items[step.source.id] : null
  return item && rules.catalog.items[item.type]?.tags.includes('weapon') ? 'weapon' : 'other'
}

/** Add one cycle's damage to the foe into `damage`, by source. */
function addFoeDamage(damage, battle, trace) {
  for (const step of trace) {
    for (const effect of step.effects ?? []) {
      if (effect.type !== 'damage' || effect.target?.id !== 'enemy' || !effect.amount) continue
      const source = damageSource(battle, step)
      damage[source] = (damage[source] ?? 0) + effect.amount
    }
  }
}

/** Play a run for `crew` on `profile` (read only) until it dies. */
export function playRun(profile, crew, seed) {
  const random = seededRandom(seed)
  const journey = createRun(profile, crew, random)
  let guard = 0
  const fights = []
  while (journey.phase !== 'dead' && guard++ < 5000) {
    if (journey.phase === 'battle') {
      arrange(journey)
      const kind = journey.descent.enemy.kind, hero = journey.battle.actors.recruit
      if (!journey.battle.started) fights.push({ kind, floor: journey.descent.floor, start: hero.health, max: hero.maxHealth, damage: {} })
      tapConsumables(journey)
      const fight = fights.at(-1)
      const cycle = rules.resolveCycle(journey.battle, { afterCycle: ['enemy'], trace: 'events' })
      addFoeDamage(fight.damage, journey.battle, cycle.trace)
      journey.battle = cycle.state
      Object.assign(fight, { cycles: journey.battle.cycle, end: Math.max(0, journey.battle.actors.recruit.health) })
      finishFloor(journey, random)
    } else if (journey.phase === 'chest') collectChest(journey, random)
    else if (journey.phase === 'levelUp') chooseCard(journey, cardChoice(journey), random)
    else if (journey.phase === 'train') trainItem(journey, trainChoice(journey), random)
    else if (journey.phase === 'peddler') { shop(journey); leavePeddler(journey, random) }
    if (journey.descent.floor > 200) break
  }
  return { journey, fights }
}
