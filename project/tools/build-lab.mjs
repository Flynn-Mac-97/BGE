/**
 * Build Lab: searches for the strongest Descent builds and measures why they are strong. A by-hand balance tool.
 *
 *   node tools/build-lab.mjs search <family|open> [evaluations] [seed]   one search; prints JSON lines of every build tried
 *   node tools/build-lab.mjs run [evaluations]                           all six searches in parallel, then the report
 *   node tools/build-lab.mjs report                                      the report again from the last run's builds.json
 *
 * A build is 7 base items (no evolved ones: those are earned), all at level `LEVEL`, laid out by the test-bout bot
 * (`descent-bot.mjs`). It fights the gauntlet: one enemy per threat, plus a boss with three threats. Against each it climbs
 * `FLOORS` until it loses; its depth is the last floor won plus the share of the losing foe's health it removed × the step.
 * A build's score is its mean depth, and its worst depth is kept too. A family search keeps at least 3 items of that
 * family. The report is written to agent-runs/build-lab/.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { rules } from '../plugins/bell/rules.js'
import { createRun, battleFor, keepPlaces, maxHealthOf } from '../plugins/bell/descent/run.js'
import { createProfile } from '../plugins/bell/descent/profile-save.js'
import { descentPool } from '../plugins/bell/descent/pool.js'
import { enemyTraits } from '../plugins/bell/descent/enemies.js'
import { familyOf, powerFamilies } from '../plugins/bell/power-families.js'
import { seededRandom } from '../plugins/npc-lab/combo-space.js'
import { arrange } from './descent-bot.mjs'

const LEVEL = 8, RUN_LEVEL = 17, BUILD_SIZE = 7, FAMILY_MINIMUM = 3, CYCLE_CAP = 30
const FLOORS = [14, 20, 26, 32, 38, 44, 50, 56, 62, 68]
const pool = descentPool.filter(type => !rules.catalog.items[type].storage)
const plain = { name: 'Plain', portrait: 'cellarRat', health: 9, damage: 2, line: '' }
/** The gauntlet: a plain foe, one foe per threat, and a boss with three threats. */
export const gauntlet = [
  { ...plain, kind: 'normal', traits: [] },
  ...['heavyBlow', 'plated', 'purifier', 'swarm', 'regrowth', 'spiked'].map(id => ({ ...plain, name: enemyTraits[id].name, kind: 'normal', traits: [id] })),
  { ...plain, name: 'Boss', kind: 'boss', health: 13, damage: 3, traits: ['heavyBlow', 'plated', 'purifier'] }
]

/** A run holding exactly these item types, laid out by the bot against a plain foe. */
function runFor(types) {
  const journey = createRun(createProfile(), 'rook', seededRandom(1))
  const run = journey.descent
  run.floor = FLOORS[0]; run.level = RUN_LEVEL; run.columns = 5
  run.items = Object.fromEntries(types.map((type, index) => [`item-${index + 1}`, { type, level: LEVEL, position: null }]))
  run.enemy = gauntlet[0]
  journey.battle = battleFor(run)
  arrange(journey)
  keepPlaces(journey)
  return run
}

/** One fight to the end at a floor, from full health: `{ isWin, removed }`, removed being the share of the foe's health taken. */
function fightAt(run, enemy, floor) {
  run.enemy = enemy; run.floor = floor
  run.health = maxHealthOf(run)
  let battle = battleFor(run)
  while (!rules.winner(battle) && battle.cycle <= CYCLE_CAP) battle = rules.resolveCycle(battle, { afterCycle: ['enemy'] }).state
  const foe = battle.actors.enemy
  return { isWin: rules.winner(battle) === 'crew', removed: 1 - Math.max(0, foe.health) / foe.maxHealth }
}

/** How deep a build gets against one foe: the last floor won, plus partial credit in the floor it lost. */
function fightOne(run, enemy) {
  let depth = 0
  for (const [index, floor] of FLOORS.entries()) {
    const fight = fightAt(run, enemy, floor)
    const step = floor - (FLOORS[index - 1] ?? 0)
    if (!fight.isWin) return { score: Math.round((depth + step * fight.removed) * 10) / 10 }
    depth = floor
  }
  return { score: depth }
}

/** A build's measurement: score, worst fight, and each fight by enemy name. */
export function measure(types) {
  const run = runFor(types)
  const fights = Object.fromEntries(gauntlet.map(enemy => [enemy.name, fightOne(run, enemy)]))
  const scores = Object.values(fights).map(fight => fight.score)
  return { types: [...types].sort(), placed: Object.values(run.items).filter(item => item.position).length, score: Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length * 10) / 10, worst: Math.min(...scores), fights }
}

const familyCount = (types, family) => types.filter(type => familyOf(rules.catalog.items[type]) === family).length
const pick = (list, random) => list[Math.floor(random() * list.length)]

/** A random build that meets the search's rule. */
function randomBuild(family, random) {
  const types = []
  const ofFamily = pool.filter(type => familyOf(rules.catalog.items[type]) === family)
  while (family !== 'open' && types.length < FAMILY_MINIMUM + Math.floor(random() * 3)) { const type = pick(ofFamily, random); if (!types.includes(type)) types.push(type) }
  while (types.length < BUILD_SIZE) { const type = pick(pool, random); if (!types.includes(type)) types.push(type) }
  return types
}

/** Replace one item, keeping the family rule. */
function mutate(types, family, random) {
  for (;;) {
    const next = [...types], replacement = pick(pool, random)
    if (next.includes(replacement)) continue
    next[Math.floor(random() * next.length)] = replacement
    if (family === 'open' || familyCount(next, family) >= FAMILY_MINIMUM) return next
  }
}

/** Hill-climb from several random starts; print every measured build as a JSON line. */
function search(family, evaluations, seed) {
  const random = seededRandom(seed), seen = new Set()
  const starts = 4, perStart = Math.floor(evaluations / starts)
  for (let start = 0; start < starts; start++) {
    let current = measure(randomBuild(family, random))
    console.log(JSON.stringify({ search: family, ...current }))
    for (let step = 1; step < perStart; step++) {
      const types = mutate(current.types, family, random), key = [...types].sort().join()
      if (seen.has(key)) continue
      seen.add(key)
      const candidate = measure(types)
      console.log(JSON.stringify({ search: family, ...candidate }))
      if (candidate.score >= current.score) current = candidate
    }
  }
}

const nameOf = type => rules.catalog.items[type].name
const average = list => list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0

/** The report: leaderboards, viability by family, the threat matrix, ablations, pair synergy and item use. */
function report(builds, directory) {
  const searches = ['open', ...Object.keys(powerFamilies)]
  const best = Object.fromEntries(searches.map(search => [search, builds.filter(build => build.search === search).sort((first, second) => second.score - first.score)[0]]))
  const top = Math.max(...Object.values(best).map(build => build.score))
  const lines = ['# Build Lab report', '', `${builds.length} builds measured: ${BUILD_SIZE} base items at level ${LEVEL}; depth against each of ${gauntlet.map(enemy => enemy.name).join(', ')}, climbing floors ${FLOORS.join(', ')}.`, '']
  lines.push('## Best build per search', '', '| Search | Score | Share of best | Worst fight | Items |', '|---|---|---|---|---|')
  for (const search of searches) lines.push(`| ${search} | ${best[search].score} | ${Math.round(100 * best[search].score / top)}% | ${best[search].worst} | ${best[search].types.map(nameOf).join(', ')} |`)
  lines.push('', '## Threat matrix (depth reached against each foe)', '', `| Search | ${gauntlet.map(enemy => enemy.name).join(' | ')} |`, `|---|${gauntlet.map(() => '---').join('|')}|`)
  for (const search of searches) lines.push(`| ${search} | ${gauntlet.map(enemy => best[search].fights[enemy.name].score).join(' | ')} |`)
  lines.push('', '## What carries each best build (score lost when the item is removed)', '')
  for (const search of searches) {
    const drops = best[search].types.map(type => ({ type, drop: Math.round((best[search].score - measure(best[search].types.filter(other => other !== type)).score) * 10) / 10 })).sort((first, second) => second.drop - first.drop)
    lines.push(`- **${search}**: ${drops.map(entry => `${nameOf(entry.type)} ${entry.drop}`).join(' · ')}`)
  }
  // Pair synergy over every build: the mean score with both items, minus what each brings alone, over the mean with neither.
  const meanWhere = test => average(builds.filter(test).map(build => build.score))
  const items = [...new Set(builds.flatMap(build => build.types))]
  const pairs = []
  for (let first = 0; first < items.length; first++) for (let second = first + 1; second < items.length; second++) {
    const [a, b] = [items[first], items[second]]
    const both = builds.filter(build => build.types.includes(a) && build.types.includes(b))
    if (both.length < 4) continue
    const lift = average(both.map(build => build.score)) - meanWhere(build => build.types.includes(a) && !build.types.includes(b)) - meanWhere(build => build.types.includes(b) && !build.types.includes(a)) + meanWhere(build => !build.types.includes(a) && !build.types.includes(b))
    if (Number.isFinite(lift)) pairs.push({ pair: `${nameOf(a)} + ${nameOf(b)}`, lift: Math.round(lift * 10) / 10, count: both.length })
  }
  pairs.sort((first, second) => second.lift - first.lift)
  lines.push('', '## Pair synergy (score above what the two items bring apart; at least 4 builds with both)', '', ...pairs.slice(0, 12).map(entry => `- ${entry.pair}: +${entry.lift} (${entry.count} builds)`), '', '### Pairs that work against each other', '', ...pairs.slice(-6).reverse().map(entry => `- ${entry.pair}: ${entry.lift} (${entry.count} builds)`))
  const ranked = [...builds].sort((first, second) => second.score - first.score), elite = ranked.slice(0, Math.max(10, Math.floor(builds.length / 10)))
  const use = {}
  for (const build of elite) for (const type of build.types) use[type] = (use[type] ?? 0) + 1
  lines.push('', `## Items in the top ${elite.length} builds`, '', Object.entries(use).sort((first, second) => second[1] - first[1]).slice(0, 15).map(([type, count]) => `${nameOf(type)} ${Math.round(100 * count / elite.length)}%`).join(' · '))
  const rare = pool.map(type => [type, use[type] ?? 0]).sort((first, second) => first[1] - second[1]).slice(0, 12)
  lines.push('', '## Items least used in those top builds', '', rare.map(([type, count]) => `${nameOf(type)} ${Math.round(100 * count / elite.length)}%`).join(' · '))
  const families = Object.keys(powerFamilies), threatDepth = gauntlet.map(enemy => average(searches.map(search => best[search].fights[enemy.name].score)))
  const dominant = Object.entries(use).sort((first, second) => second[1] - first[1])[0]
  lines.push('', '## Balance metrics', '', `- Viability: weakest family best is ${Math.round(100 * Math.min(...families.map(family => best[family].score)) / top)}% of the overall best (aim: 90% or more).`,
    `- Dominance: ${nameOf(dominant[0])} is in ${Math.round(100 * dominant[1] / elite.length)}% of the top builds (aim: under 40%).`,
    `- Threat spread: mean depth by foe ${gauntlet.map((enemy, index) => `${enemy.name} ${Math.round(threatDepth[index] * 10) / 10}`).join(', ')}; hardest is ${Math.round(100 * Math.min(...threatDepth.slice(1, -1)) / threatDepth[0])}% of plain (aim: 75–90%, so each threat bites without walling).`)
  const never = pool.filter(type => !builds.some(build => build.types.includes(type) && build.score >= top * 0.8))
  lines.push('', `## Items never in a build scoring 80% of the best`, '', never.map(nameOf).join(', ') || 'none')
  fs.writeFileSync(path.join(directory, 'report.md'), lines.join('\n') + '\n')
  fs.writeFileSync(path.join(directory, 'builds.json'), JSON.stringify(builds))
  console.log(lines.join('\n'))
}

const reportDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'agent-runs', 'build-lab')

/** Run every search in its own process, gather their lines, and write the report. */
async function runAll(evaluations) {
  const directory = reportDirectory
  fs.mkdirSync(directory, { recursive: true })
  const searches = ['open', ...Object.keys(powerFamilies)]
  const outputs = await Promise.all(searches.map((search, index) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'search', search, String(evaluations), String(index + 1)])
    let text = ''
    child.stdout.on('data', chunk => { text += chunk })
    child.stderr.on('data', chunk => process.stderr.write(chunk))
    child.on('close', code => code === 0 ? resolve(text) : reject(new Error(`${search} search failed`)))
  })))
  const builds = outputs.flatMap(text => text.split('\n').filter(Boolean).map(line => JSON.parse(line)))
  report(builds, directory)
}

const [command, first, second] = process.argv.slice(2)
if (command === 'search') search(first, Number(second ?? 120), Number(process.argv[5] ?? 1))
if (command === 'run') await runAll(Number(first ?? 120))
if (command === 'report') report(JSON.parse(fs.readFileSync(path.join(reportDirectory, 'builds.json'), 'utf8')), reportDirectory)
