/** Write a reproducible combo-discovery report; elapsed time remains outside deterministic results. */
import { performance } from 'node:perf_hooks'
import { writeFile } from 'node:fs/promises'
import { searchCombos } from '../plugins/npc-lab/combo-search.js'
const start = performance.now()
const report = searchCombos()
const milliseconds = Math.round(performance.now() - start)
const output = process.argv[2] ?? 'combo-report.json'
await writeFile(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ output, milliseconds, counts: report.counts, mutations: report.mutations, discoveries: report.discoveries.map(candidate => ({ score: candidate.score, trainingWins: candidate.report.winRate, holdoutWins: candidate.holdout?.winRate, cost: candidate.cost, items: candidate.kit.items })) }))
