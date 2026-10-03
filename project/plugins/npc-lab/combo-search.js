/** Bounded evolutionary discovery separates optimisation, holdout measurement and explanatory ablations. */
import { rules } from '../bell/rules.js'
import { actors, costs } from './definitions.js'
import { generateLoadout, validateLoadout } from './loadouts.js'
import { evaluateLoadout } from './simulation.js'
import { referenceLoadouts } from './search.js'
import { canonicalKit, kitIdentity, seededRandom, acceptsKit, mutateKit, searchSettings } from './combo-space.js'
import { objectives, scoreReport } from './combo-score.js'

function checkRosters(training, holdout) {
  for (const roster of [training, holdout]) {
    if (!Array.isArray(roster) || !roster.length || roster.length > 8 || roster.some(kit => !validateLoadout(kit).valid)) throw new TypeError('Use 1–8 valid kits in each roster')
  }
  const trainingKeys = new Set(training.map(kitIdentity))
  if (holdout.some(kit => trainingKeys.has(kitIdentity(kit)))) throw new TypeError('Holdout kits must differ from training kits')
}
const defaultHoldouts = () => ['poison', 'defender', 'hunger'].map(recipe => generateLoadout({ recipe, budget: 12, seed: 90001 }))

/** Return exact loadouts, provenance and replay requests; no game run or authoring definition is changed. */
export function searchCombos(request = {}) {
  const { training = referenceLoadouts(), holdout = defaultHoldouts(), ...options } = request
  const settings = searchSettings(options)
  if (!objectives.includes(settings.objective)) throw new TypeError('Unknown search objective')
  checkRosters(training, holdout)
  const random = seededRandom(settings.seed), seen = new Set(), archive = [], failures = []
  const counts = { attempts: 0, invalid: 0, duplicate: 0, evaluated: 0, trainingFights: 0, holdoutFights: 0, ablationFights: 0 }
  const mutations = { seed: 0, add: 0, remove: 0, replace: 0, move: 0, swap: 0 }
  const measure = (kit, provenance) => {
    if (counts.evaluated >= settings.evaluations) return
    counts.attempts++
    if (!acceptsKit(kit, settings)) { counts.invalid++; return }
    const identity = kitIdentity(kit)
    if (seen.has(identity)) { counts.duplicate++; return }
    seen.add(identity); counts.evaluated++; mutations[provenance.operation]++
    try {
      const report = evaluateLoadout(kit, training, { maxCycles: settings.maxCycles })
      counts.trainingFights += report.matches.length
      const cost = validateLoadout(kit).cost
      archive.push({ id: archive.length, kit, cost, score: scoreReport(report, cost, settings.objective), report, provenance })
    } catch (error) { failures.push({ kit, provenance, error: error.message }) }
  }
  measure(canonicalKit({ actor: settings.actor, items: [] }), { operation: 'seed', parent: null })
  for (const kit of training) measure(canonicalKit({ ...kit, actor: settings.actor }), { operation: 'seed', parent: null })
  const attemptLimit = settings.evaluations * 32
  while (counts.evaluated < settings.evaluations && counts.attempts < attemptLimit) {
    const ranked = [...archive].sort((first, second) => second.score - first.score || first.id - second.id)
    if (!ranked.length) break
    // Half of parents come from the entire archive so low-scoring intermediate chains can survive.
    const population = random() < 0.5 ? ranked.slice(0, 8) : archive
    const parent = population[Math.floor(random() * population.length)]
    const candidate = mutateKit(parent.kit, settings, random)
    measure(candidate.kit, { operation: candidate.operation, parent: parent.id })
  }
  const ranked = [...archive].sort((first, second) => second.score - first.score || first.cost - second.cost || first.id - second.id)
  const discoveries = ranked.slice(0, settings.finalists).map(candidate => {
    let held
    try { held = evaluateLoadout(candidate.kit, holdout, { maxCycles: settings.maxCycles }) }
    catch (error) { return { ...candidate, holdoutError: error.message, removals: [] } }
    counts.holdoutFights += held.matches.length
    const holdoutScore = scoreReport(held, candidate.cost, settings.objective)
    const removals = candidate.kit.items.map(item => {
      const kit = canonicalKit({ ...candidate.kit, items: candidate.kit.items.filter(other => other.key !== item.key) })
      const validation = validateLoadout(kit)
      if (!validation.valid) return { removed: item, skipped: validation.errors }
      let report
      try { report = evaluateLoadout(kit, holdout, { maxCycles: settings.maxCycles }) }
      catch (error) { return { removed: item, skipped: [error.message] } }
      counts.ablationFights += report.matches.length
      return { removed: item, cost: validation.cost, scoreDelta: holdoutScore - scoreReport(report, validation.cost, settings.objective), winRateDelta: held.winRate - report.winRate, report }
    })
    return { ...candidate, holdout: held, holdoutScore, removals, replayRequest: { first: candidate.kit, second: holdout[0], options: { firstActor: 'first', maxCycles: settings.maxCycles, replay: true } } }
  })
  return { version: 1, method: 'bounded-mutation-search', authoring: structuredClone({ catalog: rules.catalog, actors, costs }), settings, training, holdout, counts, mutations,
    stopReason: counts.evaluated >= settings.evaluations ? 'evaluation-limit' : 'attempt-limit', discoveries, archive, failures }
}
