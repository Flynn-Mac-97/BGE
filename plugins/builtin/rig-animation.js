/**
 * Rig Animation — plays a baked motion clip on a model's named nodes.
 *
 * Sprite Animation's twin for 3D. A clip is a file of rotations, one per named
 * node per frame; this reads it and writes `entity.pose`, which the renderer
 * turns into node rotations. It draws nothing.
 *
 * Declared as data on the type, beside the model it poses:
 *
 *   mesh: { model: 'player.glb' },
 *   rig: {
 *     clips: { idle: 'motion/idle.json', walk: 'motion/walk.json' },
 *     default: 'idle',
 *     rootMotion: false
 *   }
 *
 * Game code chooses one by assignment, for the reason Sprite Animation does:
 *
 *   entity.rigClip = entity.speed > 0.1 ? 'walk' : 'idle'
 *
 * A clip is a file, so it loads asynchronously and an entity holds its last
 * pose until it lands. A headless run that must be identical every time calls
 * `rig.load` first — see the guide.
 *
 * A layer plays a second clip on some nodes only, over the first — an arm
 * drawing a sword while the legs keep running. The type names node groups in
 * `rig.masks`, and game code asks for one:
 *
 *   rig: { ..., masks: { upper: ['Spine', 'LeftArm', ...] }, layerFade: 0.12 }
 *   entity.rigLayer = { clip: 'draw', mask: 'upper' }   // null to let go
 *   entity.rigLayer = { clip: 'stab', mask: 'upper', speed: 1.5, startedAt: context.time }
 *     speed plays it faster or slower; a new startedAt plays it again from the start
 *
 * The layer fades in and out over `layerFade` seconds. `entity.rigLayerDone`
 * is true once a clip that plays once has reached its end.
 *
 * Constraints change the pose last, in this same step: an arm reaching for a
 * point. They need the model's skeleton, a file `rig.retarget` writes:
 *
 *   rig: { ..., skeleton: 'motion/hero.skeleton.json', constraints: [{ kind: 'plant', nodes: [...] }] }
 *   entity.rigConstraints = [{ kind: 'reach', nodes: [...], target: { node, at }, weight: 0.6 }]
 *
 * The type's constraints hold for every entity of it (planted feet). Its
 * `rig.controls` name limbs and aims, and game code moves them by name with
 * `entity.rigControls` (rig-animation/controls.js); `entity.rigConstraints`
 * names bones directly.
 *
 * See rig-animation/constraints.js for every kind and target.
 */
import { assetPath } from '../../engine/asset-path.js'
import { framesAt, mixInto } from './rig-animation/sample.js'
import { applyLayer } from './rig-animation/layer.js'
import { applyCrossfade, crossfadeFrom } from './rig-animation/crossfade.js'
import { applyBlend, cycleRate } from './rig-animation/blend.js'
import { widenSkeleton } from './rig-animation/skeleton.js'
import { applyConstraints } from './rig-animation/constraints.js'
import { pointOf, worldPointOf } from './rig-animation/targets.js'
import { constraintsForControls } from './rig-animation/controls.js'
import { rigView } from './rig-animation/rig-view.js'
import { faultsOfClip, poseOfClip } from './rig-animation/motion-review.js'
import { makeOnceReporter } from '../../engine/report-once.js'

/** file -> { status, value, error }: a clip or a skeleton. Both files are immutable, so one cache serves every world. */
const clips = new Map()

const reportOnce = makeOnceReporter().report

/** world -> { context }, so a system can reach the file reader without a module-level context. */
const worlds = new WeakMap()

/** What rig.pose and rig.faults take: a type's clip by name, or a clip file with its skeleton. */
const REVIEW_ARGUMENTS = {
  type: 'object',
  properties: {
    type: { type: 'string', description: 'a rigged type in the level, such as player' },
    clip: { type: 'string', description: 'the clip name the type declares' },
    file: { type: 'string', description: 'or a clip file under assets/, such as a take' },
    skeleton: { type: 'string', description: 'the skeleton file a clip file is for' },
    at: { type: 'number', description: 'rig.pose only: seconds into the clip' }
  }
}

export default {
  name: 'Rig Animation',

  category: 'visuals',
  onLoad(context) {
    worlds.set(context.world, { context })

    context.rigAnimation = {
      /** The clip if it is loaded, null while it loads or if it failed. */
      clip: file => read(context, file).value,

      /** Load one clip and answer when it is there. Throws with the file name if it is not. */
      async load(file) {
        const entry = read(context, file)
        if (entry.status === 'loading') await entry.waiting
        if (entry.status === 'failed') throw new Error(`rig clip ${file}: ${entry.error}`)
        return entry.value
      },

      /** Load every clip every type declares. What a test awaits before it simulates. */
      loadDeclared: () => Promise.all([
        ...declaredClips(context.world).map(({ file }) => context.rigAnimation.load(file).then(() => file, error => error.message)),
        ...declaredSkeletons(context.world).map(file => loadSkeleton(context, file).then(() => file, error => error.message))
      ]),

      /**
       * Where a constraint target is under the entity's pose now, in model
       * space: `{ node: 'RightHand' }` is where the hand is. Null until the
       * type's skeleton has loaded.
       */
      pointOf(entity, target) {
        const file = entity._definition.rig?.skeleton
        const skeleton = file && read(context, file, widenSkeleton).value
        return skeleton && entity.pose ? pointOf(entity, skeleton, target) : null
      },

      /**
       * Where a target is under the entity's pose now, in the world: `{ node,
       * at }` is a point in a bone's space, as an attachment is hung. Null
       * until the type's skeleton has loaded.
       */
      worldPointOf(entity, target) {
        const point = context.rigAnimation.pointOf(entity, target)
        return point ? worldPointOf(entity, point) : null
      },

      /**
       * The rig as it stands this step, in world points: posed bones, and each
       * constraint's end, target, joint and pole (rig-animation/rig-view.js).
       * Null until the type's skeleton has loaded.
       */
      rigOf(entity) {
        const file = entity._definition.rig?.skeleton
        const skeleton = file && read(context, file, widenSkeleton).value
        return skeleton && entity.pose ? rigView(entity, skeleton, entity._rigSolved ?? [], entity._rigMemory) : null
      },

      /**
       * Metres a second the named clip's root covers over the ground, from its
       * first frame to its last: the speed to move the entity at so the feet
       * do not slide. 0 while the clip loads or when it has no root.
       */
      travelOf(entity, name) {
        const file = entity._definition.rig?.clips?.[name]
        const clip = file && read(context, file).value
        if (!clip?.root || clip.root.length < 2) return 0
        const first = clip.root[0]
        const last = clip.root.at(-1)
        return Math.hypot(last[0] - first[0], last[2] - first[2]) / ((clip.root.length - 1) / clip.framesPerSecond)
      },

      /** Forget every loaded clip, so an edited file is read again. */
      forget: () => clips.clear()
    }
  },

  systems: [{
    phase: 'fixed',
    run(world, seconds) {
      const state = worlds.get(world)
      if (!state) return

      for (const entity of world.entities) {
        const rig = entity._definition.rig
        if (!rig?.clips) continue

        const name = entity.rigClip ?? rig.default ?? Object.keys(rig.clips)[0]
        const file = rig.clips[name]
        // An unknown name holds the last pose, the same answer Sprite Animation
        // gives. Check the spelling against `rig.clips`.
        if (!file) continue

        const clip = read(state.context, file).value
        if (!clip) continue
        const blendFile = entity.rigBlend && rig.clips[entity.rigBlend.clip]
        const blendClip = blendFile ? read(state.context, blendFile).value : null

        if (entity._rigClipFile !== file) {
          if (entity._rigClipFile) entity._rigFrom = crossfadeFrom(entity._rigClipFile, entity._rigTime)
          entity._rigClipFile = file
          entity._rigTime = 0
          entity._rigRootLast = null
          entity.rigDone = false
        } else {
          entity._rigTime += seconds * (entity.rigSpeed ?? 1) * cycleRate(entity, clip, blendClip)
        }

        applyClip(entity, clip, rig)
        applyBlend(entity, clip, blendClip)
        applyCrossfade(entity, rig, seconds, fromFile => read(state.context, fromFile).value)
        applyLayer(entity, rig, seconds, layerFile => read(state.context, layerFile).value)
        if (rig.constraints?.length || entity.rigControls || entity.rigConstraints?.length) constrain(state.context, entity, rig, seconds)
      }
    }
  }],

  commands: [
    {
      id: 'rig.pose',
      label: 'One moment of a clip in words',
      inputSchema: REVIEW_ARGUMENTS,
      run: (context, options = {}) => poseOfClip(context, options, (file, widen) => read(context, file, widen))
    },
    {
      id: 'rig.faults',
      label: 'What is wrong with a clip, measured',
      inputSchema: REVIEW_ARGUMENTS,
      run: (context, options = {}) => faultsOfClip(context, options, (file, widen) => read(context, file, widen))
    },
    {
      id: 'rig.clips',
      label: 'Rig clips by type',
      run: context => Object.fromEntries(declaredClips(context.world).map(({ type, name, file }) => {
        const entry = clips.get(assetPath(file))
        const clip = entry?.value
        return [`${type}.${name}`, clip
          ? `${file} — ${clip.count} frames @${clip.framesPerSecond}fps, ${clip.nodes.length} nodes${clip.loop ? '' : ', once'}`
          : `${file} — ${entry?.error ? 'failed: ' + entry.error : 'not loaded'}`]
      }))
    },
    {
      id: 'rig.load',
      label: 'Load rig clips',
      run: context => context.rigAnimation.loadDeclared()
    },
    {
      id: 'rig.sources',
      label: 'Stored motion',
      run: async context => {
        if (!context.host) return needsNode('rig.sources')
        return (await clipShelf()).listSources(context.host.project)
      }
    },
    {
      id: 'rig.retarget',
      label: 'Retarget motion',
      run: async (context, options = {}) => {
        if (!context.host) return needsNode('rig.retarget', options)
        if (!options.model) return { error: 'name the model as a type does: {"model":"models/hero.glb"}' }
        const done = (await clipShelf()).retargetSources({ project: context.host.project, ...options })
        clips.clear()
        return done
      }
    },
    {
      id: 'rig.skeleton',
      label: 'Write a model skeleton',
      // rig.retarget writes it too; this is for clips made before it did.
      run: async (context, options = {}) => {
        if (!context.host) return needsNode('rig.skeleton', options)
        if (!options.model) return { error: 'name the model as a type does: {"model":"models/hero.glb"}' }
        const skeleton = (await clipShelf()).writeSkeleton({ project: context.host.project, model: options.model })
        clips.clear()
        return { skeleton, declare: { rig: { skeleton } } }
      }
    },
    {
      id: 'rig.check',
      label: 'Clips against capture',
      run: async (context, options = {}) => {
        if (!context.host) return needsNode('rig.check', options)
        if (!options.model) return { error: 'name the model as a type does: {"model":"models/hero.glb"}' }
        const { checkClips } = await import(/* @vite-ignore */ '../../tools/lib/rig-check.mjs')
        return checkClips({ project: context.host.project, ...options })
      }
    },
    {
      id: 'rig.compare',
      label: 'Clip beside capture',
      run: async (context, options = {}) => {
        if (!context.host) return needsNode('rig.compare', options)
        if (!options.model || !options.clip) return { error: 'name the model and the clip: {"model":"models/hero.glb","clip":"run"}' }
        return compareInBlender(context, options)
      }
    },
    {
      id: 'rig.play',
      label: 'Play a clip',
      run: (context, { entity, clip }) => {
        const target = context.world.entities.find(e => e.id === entity || e.type === entity)
        if (!target) return { error: `no entity ${entity}` }
        target.rigClip = clip
        return { entity: target.id, rigClip: clip }
      }
    }
  ],

  about: "Plays a baked clip on a model's nodes.",

  inspect: context => [{
    title: 'Clips',
    rows: declaredClips(context.world).map(({ type, name, file }) => ({
      label: `${type}.${name}`,
      value: clips.get(assetPath(file))?.status || 'not loaded'
    }))
  }]
}

/** The node-only retarget shelf, loaded on first use so the browser never imports it. */
const clipShelf = () => import(/* @vite-ignore */ '../../tools/lib/retarget-clips.mjs')

/** Pose the clip in Blender beside its capture and return the sheet. Blender is found by Blender Assets. */
async function compareInBlender(context, { model, clip, frames }) {
  const path = await import('node:path')
  const { writeComparePoses, COMPARE_SCRIPT } = await import(/* @vite-ignore */ '../../tools/lib/rig-compare.mjs')
  const found = await context.run('blender.check')
  if (!found?.blender) return { error: `no Blender: ${found?.error || 'blender.check gave nothing'}` }
  const name = `${path.basename(model, path.extname(model))}-${path.basename(clip, '.json')}`
  const out = path.join(context.host.checkout, 'agent-runs', 'rig-compare', name)
  const prepared = writeComparePoses({ project: context.host.project, model, clip, frames, out })
  const result = await context.host.run(found.blender, [prepared.blend, '--background', '--python', COMPARE_SCRIPT, '--', prepared.poses, out])
  const sheet = /engine-compare-sheet (.+)/.exec(result.out)?.[1]?.trim()
  if (!sheet) return { error: 'Blender did not write the sheet', blender: (result.error || result.out).slice(-1200) }
  return {
    sheet: path.relative(context.host.checkout, sheet).split(path.sep).join('/'),
    clip: prepared.clip,
    frames: prepared.frames,
    read: 'rows: front, then side; columns: frames. Grey is the model posed by the clip, orange is the capture. Look for limbs that point differently, bones left behind, and joints that come apart.'
  }
}

/** Refuse in the browser, naming the command that works: retargeting reads and writes project files. */
const needsNode = (id, options) => ({
  error: `${id} runs headless`,
  terminal: `node bin/engine.mjs --headless run ${id}${options ? ` '${JSON.stringify(options)}'` : ''}`
})

/** Every clip any type declares, once per declaration. */
function declaredClips(world) {
  const found = []
  for (const [type, definition] of world.types) {
    for (const [name, file] of Object.entries(definition.rig?.clips || {})) found.push({ type, name, file })
  }
  return found
}

/** Every skeleton file any type declares, once each. */
const declaredSkeletons = world => [...new Set([...world.types.values()].map(definition => definition.rig?.skeleton).filter(Boolean))]

/** Load one skeleton file and answer when it is there. */
async function loadSkeleton(context, file) {
  const entry = read(context, file, widenSkeleton)
  if (entry.status === 'loading') await entry.waiting
  if (entry.status === 'failed') throw new Error(`rig skeleton ${file}: ${entry.error}`)
}

/** Solve the type's constraints, its controls as asked, then the entity's, over its pose, once the skeleton has loaded. */
function constrain(context, entity, rig, seconds) {
  if (!rig.skeleton) {
    reportOnce(`[rig] ${entity.type}: constraints need rig.skeleton — rig.retarget writes it and prints the line`)
    return
  }
  const skeleton = read(context, rig.skeleton, widenSkeleton).value
  if (!skeleton || !entity.pose) return
  const controlled = constraintsForControls(rig.controls, entity.rigControls, context.time)
  for (const refusal of controlled.refusals) reportOnce(`[rig] ${entity.type}: ${refusal}`)
  // The type's own first (planted feet), then what game code moves by control, then by bone.
  const constraints = [...(rig.constraints ?? []), ...controlled.constraints, ...(entity.rigConstraints ?? [])]
  applyConstraints(entity, skeleton, constraints, seconds)
  // Kept for rigOf, so a picture shows what this step solved.
  entity._rigSolved = constraints
}

/**
 * The cache entry for a file, starting the read the first time it is asked for.
 * `widen` checks the parsed file and shapes it: a clip unless told otherwise.
 *
 * `context.files.read` is the one door that answers in the browser and in node,
 * so a clip loads the same way headless as it does on the page.
 */
function read(context, file, widen = widenClip) {
  const path = assetPath(file)
  const found = clips.get(path)
  if (found) return found

  const entry = { status: 'loading', value: null, error: null, waiting: null }
  clips.set(path, entry)
  entry.waiting = context.files.read(path)
    .then(text => {
      entry.value = widen(JSON.parse(text), file)
      entry.status = 'ready'
    })
    .catch(error => {
      entry.status = 'failed'
      entry.error = error.message
      // Same rule as a missing model: say so rather than stand still silently.
      console.error(`[rig] cannot load clip ${path} — ${error.message}`)
    })
  return entry
}

/** A file as written, checked and given the counts the sampler reads every step. */
export function widenClip(raw, file) {
  const nodes = raw.nodes || []
  const rotations = raw.rotations || []
  if (!nodes.length) throw new Error(`${file}: no nodes`)
  if (!rotations.length) throw new Error(`${file}: no rotations`)
  if (rotations[0].length !== nodes.length * 4) {
    throw new Error(`${file}: ${nodes.length} nodes needs ${nodes.length * 4} numbers a frame, got ${rotations[0].length}`)
  }
  const positions = raw.positions || null
  for (const [node, frames] of Object.entries(positions || {})) {
    if (!nodes.includes(node)) throw new Error(`${file}: positions names ${node}, which is not in nodes`)
    if (frames.length !== rotations.length) throw new Error(`${file}: positions.${node} has ${frames.length} frames, rotations have ${rotations.length}`)
  }
  return {
    nodes,
    rotations,
    positions,
    root: raw.root || null,
    count: rotations.length,
    framesPerSecond: raw.framesPerSecond || 30,
    loop: raw.loop !== false,
    source: raw.source || null
  }
}

/** Write this moment of the clip onto the entity. */
export function applyClip(entity, clip, rig) {
  const { first, second, blend, isDone } = framesAt(clip, entity._rigTime)
  if (isDone) entity.rigDone = true

  const pose = poseFor(entity, clip)
  const a = clip.rotations[first]
  const b = clip.rotations[second]
  for (let index = 0; index < clip.nodes.length; index++) {
    mixInto(pose[clip.nodes[index]], a, b, index * 4, blend)
  }
  for (const node in clip.positions) {
    const from = clip.positions[node][first]
    const to = clip.positions[node][second]
    const into = pose[node]
    for (let axis = 0; axis < 3; axis++) into[4 + axis] = from[axis] + (to[axis] - from[axis]) * blend
  }

  if (!clip.root) return
  // Rotations are a cycle and wrap; the root is absolute travel and must not.
  // Blending the last frame back to the first runs the character backwards
  // through the whole clip, so the pair is clamped and the last frame holds.
  const rootSecond = second < first ? first : second
  const rootBlend = rootSecond === first ? 0 : blend
  const rootA = clip.root[first]
  const rootB = clip.root[rootSecond]
  const root = [
    rootA[0] + (rootB[0] - rootA[0]) * rootBlend,
    rootA[1] + (rootB[1] - rootA[1]) * rootBlend,
    rootA[2] + (rootB[2] - rootA[2]) * rootBlend
  ]
  entity.rigRoot = root

  if (!rig.rootMotion) return
  // The step's own movement, not the clip's absolute position, so the entity
  // travels from wherever it stands and a loop does not snap it back.
  const previous = entity._rigRootLast
  if (previous && !(clip.loop && first < previous.frame)) {
    entity.x += root[0] - previous.at[0]
    entity.y += root[1] - previous.at[1]
    entity.z += root[2] - previous.at[2]
  }
  entity._rigRootLast = { at: root, frame: first }
}

/**
 * The entity's pose object for this clip, made once.
 *
 * Rebuilt only when the clip changes, and then written in place — sixty steps a
 * second across a crowd is the one place in this plugin where allocation shows.
 */
function poseFor(entity, clip) {
  if (entity._rigPoseFor === clip && entity.pose) return entity.pose
  const pose = {}
  // A node that also moves carries its local position after the rotation.
  for (const node of clip.nodes) pose[node] = clip.positions?.[node] ? [0, 0, 0, 1, 0, 0, 0] : [0, 0, 0, 1]
  entity.pose = pose
  entity._rigPoseFor = clip
  return pose
}
