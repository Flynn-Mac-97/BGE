/**
 * Kimodo poser commands: `kimodo.poses` lists the vocabulary (poses.js),
 * `kimodo.pose` writes a design from a timeline of key poses, and
 * `kimodo.compare` says how close the generated take came (pose-compare.js).
 * `kimodo.generate` makes the take between the two, as for any design.
 *
 * A request to `kimodo.pose`:
 *   { name, prompt, model, base, seconds?, seed?, keys: [{ at, pose?, mirror?,
 *     right?, left?, rightFoot?, leftFoot? }] }
 * `base` is a take Kimodo made on the model: its stored motion is the
 * template Kimodo reads the body from. The skeleton is the model's own,
 * `motion/<model name>.skeleton.json`.
 */
import { widenSkeleton } from '../rig-animation/skeleton.js'
import { widenClip } from '../rig-animation.js'
import { POSES, keysOf, poseWords } from './poses.js'
import { compareTake } from './pose-compare.js'
import { promptAdvice } from '../../../tools/lib/prompt-advice.mjs'

const FRAMES_PER_SECOND = 30

/** The model's name, `models/fighter.glb` -> `fighter`: its skeleton and takes are filed under it. */
const modelName = model =>
  model
    .split('/')
    .pop()
    .replace(/\.[^.]+$/, '')

async function skeletonOf(context, model) {
  return widenSkeleton(JSON.parse(await context.files.read(`assets/motion/${modelName(model)}.skeleton.json`)), model)
}

/** kimodo.poses: each pose's name and what it is for. */
export const poseMenu = () => ({
  poses: Object.fromEntries(Object.entries(POSES).map(([name, pose]) => [name, pose.means])),
  limbs:
    'a key may set right, left (hands: { level, forward, out }) and rightFoot, leftFoot ({ forward, out }) over its pose; mirror swaps sides'
})

/** kimodo.pose: the design for a timeline of key poses, written under `designs`. */
export async function designFromPoses(context, options, designs) {
  const missing = ['name', 'prompt', 'model', 'base'].filter(field => !options[field])
  if (missing.length) return { error: `kimodo.pose needs ${missing.join(', ')}` }
  if (!Array.isArray(options.keys) || !options.keys.length)
    return { error: 'kimodo.pose needs keys: [{ "at": 0, "pose": "guard" }, ...]' }
  const skeleton = await skeletonOf(context, options.model)
  const seconds = options.seconds ?? 2
  const design = {
    name: options.name,
    model: options.model,
    base: options.base,
    prompt: options.prompt,
    seconds,
    seed: options.seed ?? 0,
    loop: false,
    // The key poses set the start, so the base take's first pose would only fight them.
    fromBase: false,
    keys: keysOf(options.keys, skeleton),
    hold: null,
    poses: options.keys
  }
  const file = `${designs}/${design.name}.json`
  await context.files.write(file, JSON.stringify(design, null, 2) + '\n')
  return {
    design: file,
    asked: options.keys.map(poseWords),
    prompt: promptAdvice(options.prompt, seconds),
    next: `node bin/engine.mjs --headless --project <game> run kimodo.generate '{"design":"${file}"}', then kimodo.compare`
  }
}

/** kimodo.compare: how close the design's take came to its key poses. */
export async function compareDesign(context, options) {
  if (!options.design) return { error: 'name the design: {"design":"assets/motion/designs/<name>.json"}' }
  const design = JSON.parse(await context.files.read(options.design))
  const clipFile = `assets/motion/${modelName(design.model)}/take-${design.name}.json`
  const clip = widenClip(JSON.parse(await context.files.read(clipFile)), clipFile)
  const compared = compareTake(design, clip, await skeletonOf(context, design.model))
  return {
    take: clipFile.replace(/^assets\//, ''),
    frames: clip.count,
    seconds: clip.count / FRAMES_PER_SECOND,
    ...compared,
    asked: (design.poses ?? []).map(poseWords)
  }
}
