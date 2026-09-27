/**
 * Kimodo's node half: make takes from a saved design (designer.js), and say
 * which Kimodo models are installed. Only a run in node can start kimodo.cpp
 * or read its directory, so the browser half runs these in a headless engine.
 *
 * The design's keys become a constraint file beside each take's stored
 * motion, and `tools/make-rig-clip.mjs` generates and retargets it onto the
 * design's model. A design asks for `takes` of them, one per seed from its
 * `seed`: `take-<name>` for one, `take-<name>-a`, `-b`, ... for more. Each
 * takes minutes.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { kimodoRecord } from './designer.js'
import { main as makeRigClip } from '../../../tools/make-rig-clip.mjs'

const FRAMES_PER_SECOND = 30

/**
 * The Kimodo motion models upstream publishes, each with the skeleton it
 * moves. `kimodo.cpp/scripts/download_gguf_weights.sh` names them; add one
 * here when it adds one.
 */
const KIMODO_MODELS = [
  { model: 'soma-rp-v1.1', skeleton: 'soma-30', about: 'SOMA human' },
  { model: 'soma-seed-v1.1', skeleton: 'soma-30', about: 'SOMA human, SEED data' },
  { model: 'g1-rp-v1', skeleton: 'g1-34', about: 'Unitree G1 robot' },
  { model: 'g1-seed-v1', skeleton: 'g1-34', about: 'Unitree G1 robot, SEED data' }
]

/** Where kimodo.cpp is: KIMODO_HOME, or beside the checkout. */
const kimodoHome = checkout => process.env.KIMODO_HOME || path.resolve(checkout, '..', 'kimodo.cpp')

/** Every Kimodo model, whether its weights are installed, and the command that installs it. */
export function kimodoModels(checkout) {
  return KIMODO_MODELS.map(entry => ({
    ...entry,
    isInstalled: fs.existsSync(path.join(kimodoHome(checkout), 'models', `kimodo-${entry.model}-f32.gguf`)),
    install: `node tools/install-kimodo.mjs --install --model ${entry.model}`
  }))
}

/** The take names a design's run makes: one per seed. */
const takeNamesOf = design => {
  const count = Math.max(1, Math.round(design.takes ?? 1))
  if (count === 1) return [`take-${design.name}`]
  return Array.from({ length: count }, (unused, index) => `take-${design.name}-${String.fromCharCode(97 + index)}`)
}

/**
 * Generate the takes for the design stored at `file` (a path in the project).
 * Answers `{ clip, clips, prompt, frames }`: every take's clip as kimodo.takes
 * names it, and the first as `clip`.
 */
export async function generateDesign(host, file) {
  const design = JSON.parse(fs.readFileSync(path.join(host.project, file), 'utf8'))
  if (design.segments?.length) return generateSequence(host, design)
  if (!design.prompt?.trim()) throw new Error(`${file}: write a prompt first`)
  const base = JSON.parse(fs.readFileSync(path.join(host.project, 'assets', design.base), 'utf8'))
  const template = base.source?.from ? path.basename(base.source.from) : null
  if (!template) throw new Error(`${design.base} records no stored motion to read the body from; pick a base take made by kimodo`)
  const constraints = path.join(os.tmpdir(), `kimodo-design-${design.name}.json`)
  fs.writeFileSync(constraints, JSON.stringify(kimodoRecord(design, template), null, 2))
  const frames = Math.round(design.seconds * FRAMES_PER_SECOND)
  const folder = path.basename(design.model, path.extname(design.model))
  const clips = []
  for (const [index, name] of takeNamesOf(design).entries()) {
    await makeRigClip([
      '--project', host.project, '--onto', design.model, '--prompt', design.prompt, '--name', name,
      '--frames', String(frames), '--seed', String((design.seed ?? 0) + index), '--constraints', constraints,
      ...(design.kimodoModel ? ['--model', design.kimodoModel] : []),
      ...(design.loop ? [] : ['--once'])
    ])
    clips.push(`motion/${folder}/${name}.json`)
  }
  return { clip: clips[0], clips, prompt: design.prompt, frames }
}

/**
 * Generate a design of several prompts in a row, `segments: [{ prompt, seconds }]`,
 * as takes (make-rig-clip `--segments`). Kimodo takes no keys with a
 * sequence, so a design's keys, body and base pose are not used.
 */
async function generateSequence(host, design) {
  const segments = design.segments.map(segment => ({ prompt: segment.prompt, frames: Math.round(segment.seconds * FRAMES_PER_SECOND) }))
  const folder = path.basename(design.model, path.extname(design.model))
  const clips = []
  for (const [index, name] of takeNamesOf(design).entries()) {
    await makeRigClip([
      '--project', host.project, '--onto', design.model, '--name', name, '--segments', JSON.stringify(segments),
      '--seed', String((design.seed ?? 0) + index),
      ...(design.kimodoModel ? ['--model', design.kimodoModel] : []),
      ...(design.loop ? [] : ['--once'])
    ])
    clips.push(`motion/${folder}/${name}.json`)
  }
  const frames = segments.reduce((sum, segment) => sum + segment.frames, 0)
  return { clip: clips[0], clips, prompt: segments.map(segment => segment.prompt).join(' Then '), frames }
}
