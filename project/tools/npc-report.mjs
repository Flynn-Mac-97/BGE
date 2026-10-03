/** Produce an inspectable deterministic search report; wall-clock throughput is separate metadata. */
import { writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { searchLoadouts } from '../plugins/npc-lab/search.js'
const started = performance.now()
const report = searchLoadouts()
const milliseconds = performance.now() - started
const output = process.argv[2] ?? 'npc-report.json'
await writeFile(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ output, candidates: report.candidates.length, uniqueLoadouts: report.uniqueLoadouts, fights: report.simulated, milliseconds: Math.round(milliseconds), fightsPerSecond: Math.round(report.simulated * 1000 / milliseconds), best: report.candidates.slice(0, 3).map(candidate => ({ recipe: candidate.loadout.recipe, seed: candidate.loadout.seed, cost: candidate.loadout.cost, winRate: candidate.report.winRate })) }))
