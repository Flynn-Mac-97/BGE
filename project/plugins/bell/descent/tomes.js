/** Tomes: spend run Bells before a fight for small boosts that last the run. Bells spent here do not come home. */
import { tuning } from './tuning.js'
import { battleFor, keepPlaces } from './run.js'

/** The price of the next Tome of Vigor, or of the next Tome of Might for one item. */
export const tomePrice = (run, kind, id) => {
  const tome = tuning.tomes[kind]
  const bought = kind === 'vigor' ? run.tomes?.vigor ?? 0 : run.items[id]?.tomes ?? 0
  return tome.price + tome.priceStep * bought
}

/** True while tomes can be bought: a floor that has not started fighting. */
export const canBuyTomes = journey => Boolean(journey.descent) && journey.phase === 'battle' && !journey.battle.started

const apply = {
  vigor: run => { run.tomes = { ...run.tomes, vigor: (run.tomes?.vigor ?? 0) + 1 }; run.health += tuning.tomes.vigor.health },
  might: (run, id) => { run.items[id].tomes = (run.items[id].tomes ?? 0) + 1 }
}

/** Buy one tome ('vigor', or 'might' for item `id`). Rebuilds the floor's battle so the boost shows at once. */
export function buyTome(journey, kind, id) {
  const run = journey.descent
  if (!canBuyTomes(journey) || !apply[kind] || (kind === 'might' && !run.items[id])) return false
  const price = tomePrice(run, kind, id)
  if (run.bells < price) return false
  keepPlaces(journey)
  run.bells -= price
  apply[kind](run, id)
  journey.battle = battleFor(run)
  return true
}
