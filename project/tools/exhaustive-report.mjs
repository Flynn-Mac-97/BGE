/** Checkpoint exact searches in batches; source hashes prevent resuming across changed combat code. */
import { readFile, writeFile, rename, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { exhaustiveBatch } from '../plugins/npc-lab/exhaustive.js'
import { enumerateLoadouts } from '../plugins/npc-lab/enumeration.js'
import { generateLoadout } from '../plugins/npc-lab/loadouts.js'
import { evaluateLoadout, simulateDuel } from '../plugins/npc-lab/simulation.js'
const output = process.argv[2] ?? 'exhaustive-report.json'
const request = process.argv[3] ? JSON.parse(await readFile(process.argv[3], 'utf8')) : { settings: { pool: ['dagger', 'sword', 'venom', 'stone', 'tooth', 'echo', 'buckler', 'salve'], budget: 10, maxItems: 3, duplicateLimit: 2 }, maxCycles: 30 }
const root = fileURLToPath(new URL('../plugins/', import.meta.url)), hash = createHash('sha256')
for (const path of (await readdir(root, { recursive: true })).filter(path => path.endsWith('.js')).sort()) { hash.update(path); hash.update(await readFile(root + path)) }
const sourceHash = hash.digest('hex'), checkpointPath = output + '.checkpoint.json'
let checkpoint = null
try {
  const saved = JSON.parse(await readFile(checkpointPath, 'utf8'))
  if (saved.sourceHash !== sourceHash || JSON.stringify(saved.request) !== JSON.stringify(request)) throw new Error('Checkpoint source or request changed; use a new output path')
  checkpoint = saved.progress
} catch (error) { if (error.code !== 'ENOENT') throw error }
const started = performance.now()
let total = 0
for (const ignored of enumerateLoadouts(request.settings)) total++
console.log(JSON.stringify({ total, resumed: checkpoint?.nextIndex ?? 0, sourceHash }))
do {
  checkpoint = exhaustiveBatch({ ...request, limit: 256, checkpoint })
  await writeFile(checkpointPath + '.tmp', JSON.stringify({ sourceHash, request, progress: checkpoint }))
  await rename(checkpointPath + '.tmp', checkpointPath)
  console.log(JSON.stringify({ tested: checkpoint.nextIndex, total, fights: checkpoint.simulated, complete: checkpoint.complete, failures: checkpoint.failures, seconds: Math.round((performance.now() - started) / 1000) }))
} while (!checkpoint.complete)
const { identity, ...results } = checkpoint
const experiment = JSON.parse(identity), best = results.top[0]
const holdouts = ['poison', 'defender', 'hunger'].map(recipe => generateLoadout({ recipe, budget: 12, seed: 90001 }))
const holdout = best ? evaluateLoadout(best.kit, holdouts, { maxCycles: experiment.maxCycles }) : null
const match = holdout?.matches.find(match => match.winner !== 'first') ?? holdout?.matches[0]
const replayRequest = match ? { first: best.kit, second: holdouts[match.reference], options: { firstActor: match.firstActor, maxCycles: experiment.maxCycles, replay: true } } : null
const report = { sourceHash, experiment, total, ...results, allSimulationsSucceeded: results.failures === 0, holdouts, holdout, replayRequest }
await writeFile(output, JSON.stringify(report, null, 2) + '\n')
if (replayRequest) await writeFile(output + '.replay.json', JSON.stringify(simulateDuel(replayRequest.first, replayRequest.second, replayRequest.options), null, 2) + '\n')
console.log(JSON.stringify({ output, complete: report.complete, tested: report.nextIndex, failures: report.failures, best: best && { items: best.kit.items, cost: best.cost, score: best.score, wins: best.report.wins, matches: best.report.matches.length }, holdoutWins: holdout?.wins }))
