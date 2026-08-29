/**
 * Prove the browser half and the node half resolve an asset name the same way.
 *
 * p18 was two copies of one rule with nothing enforcing it; there turned out to
 * be five. They now all come from `engine/asset-path.js`, so this asks the two
 * that matter — `assetURL`, which the renderer fetches by, and `assetPath`,
 * which `check` compares against disk — and it asks the rule as it was written
 * at `engine/ui.js:35` before the change, so "behaviour did not change" is a
 * result rather than a claim.
 *
 *   node agent-runs/2026-08-29-asset-path/asset-path-agreement.mjs
 */
import { assetPath, assetURL } from '../../engine/asset-path.js'

/** The rule exactly as engine/ui.js:35 carried it before this refactor. */
const before = src => {
  const rel = String(src).replace(/^\/?project\//, '')
  return '/project/' + (/^(assets|levels|types|behaviours|tests|plugins)\//.test(rel) ? rel : 'assets/' + rel)
}

const cases = [
  ['player.png', 'assets/player.png'],
  // p11: a subfolder under assets/. The old rule sent this to
  // /project/counter-strike/ and killed all 231 de_dust2 textures.
  ['counter-strike/wall.png', 'assets/counter-strike/wall.png'],
  ['decals/bullet-hole.png', 'assets/decals/bullet-hole.png'],
  // Names a project folder directly, so it is taken as given.
  ['assets/counter-strike/wall.png', 'assets/counter-strike/wall.png'],
  ['levels/de_dust2.json', 'levels/de_dust2.json'],
  ['types/brush.js', 'types/brush.js'],
  ['behaviours/jump.js', 'behaviours/jump.js'],
  ['tests/buy-menu.js', 'tests/buy-menu.js'],
  ['plugins/radar.js', 'plugins/radar.js'],
  // A leading project/ is stripped, written either way.
  ['project/assets/sky.png', 'assets/sky.png'],
  ['/project/assets/sky.png', 'assets/sky.png'],
  // A project folder's name is only a project folder as a whole first segment.
  ['assetsy/thing.png', 'assets/assetsy/thing.png'],
  ['plugin/thing.png', 'assets/plugin/thing.png']
]

let failures = 0
const fail = message => { failures++; console.error(`  FAIL ${message}`) }

for (const [reference, expected] of cases) {
  const path = assetPath(reference)
  const url = assetURL(reference)
  if (path !== expected) fail(`assetPath(${JSON.stringify(reference)}) is "${path}", expected "${expected}"`)
  if (url !== '/project/' + expected) fail(`assetURL(${JSON.stringify(reference)}) is "${url}", expected "/project/${expected}"`)
  if (url !== before(reference)) fail(`assetURL(${JSON.stringify(reference)}) is "${url}", but before the refactor it was "${before(reference)}"`)
  if (!failures) console.log(`  ok  ${reference} -> ${url}`)
}

console.log(failures
  ? `${failures} disagreement(s) between the browser half and the node half`
  : `${cases.length} names: assetPath, assetURL and the pre-refactor rule all agree`)
process.exit(failures ? 1 : 0)
