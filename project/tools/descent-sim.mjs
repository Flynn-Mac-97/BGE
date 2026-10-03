/**
 * Plays seeded Descent runs with a simple bot and the real resolver, and prints how deep each got.
 * `node tools/descent-sim.mjs [runs] [crew] [tower ranks as JSON]`. A balance probe, not a measure of fun.
 */
import { rules, itemReference } from '../plugins/bell/rules.js'
import { createRun, finishFloor, collectChest, chooseCard, readyEvolutions, recipeFor } from '../plugins/bell/descent/run.js'
import { evolutionRecipes } from '../plugins/bell/descent/evolutions.js'
import { seededRandom } from '../plugins/npc-lab/combo-space.js'

const runs = Number(process.argv[2] ?? 12)
const crew = process.argv[3] ?? 'rook'
const tower = JSON.parse(process.argv[4] ?? '{}')

/** Positions where an item fits, scored by how many evolution partners it would touch. */
function bestPlace(battle, id) {
  let best = null
  for (let y = 0; y < battle.grid.rows; y++) for (let x = 0; x < battle.grid.columns; x++) {
    const trial = structuredClone(battle)
    if (!rules.place(trial, id, [x, y])) continue
    const type = trial.items[id].type
    const touching = rules.targets(trial, itemReference(id), { kind: 'adjacentItems', ownerOnly: true }).map(target => trial.items[target.id].type)
    const score = touching.filter(other => evolutionRecipes.some(recipe => (recipe.from === type && recipe.partner === other) || (recipe.partner === type && recipe.from === other))).length
    if (!best || score > best.score) best = { position: [x, y], score }
  }
  return best?.position ?? null
}

function placeReserve(journey) {
  for (const item of Object.values(journey.battle.items)) if (!item.position) {
    const position = bestPlace(journey.battle, item.id)
    if (position) rules.place(journey.battle, item.id, position)
  }
}

/** Prefer a new item while the kit is small, then levels toward an evolution, then any level. */
function cardChoice(run) {
  const owned = new Set(Object.values(run.items).map(item => item.type))
  const score = card => {
    if (card.kind === 'item') return Object.keys(run.items).length < 5 ? 30 : 8
    if (card.kind === 'widen') return Object.keys(run.items).length > run.columns * 2 ? 25 : 2
    if (card.kind === 'mend') return 1
    const item = run.items[card.id]
    const recipe = recipeFor(item.type)
    return 10 + (recipe && owned.has(recipe.partner) ? 10 : 0) + (rules.catalog.items[item.type].tags.includes('weapon') ? 4 : 0)
  }
  return run.cards.map((card, index) => ({ index, score: score(card) })).sort((first, second) => second.score - first.score)[0].index
}

function playRun(seed) {
  const random = seededRandom(seed)
  const journey = createRun({ tower }, crew, random)
  let guard = 0
  while (journey.phase !== 'dead' && guard++ < 5000) {
    if (journey.phase === 'battle') {
      placeReserve(journey)
      journey.battle = rules.resolveCycle(journey.battle, { afterCycle: ['enemy'] }).state
      finishFloor(journey, random)
    } else if (journey.phase === 'chest') collectChest(journey, random)
    else if (journey.phase === 'levelUp') chooseCard(journey, cardChoice(journey.descent), random)
    if (journey.descent.floor > 200) break
  }
  const run = journey.descent
  return { seed, killer: run.enemy.name, floor: run.floor, level: run.level, bells: run.bells, evolutions: run.evolutions, ready: readyEvolutions(journey).length,
    items: Object.values(run.items).map(item => `${rules.catalog.items[item.type].name} ${item.level}`).join(', ') }
}

const results = Array.from({ length: runs }, (_, index) => playRun(index + 1))
for (const result of results) console.log(`seed ${result.seed}: floor ${result.floor} (${result.killer}) · level ${result.level} · bells ${result.bells} · evolutions ${result.evolutions} · ${result.items}`)
const floors = results.map(result => result.floor).sort((first, second) => first - second)
console.log(`median floor ${floors[Math.floor(floors.length / 2)]} · min ${floors[0]} · max ${floors.at(-1)}`)
