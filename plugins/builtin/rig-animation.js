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
 */
import { assetPath } from '../../engine/asset-path.js'

/** file -> { status, clip, error }. Clip files are immutable, so one cache serves every world. */
const clips = new Map()

/** world -> { context }, so a system can reach the file reader without a module-level context. */
const worlds = new WeakMap()

export default {
  name: 'Rig Animation',

  category: 'visuals',
  onLoad(context) {
    worlds.set(context.world, { context })

    context.rigAnimation = {
      /** The clip if it is loaded, null while it loads or if it failed. */
      clip: file => read(context, file).clip,

      /** Load one clip and answer when it is there. Throws with the file name if it is not. */
      async load(file) {
        const entry = read(context, file)
        if (entry.status === 'loading') await entry.waiting
        if (entry.status === 'failed') throw new Error(`rig clip ${file}: ${entry.error}`)
        return entry.clip
      },

      /** Load every clip every type declares. What a test awaits before it simulates. */
      loadDeclared: () => Promise.all(declaredClips(context.world)
        .map(({ file }) => context.rigAnimation.load(file).then(() => file, error => error.message))),

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

        const clip = read(state.context, file).clip
        if (!clip) continue

        if (entity._rigClipFile !== file) {
          entity._rigClipFile = file
          entity._rigTime = 0
          entity._rigRootLast = null
          entity.rigDone = false
        } else {
          entity._rigTime += seconds
        }

        applyClip(entity, clip, rig)
      }
    }
  }],

  commands: [
    {
      id: 'rig.clips',
      label: 'Rig clips by type',
      run: context => Object.fromEntries(declaredClips(context.world).map(({ type, name, file }) => {
        const entry = clips.get(assetPath(file))
        const clip = entry?.clip
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

/**
 * The cache entry for a file, starting the read the first time it is asked for.
 *
 * `context.files.read` is the one door that answers in the browser and in node,
 * so a clip loads the same way headless as it does on the page.
 */
function read(context, file) {
  const path = assetPath(file)
  const found = clips.get(path)
  if (found) return found

  const entry = { status: 'loading', clip: null, error: null, waiting: null }
  clips.set(path, entry)
  entry.waiting = context.files.read(path)
    .then(text => {
      entry.clip = widenClip(JSON.parse(text), file)
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
  const position = entity._rigTime * clip.framesPerSecond
  const last = clip.count - 1
  let first = Math.floor(position)
  let second, blend

  if (clip.loop) {
    first = ((first % clip.count) + clip.count) % clip.count
    second = (first + 1) % clip.count
    blend = position - Math.floor(position)
  } else if (first >= last) {
    first = second = last
    blend = 0
    entity.rigDone = true
  } else {
    second = first + 1
    blend = position - first
  }

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

/**
 * Blend two frames of one node into the pose, normalised.
 *
 * Straight interpolation, not slerp: neighbouring frames of a capture are a
 * fraction of a degree apart, where the two answers differ by less than the
 * rounding in the file. The sign flip is not optional — two quaternions that
 * name the same rotation with opposite signs interpolate the long way round.
 */
function mixInto(into, a, b, at, blend) {
  const dot = a[at] * b[at] + a[at + 1] * b[at + 1] + a[at + 2] * b[at + 2] + a[at + 3] * b[at + 3]
  const sign = dot < 0 ? -1 : 1
  let length = 0
  for (let axis = 0; axis < 4; axis++) {
    const value = a[at + axis] + (b[at + axis] * sign - a[at + axis]) * blend
    into[axis] = value
    length += value * value
  }
  length = Math.sqrt(length) || 1
  for (let axis = 0; axis < 4; axis++) into[axis] /= length
}
