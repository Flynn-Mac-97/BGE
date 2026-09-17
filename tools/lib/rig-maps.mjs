/**
 * The bone maps the shelf knows, and which one fits a model.
 *
 * A map is `tools/lib/rig-maps/<skeleton>-to-<rig>.json`. A model fits a map
 * when it has every node the map names. Add a file here for a new rig
 * convention and every game can retarget onto it with no map of its own.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { guessMap } from './rig-map-guess.mjs'

const DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rig-maps')

/** Every map for one capture skeleton: `{ rig, file, map }`. */
export function mapsFor(skeleton) {
  const prefix = `${skeleton}-to-`
  return fs.readdirSync(DIRECTORY)
    .filter(name => name.startsWith(prefix) && name.endsWith('.json'))
    .map(name => ({
      rig: name.slice(prefix.length, -'.json'.length),
      file: path.join(DIRECTORY, name),
      map: JSON.parse(fs.readFileSync(path.join(DIRECTORY, name), 'utf8'))
    }))
}

/** The nodes a map drives. */
export const nodesOf = map => Object.entries(map)
  .filter(([key]) => !key.startsWith('_'))
  .map(([, value]) => (typeof value === 'string' ? value : value.node))

/** Where a game keeps its own maps: one per model, named after it. */
export const PROJECT_MAPS = 'assets/motion/maps'

function projectMaps(project, skeleton) {
  const directory = project && path.join(project, PROJECT_MAPS)
  if (!directory || !fs.existsSync(directory)) return []
  return fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => {
    const map = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
    return { rig: name.slice(0, -'.json'.length), file: path.join(directory, name), map, skeleton: map._skeleton || 'soma-30' }
  }).filter(one => one.skeleton === skeleton)
}

/**
 * The map whose nodes the model has, as `{ rig, file, map, guessed }`.
 *
 * Looks in the game's own maps first (`<modelName>.json`, then any other), then
 * the shelf's. When none fits, a map is guessed from node names and written to
 * `assets/motion/maps/<modelName>.json`, so it can be checked and kept. Throws,
 * naming the model's nodes, when no guess is possible.
 */
export function findMap(skeleton, model, { project = null, modelName = null } = {}) {
  const names = new Set(model.map(node => node.name))
  const fits = one => nodesOf(one.map).every(node => names.has(node))
  const own = projectMaps(project, skeleton).sort((a, b) => (b.rig === modelName) - (a.rig === modelName))
  const fitting = own.find(fits) || mapsFor(skeleton).find(fits)
  if (fitting) return { ...fitting, guessed: false }
  if (skeleton !== 'soma-30' || !project || !modelName) {
    const closest = mapsFor(skeleton).map(one => `${one.rig} misses ${nodesOf(one.map).filter(node => !names.has(node)).length}`).join('; ')
    throw new Error(`no bone map fits this model (${closest}). Its nodes start: ${[...names].slice(0, 12).join(', ')}`)
  }
  const { map, missing } = guessMap(model)
  const file = path.join(project, PROJECT_MAPS, `${modelName}.json`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify({ ...map, _unmatched: missing }, null, 2)}\n`)
  return { rig: modelName, file, map, guessed: true, unmatched: missing }
}
