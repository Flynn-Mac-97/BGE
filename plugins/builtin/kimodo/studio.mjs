/**
 * Kimodo's studio: a project of its own where takes are made and designed on
 * the mannequin (mannequin.mjs), and from which a take is copied into a game.
 * Node only: it makes directories, writes a .glb and retargets.
 *
 * The studio is `<projects folder>/<studio name>`, laid out as any game is,
 * so every Kimodo command works in it unchanged. Its bone map is its own, in
 * `assets/motion/maps/`, where the retarget looks first.
 *
 * Copying a take gives the game the take's stored motion and retargets it
 * onto every skinned model in the game's `assets/models/`, the same step
 * `make-rig-clip --onto` runs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectsRoot } from '../../../engine/project-path.mjs'
import { readModelSkeleton } from '../../../tools/lib/retarget.mjs'
import { PROJECT_MAPS } from '../../../tools/lib/rig-maps.mjs'
import { SOURCE_DIRECTORY, listSources, retargetSources } from '../../../tools/lib/retarget-clips.mjs'
import { mannequinGlb, mannequinMap } from './mannequin.mjs'

/** Stored motion the studio starts with, so its board has a take to design on. */
const SEED = { name: 'kimodo-idle', directory: path.join(path.dirname(fileURLToPath(import.meta.url)), 'studio-seed') }

const EMPTY_LEVEL = { camera: { mode: 'ortho', at: [0, 0], zoom: 48 }, entities: [] }

const writeFile = (file, contents) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
}

/**
 * Make the studio at `<projects folder>/<name>` with the mannequin at `model`,
 * or bring its mannequin and bone map up to date when it is there: both
 * belong to this plugin, and a studio would keep an old one otherwise. Its
 * takes are retargeted onto the new mannequin, each keeping whether it loops.
 * Answers `{ studio, directory }`.
 */
export function makeStudio(checkout, { name, model }) {
  const directory = path.join(projectsRoot(checkout), name)
  writeFile(path.join(directory, 'assets', model), mannequinGlb())
  const modelName = path.basename(model, path.extname(model))
  writeFile(path.join(directory, PROJECT_MAPS, `${modelName}.json`), JSON.stringify(mannequinMap(), null, 2) + '\n')
  if (fs.existsSync(path.join(directory, 'game.json'))) {
    retargetTakes(directory, model)
    return { studio: name, directory }
  }
  writeFile(path.join(directory, 'game.json'), JSON.stringify({ title: 'Kimodo Studio', startLevel: 'main' }, null, 2) + '\n')
  writeFile(path.join(directory, 'levels/main.json'), JSON.stringify(EMPTY_LEVEL, null, 2) + '\n')
  fs.cpSync(SEED.directory, path.join(directory, SOURCE_DIRECTORY, SEED.name), { recursive: true })
  retargetSources({ project: directory, model, clips: [SEED.name] })
  return { studio: name, directory }
}

/** Retarget every stored take in the studio onto `model`, a take that plays once staying so. */
function retargetTakes(directory, model) {
  const clips = listSources(directory).map(source => source.name)
  if (!clips.length) return
  const clipFile = name => path.join(directory, 'assets/motion', path.basename(model, path.extname(model)), `${name}.json`)
  const once = clips.filter(name => fs.existsSync(clipFile(name)) && JSON.parse(fs.readFileSync(clipFile(name), 'utf8')).loop === false)
  retargetSources({ project: directory, model, clips, once })
}

/** The models in a game a take can be retargeted onto: each top-level .glb with a skin. */
function skinnedModels(game) {
  const directory = path.join(game, 'assets/models')
  if (!fs.existsSync(directory)) return []
  return fs
    .readdirSync(directory)
    .filter(file => file.endsWith('.glb'))
    .filter(file => readModelSkeleton(path.join(directory, file)).some(node => node.joint))
    .map(file => `models/${file}`)
}

/** True when two stored motion directories hold the same buffers. */
function isSameMotion(first, second) {
  const buffer = (directory, file) => fs.readFileSync(path.join(directory, file))
  return ['local_rotations_xyzw.f32', 'root_positions.f32'].every(file => buffer(first, file).equals(buffer(second, file)))
}

/**
 * Copy the take `clip` (`motion/<model>/<take>.json`, as kimodo.takes names
 * it) from the studio at `studio` into the game called `game`, and retarget it
 * onto each of the game's skinned models. Refuses stored motion of the same
 * name the game already has, because that motion may be the game's own.
 * Answers `{ game, written }`, the clips written as the game names them.
 */
export function copyTakeToGame(checkout, studio, { clip, game }) {
  const name = path.basename(clip, '.json')
  const raw = JSON.parse(fs.readFileSync(path.join(studio, 'assets', clip), 'utf8'))
  const from = path.join(studio, raw.source?.from ?? path.join(SOURCE_DIRECTORY, name))
  if (!fs.existsSync(from)) throw new Error(`${clip} records no stored motion to copy`)
  const target = path.join(projectsRoot(checkout), game)
  if (path.resolve(target) === path.resolve(studio)) throw new Error('pick a game, not the studio')
  if (!fs.existsSync(path.join(target, 'game.json'))) throw new Error(`no game called ${game}`)
  const models = skinnedModels(target)
  if (!models.length) throw new Error(`${game} has no skinned model in assets/models/ to put the take on`)
  const stored = path.join(target, SOURCE_DIRECTORY, name)
  if (fs.existsSync(stored) && !isSameMotion(from, stored))
    throw new Error(`${game} already has other stored motion called ${name}; generate the take under another name`)
  fs.cpSync(from, stored, { recursive: true })
  const once = raw.loop === false ? [name] : []
  const written = models.flatMap(model => retargetSources({ project: target, model, clips: [name], once }).written)
  return { game, written: written.map(one => one.file) }
}
