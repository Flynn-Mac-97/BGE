/** Resumable exact enumeration runs the production resolver through full cycles for both initiatives. */
import { rules } from '../bell/rules.js'
import { actors, costs } from './definitions.js'
import { validateLoadout } from './loadouts.js'
import { createEvaluator } from './simulation.js'
import { referenceLoadouts } from './search.js'
import { objectives, scoreReport } from './combo-score.js'
import { enumerationSettings, enumerateLoadouts } from './enumeration.js'

/** A checkpoint is valid only with identical authoring, opponents and search constraints. */
export function exhaustiveBatch({ settings: request = {}, references = referenceLoadouts(), objective = 'strength', maxCycles = 30, limit = 256, checkpoint = null } = {}) {
  const settings = enumerationSettings(request)
  if (!objectives.includes(objective) || !Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 100 || !Number.isInteger(limit) || limit < 1 || limit > 2000) throw new RangeError('Invalid exhaustive run limits')
  if (!Array.isArray(references) || !references.length || references.length > 8 || references.some(kit => !validateLoadout(kit).valid)) throw new TypeError('Use 1–8 valid references')
  const experiment = { settings, references, objective, maxCycles, authoring: { catalog: rules.catalog, actors, costs } }
  const identity = JSON.stringify(experiment)
  if (checkpoint && (checkpoint.version !== 1 || checkpoint.identity !== identity || !Number.isInteger(checkpoint.nextIndex) || checkpoint.nextIndex < 0)) throw new TypeError('Checkpoint does not match this experiment')
  const progress = checkpoint ? structuredClone(checkpoint) : { version: 1, identity, nextIndex: 0, complete: false, simulated: 0, failures: 0, failureExamples: [], stalemates: 0, draws: 0, top: [] }
  if (progress.complete) return progress
  const evaluate = createEvaluator(references, { maxCycles })
  let index = 0, evaluated = 0
  progress.complete = true
  for (const candidate of enumerateLoadouts(settings)) {
    const ordinal = index++
    if (ordinal < progress.nextIndex) continue
    if (evaluated === limit) { progress.complete = false; break }
    try {
      const report = evaluate(candidate.kit)
      progress.simulated += report.matches.length; progress.stalemates += report.stalemates; progress.draws += report.draws
      const entry = { ordinal, ...candidate, score: scoreReport(report, candidate.cost, objective), report }
      progress.top.push(entry)
      progress.top.sort((first, second) => second.score - first.score || first.cost - second.cost || first.ordinal - second.ordinal)
      progress.top.length = Math.min(5, progress.top.length)
    } catch (error) {
      progress.failures++
      if (progress.failureExamples.length < 20) progress.failureExamples.push({ ordinal, ...candidate, error: error.message })
    }
    evaluated++; progress.nextIndex++
  }
  return progress
}
