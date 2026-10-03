/** Bounded search measures candidates instead of assuming budget predicts power linearly. */
import { generateLoadout } from './loadouts.js'
import { evaluateLoadout } from './simulation.js'

export function referenceLoadouts() {
  return [{ recipe: 'poison', budget: 5 }, { recipe: 'defender', budget: 8 }, { recipe: 'hunger', budget: 7 }].map(request => generateLoadout({ ...request, seed: 1 }))
}

/** Report invalid budgets explicitly; rank valid candidates by distance from the requested win rate. */
export function searchLoadouts({ recipes = ['poison', 'defender', 'hunger'], budgets = [8, 10, 12], seeds = [1, 2, 3], targetWinRate = 0.5, maxCycles = 30, references = referenceLoadouts() } = {}) {
  if (![recipes, budgets, seeds].every(values => Array.isArray(values) && values.length) || recipes.length * budgets.length * seeds.length > 128) throw new RangeError('Search requires 1–128 candidate requests')
  if (!Number.isFinite(targetWinRate) || targetWinRate < 0 || targetWinRate > 1 || !Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 100) throw new RangeError('Invalid search target or cycle limit')
  const candidates = [], rejected = [], seen = new Map()
  let simulated = 0
  for (const recipe of recipes) for (const budget of budgets) for (const seed of seeds) {
    let loadout
    try { loadout = generateLoadout({ recipe, budget, seed }) }
    catch (error) { rejected.push({ recipe, budget, seed, reason: error.message }); continue }
    const identity = JSON.stringify({ actor: loadout.actor, items: loadout.items })
    let report = seen.get(identity)
    if (!report) {
      report = evaluateLoadout(loadout, references, { maxCycles })
      seen.set(identity, report)
      simulated += report.matches.length
    }
    candidates.push({ loadout, report, distance: Math.abs(report.winRate - targetWinRate) })
  }
  candidates.sort((first, second) => first.distance - second.distance || first.loadout.cost - second.loadout.cost)
  return { version: 1, targetWinRate, maxCycles, references, simulated, uniqueLoadouts: seen.size, candidates, rejected }
}
