/**
 * Plays seeded Descent runs with the test-bout bot (`descent-bot.mjs`) and the real resolver, and prints how deep each got.
 * `node tools/descent-sim.mjs [runs] [crew] [tower ranks as JSON]`. A balance probe, not a measure of fun.
 * Each run plays in its own worker thread, as many at once as the machine has cores; the seeds make the output the same either way.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { availableParallelism } from 'node:os'
import { rules } from '../plugins/bell/rules.js'
import { readyEvolutions } from '../plugins/bell/descent/run.js'
import { playRun } from './descent-play.mjs'

function summary({ seed, crew, tower }) {
  const { journey, fights } = playRun({ tower }, crew, seed)
  const run = journey.descent
  return { seed, fights, deathKind: run.enemy.kind, killer: run.enemy.name, floor: run.floor, level: run.level, bells: run.bells, evolutions: run.evolutions, ready: readyEvolutions(journey).length,
    items: Object.values(run.items).map(item => `${rules.catalog.items[item.type].name} ${item.level}`).join(', ') }
}

/** Play every seed, a worker per run and at most one worker per core; results come back in seed order. */
async function playAll(runs, crew, tower) {
  const results = []
  let next = 1
  const playNext = async () => {
    while (next <= runs) {
      const seed = next++
      results[seed - 1] = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), { workerData: { seed, crew, tower } })
        worker.once('message', resolve)
        worker.once('error', reject)
      })
    }
  }
  await Promise.all(Array.from({ length: Math.min(runs, availableParallelism()) }, playNext))
  return results
}

if (!isMainThread) parentPort.postMessage(summary(workerData))
else await report(Number(process.argv[2] ?? 12), process.argv[3] ?? 'rook', JSON.parse(process.argv[4] ?? '{}'))

async function report(runs, crew, tower) {
  const results = await playAll(runs, crew, tower)
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

  // Who kills the foe, by depth band: the share of all damage to foes from weapons, poison, other statuses, tiring and other items.
  const sources = ['weapon', 'poison', 'status', 'tire', 'other']
  for (const from of [1, 11, 21, 31, 41, 51]) {
    const fights = results.flatMap(result => result.fights).filter(fight => fight.floor >= from && fight.floor < from + 10)
    const totals = Object.fromEntries(sources.map(source => [source, fights.reduce((sum, fight) => sum + (fight.damage[source] ?? 0), 0)]))
    const all = Object.values(totals).reduce((sum, value) => sum + value, 0)
    if (all) console.log(`damage floors ${from}-${from + 9}: ${sources.map(source => `${source} ${Math.round(100 * totals[source] / all)}%`).join(' · ')} · ${average(fights.map(fight => fight.cycles)).toFixed(1)} cycles`)
  }

  // Power spikes: a normal fight that takes at most half the cycles of the run's last three normal fights (when those took 3 or more).
  const spikesOf = result => result.fights.filter(fight => fight.kind === 'normal').filter((fight, index, normals) => {
    const before = normals.slice(Math.max(0, index - 3), index).map(previous => previous.cycles).sort((first, second) => first - second)
    return before.length === 3 && before[1] >= 3 && fight.cycles <= before[1] / 2
  }).length
  console.log(`power spikes per run: ${results.map(spikesOf).join(', ')}`)
}
