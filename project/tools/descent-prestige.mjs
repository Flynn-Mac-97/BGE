/**
 * Plays Descent runs in a row on one profile, as a player chasing their wall would: after each death the Bells are
 * banked and spent on the cheapest Bell Tower rank until none is affordable, and item mastery carries over.
 * `node tools/descent-prestige.mjs [runs] [crew] [seed]` prints one line per run. A balance probe for the prestige curve.
 */
import { settleRun, buyUpgrade, createProfile } from '../plugins/bell/descent/profile-save.js'
import { towerUpgrades, upgradeCost } from '../plugins/bell/descent/tower.js'
import { masteryLevel } from '../plugins/bell/descent/mastery.js'
import { rules } from '../plugins/bell/rules.js'
import { playRun } from './descent-play.mjs'

const runs = Number(process.argv[2] ?? 15)
const crew = process.argv[3] ?? 'rook'
const firstSeed = Number(process.argv[4] ?? 1)

/** Buy the cheapest rank on offer until no rank is affordable. Returns the ranks bought. */
function spendBells(profile) {
  const bought = []
  for (;;) {
    const offers = Object.keys(towerUpgrades).map(id => ({ id, cost: upgradeCost(id, profile.tower[id] ?? 0) })).filter(offer => offer.cost !== null && offer.cost <= profile.bells)
    if (!offers.length) return bought
    const cheapest = offers.sort((first, second) => first.cost - second.cost)[0]
    buyUpgrade(profile, cheapest.id)
    bought.push(cheapest.id)
  }
}

const profile = createProfile()
for (let index = 0; index < runs; index++) {
  const { journey } = playRun(profile, crew, firstSeed + index)
  const banked = settleRun(profile, journey)
  const bought = spendBells(profile)
  const masters = Object.entries(profile.mastery).map(([type, xp]) => [type, masteryLevel(xp)]).filter(([, level]) => level).sort((first, second) => second[1] - first[1]).slice(0, 3)
  console.log(`run ${index + 1}: floor ${journey.descent.floor} · +${banked} Bells · best ${profile.bestFloor} · bought ${bought.length} · tower ${Object.entries(profile.tower).map(([id, rank]) => `${id} ${rank}`).join(', ')} · mastery ${masters.map(([type, level]) => `${rules.catalog.items[type].name} ✦${level}`).join(', ') || 'none'}`)
}
