/** Repeatable playthroughs earn every reward; a bounded placement search stands in for a player. */
import { performance } from 'node:perf_hooks'
import { rules } from '../plugins/bell/rules.js'
import { createJourney, finishBattle, claim, searchCache } from '../plugins/bell/loop.js'
function seeded(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 } }
function score(battle) {
  let preview = structuredClone(battle)
  preview.actors.recruit.health = Math.min(preview.actors.recruit.health, 8)
  for (let cycle = 0; cycle < 3; cycle++) {
    preview = rules.resolveCycle(preview, { afterCycle: ['enemy'] }).state
    if (rules.winner(preview)) break
  }
  const winner = rules.winner(preview)
  return (winner === 'crew' ? 500 : winner ? -500 : 0) + preview.actors.recruit.health * 5 - preview.actors.enemy.health * 4 - (preview.actors.recruit.statuses.poison?.stacks ?? 0) * 3
}
function arrange(battle) {
  let best = structuredClone(battle), bestScore = score(best)
  for (let pass = 0; pass < 2; pass++) {
    let improved = false
    for (const id of Object.keys(best.items)) {
      for (let cell = -1; cell < best.grid.columns * 3; cell++) {
        const candidate = structuredClone(best)
        if (!rules.place(candidate, id, cell < 0 ? null : [cell % best.grid.columns, Math.floor(cell / best.grid.columns)])) continue
        const value = score(candidate)
        if (value <= bestScore) continue
        best = candidate; bestScore = value; improved = true
      }
    }
    if (!improved) break
  }
  return { battle: best, score: bestScore }
}
function choose(journey, strategy) {
  if (strategy === 'ignore') { claim(journey, journey.choices[0]); return }
  const candidates = journey.choices.map(type => {
    const candidate = structuredClone(journey)
    claim(candidate, type)
    return { type, ...arrange(candidate.battle) }
  }).sort((first, second) => second.score - first.score)
  claim(journey, candidates[0].type)
  journey.battle = candidates[0].battle
}
export function playthrough(seed, strategy = 'build', limit = 12) {
  const random = seeded(seed), journey = createJourney(), rooms = []
  const started = performance.now()
  while (journey.room <= limit && journey.phase !== 'defeat') {
    let cycles = 0
    while (journey.phase === 'battle' && cycles++ < 31) {
      journey.battle = rules.resolveCycle(journey.battle, { afterCycle: ['enemy'] }).state
      finishBattle(journey, random)
    }
    rooms.push({ room: journey.room, outcome: journey.phase, health: journey.battle.actors.recruit.health, cycles, equipped: Object.values(journey.battle.items).filter(item => item.position).map(item => item.type), choices: journey.choices })
    if (journey.phase !== 'reward') break
    choose(journey, strategy)
    if (strategy !== 'ignore' && searchCache(journey, random)) choose(journey, strategy)
  }
  return { seed, strategy, cleared: journey.cleared, room: journey.room, phase: journey.phase, owned: Object.keys(journey.battle.items).length, seconds: Math.round((performance.now() - started) / 1000), rooms }
}
if (process.argv[1]?.endsWith('/playthrough.mjs')) {
  for (const [seed, strategy] of [[7, 'ignore'], [7, 'build'], [19, 'build'], [41, 'build']]) console.log(JSON.stringify(playthrough(seed, strategy)))
}
