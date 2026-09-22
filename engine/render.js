/**
 * Kernel: one GL context, one draw order.
 *
 * 2D is an orthographic camera looking down -Z at textured planes. 3D is the
 * same scene with a perspective camera — the same entity list, the same texture
 * cache, the same picking. An entity carrying `sprite` draws as a plane and an
 * entity carrying `mesh` draws as solid geometry, a list of `parts` or a loaded
 * model, and one level may hold all of them.
 *
 * The sprite and solid paths differ in exactly three places, and each is a
 * decision rather than an accident: geometry (a cached box or quad against one
 * shared plane), material (lit and opaque against unlit and painter-ordered),
 * and texture filtering (mipmapped and anisotropic against nearest-neighbour —
 * what keeps pixel art crisp is exactly what turns a floor into shimmering
 * noise).
 *
 * A loaded model is addressable by node name, because its file said what those
 * nodes are called: `pose` rotates one and `attachments` hangs another model off
 * one. Both are declarations read on sync rather than calls, for the same reason
 * animation is assignment — a hook can say what a body IS holding without
 * tracking what it WAS holding.
 *
 * Two things are drawn beside an entity rather than by it, because neither can
 * be a material: a KEYLINE, a dark line of constant screen-space width round
 * the silhouette, and a CONTACT SHADOW, one soft ellipse on the ground under
 * everything that moves. A material builder returns one material and cannot add
 * a second mesh, and a loaded model draws with its file's own materials and can
 * be given none at all — so both are geometry this file builds. Defaults are in
 * `readability`; `mesh.keyline` and `mesh.shadow` override them.
 *
 * The draw order is two passes: the world, then the viewmodel against a cleared
 * depth buffer through a narrower camera of its own. That second pass is the
 * only correct answer to a first-person weapon clipping into a wall, and it is
 * why "one draw order" is a decision this file owns rather than a fact about it.
 *
 * There are two hook points and no more: `materials` for what a surface is made
 * of and `passes` for what happens to the finished picture. Both are deliberately
 * dumb. A renderer that holds the list of materials a game uses, or the list of
 * effects it wants, has started to know what the game is — and in this engine
 * that knowledge lives in a plugin. This file owns one GL context and one draw
 * order, and it must never learn what bloom is.
 *
 * What it does know about is cost. Several hundred walls that never move are
 * merged by material into a handful of meshes, each one still small enough to be
 * frustum-culled, and `stats` reports what that bought so the next change here
 * can be measured rather than argued about.
 *
 * The implementation is one concern per module under `engine/render/`. This file
 * owns the GL context, the state every part of the renderer shares, and the
 * surface a caller sees; `sync` and `draw` are the two calls that drive it.
 *
 * The renderer is handed `view` and `viewport` and may know nothing else: no
 * level, no project file, no context. Everything a level wants to say about
 * light, fog and sky arrives through the four setters below.
 */
// The node build, not the classic one. It carries WebGPURenderer and every
// node material, and it is the only build TSL shaders compile against. The
// classic build has WebGLRenderer and nothing node-shaped; the two are
// disjoint, so a shader language choice is a renderer choice.
import * as THREE from 'three/webgpu'
import { entityDrawSize } from './frame-plan.js'
import { setMaxAnisotropy, forgetTextures } from './render/texture-cache.js'
import { modelCache, forgetModel } from './render/model-cache.js'
import { forgetHull } from './render/keyline-hull.js'
import { clearReported } from './render/report.js'
import { makeCamera } from './render/camera.js'
import { makeLighting } from './render/lighting.js'
import { makeMaterialRegistry } from './render/material-registry.js'
import { makeObjectBuilder } from './render/object-builder.js'
import { makeBatching } from './render/batching.js'
import { makeReadability, makeReadabilityMarks } from './render/readability-marks.js'
import { makeEntitySync } from './render/entity-sync.js'
import { makeViewmodel } from './render/viewmodel.js'
import { makePostChain } from './render/post-chain.js'
import { makePicking } from './render/picking.js'
import { makeFrameDraw } from './render/frame-draw.js'

// Re-exported because the turn test reaches these readers through this file,
// where they used to live. `turnRadians` is frame-plan's; `turnObject` is
// entity-look's.
export { turnRadians } from './frame-plan.js'
export { turnObject } from './render/entity-look.js'

/**
 * Make the bone matrices upload once per skeleton, not once per skinned mesh.
 *
 * A skinned mesh reads its skeleton's bone matrices from a uniform buffer, and
 * three binds and uploads that buffer for every draw, so each of the thirteen
 * meshes over a rig uploads the same 455 matrices again — almost all of a
 * frame's buffer traffic. Past the uniform-buffer limit three uploads the
 * matrices once as a texture the skeleton shares, and the shader does the same
 * arithmetic either way.
 *
 * The limit is a device constant with no per-node override, so a skinned mesh's
 * own builder answers zero. Only that builder's skinning node changes path;
 * morph weights, instance matrices and every other buffer keep the real limit.
 * The marker stops a second module load from wrapping this twice.
 */
const uniformBufferLimit = THREE.NodeBuilder.prototype.getUniformBufferLimit
if (!uniformBufferLimit.forcedBoneTexture) {
  const boneTextureSkinned = function () {
    return this.object?.isSkinnedMesh ? 0 : uniformBufferLimit.call(this)
  }
  boneTextureSkinned.forcedBoneTexture = true
  THREE.NodeBuilder.prototype.getUniformBufferLimit = boneTextureSkinned
}

/**
 * Whether the project asked for the WebGL backend.
 *
 * Off unless stored as 'true': WebGPU is the default, and three falls back to
 * WebGL by itself where the browser has no WebGPU. A shader written only in
 * GLSL needs WebGL; one also written in TSL draws on either. Written by
 * `glsl.forceWebGL` and by the Render plugin's `backend`, and read here because
 * the backend is chosen during init, before any plugin has loaded.
 */
function wantsWebGL() {
  if (typeof localStorage === 'undefined') return false
  try { return localStorage.getItem('engine.forceWebGL') === 'true' } catch { return false }
}

/**
 * Build the GL context and return the renderer surface: sync, draw, pick, the
 * two hook points and the frame stats.
 *
 * `view` and `viewport` are handed in, not owned here.
 *
 * Where the camera looks and how big the picture is are game values — the
 * camera plugin moves one and clamps against the other — so they belong to the
 * session, which exists whether or not anything is drawing. The renderer reads
 * the same two objects the game does.
 */
/**
 * The no-op renderer a headless frame is built over.
 *
 * The scene graph and `sync` never touch the card, so a headless run can build
 * the real one and measure it. This stands in for the few properties the
 * drawing half reads, and every drawing call does nothing.
 */
function headlessRenderer() {
  return {
    setSize() {}, setPixelRatio() {}, getMaxAnisotropy: () => 1,
    autoClear: false, shadowMap: { enabled: false, type: THREE.PCFShadowMap },
    backend: null, hasFeature: () => false,
    info: { autoReset: false, reset() {}, render: {}, memory: {}, programs: [] },
    render() {}, clear() {}, clearDepth() {},
    setRenderTarget() {}, getRenderTarget: () => null,
    setClearColor() {}, getClearColor: color => color, getClearAlpha: () => 0,
    dispose() {}
  }
}

export async function makeRenderer(canvas, view, viewport) {
  // WebGPU where the browser has it, WebGL 2 where it does not. The backend
  // is chosen during init, which is why this function is async and why the
  // caller awaits a renderer rather than being handed one.
  // `trackTimestamp` asks the card how long the frame actually took on it.
  // That is an optional WebGPU feature: three turns it off by itself where it
  // is missing, and the number is then simply absent rather than wrong. CPU
  // time measures how long it took to describe a frame, which is a different
  // question and answers neither "is this shader heavy" nor "how many of these
  // can I draw".
  const headless = !canvas
  const renderer = headless ? headlessRenderer() : new THREE.WebGPURenderer({
    canvas, antialias: true, alpha: true, trackTimestamp: true,
    // Raw GLSL is inserted into the shader three generates, and the WebGPU
    // backend generates WGSL, so a project drawing GLSL-only shaders asks for
    // WebGL. Read here because the backend is chosen once, during init.
    forceWebGL: wantsWebGL()
  })
  if (headless) {
    // The counters survive both passes in a drawing world; a headless one still
    // reports them, as zero.
    renderer.autoClear = false
    renderer.info.autoReset = false
  } else {
    await renderer.init()
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    setMaxAnisotropy(renderer.getMaxAnisotropy())
    // The world and the viewmodel are two passes over one frame, so clearing is
    // this file's job rather than three's — and the counters have to survive
    // both renders to be worth reading.
    renderer.autoClear = false
    renderer.info.autoReset = false

    // Shadows cost nothing until a light asks for one — the shadow pass walks
    // the lights that cast and there are none by default — so the switch is on
    // and which lights cast is left to whoever owns the lights. Setting
    // `castShadow` on a light and having nothing happen, with no way to find out
    // why, is the failure this avoids.
    renderer.shadowMap.enabled = true
    // The node renderer dropped the soft variant and falls back to this one with
    // a warning. Asking for it directly says what is actually drawn.
    renderer.shadowMap.type = THREE.PCFShadowMap
  }

  const scene = new THREE.Scene()
  // Three refreshes every world matrix on each `renderer.render` call, and a
  // post chain can render the scene more than once. This file refreshes them
  // once in `draw` instead, so every pass reads the matrices the frame already
  // produced rather than rebuilding all of them. Explicit callers (`drawInto`,
  // `rayHits`) already refresh their own matrices.
  scene.matrixWorldAutoUpdate = false
  // The scene's own matrix never changes, so recomposing it would flag the whole
  // tree dirty and force every still object to re-multiply its world matrix.
  scene.matrixAutoUpdate = false

  // Everything the parts of the renderer share. Each factory in
  // `engine/render/` takes this and reads only the fields its concern needs; a
  // name is added here only when two modules must both reach it.
  const state = {
    canvas, view, viewport, headless, renderer, scene,
    meshes: new Map(),   // entity id -> the object standing for it
    /**
     * Whether a shadow map this frame needs redrawing.
     *
     * A shadow map changes only when a caster, a light or the scene changes.
     * Three redraws every map every frame, so this raises the flag on the frames
     * that changed something; `updateShadows` lowers it. A frame that changed
     * nothing draws the map it already has.
     */
    shadowDirty: true,
    /** Set when a sync builds an object for an id that had none. */
    objectsGrew: false,
    /**
     * Objects released while a post chain compiles, to be released again after.
     *
     * three's `compileAsync` lists every object in the scene when it starts and
     * makes a render record for each one when it ends. An object released between
     * the two gets a new record that nothing frees.
     */
    compilesRunning: 0,
    releasedWhileCompiling: new Set()
  }

  // The viewmodel builds its own camera, which `updateCamera` also drives, so
  // it is built before the two world cameras.
  makeViewmodel(state)
  makeCamera(state)
  makeLighting(state)
  makeMaterialRegistry(state)
  makeObjectBuilder(state)
  makeBatching(state)
  state.readability = makeReadability()
  makeReadabilityMarks(state)
  makeEntitySync(state)
  makePostChain(state)
  makePicking(state)
  makeFrameDraw(state)

  return {
    /**
     * Give the graphics card back everything this renderer holds.
     *
     * For a page that can no longer be driven: its dev server is gone, so it
     * cannot reload, be edited, or be read, and a heavy scene it keeps drawing
     * holds hundreds of megabytes for nothing. Nothing draws afterwards; the
     * page is finished.
     */
    release() {
      state.forgetDrawRecords()
      renderer.dispose()
    },

    // Both are the session's objects, re-exposed so existing plugins that reach
    // for renderer.view keep working.
    view,
    get size() { return { w: viewport.width, h: viewport.height } },
    scene,
    // The one currently drawing, so a caller that wants the camera gets the one
    // the picture came out of rather than whichever was built first.
    get camera() { return state.activeCamera() },
    get stats() { return { ...state.stats } },
    /**
     * Which backend is drawing, and which optional features it has.
     *
     * Both backends render, run node materials and TSL, and run compute — the
     * WebGL one through transform feedback. What the fallback lacks is optional
     * speed and quality, so nothing here may be REQUIRED: ask `has(name)` for a
     * named feature and keep a path that works without it. Never branch on the
     * backend's name; a feature is the honest question and the name is a guess
     * about what that feature implies.
     */
    get backend() {
      return {
        name: renderer.backend?.constructor?.name || 'unknown',
        webgpu: !renderer.backend?.isWebGLBackend,
        has: name => { try { return renderer.hasFeature(name) === true } catch { return false } }
      }
    },
    /** 'loading' | 'ready' | 'failed' | null — so a capture can wait for a
        declared model instead of shipping the placeholder box. */
    modelState: file => modelCache.get(file)?.status || null,
    // Which lights cast is a decision about the level, and the plugin that owns
    // the lights needs somewhere to read the switch and set its quality.
    get shadowMap() { return renderer.shadowMap },
    /**
     * three's own renderer, for a plugin that sets how the frame is rendered —
     * tone mapping, exposure, an environment map it has to build on the GPU.
     * How the picture looks is a plugin's decision, so this file holds none.
     */
    get threeRenderer() { return renderer },

    /**
     * Keyline width, contact shadow and ground ring, for everything that does
     * not say.
     *
     * Written to, not replaced: `renderer.readability.keyline = 3`. A colour
     * changed here reaches the next keyline built, not the ones already drawn.
     */
    readability: state.readability,

    resize: state.resize,
    frameSize: state.frameSize,
    forgetDrawRecords: state.forgetDrawRecords,

    /**
     * Push entity state into the scene graph. Called every frame.
     *
     * `blend` is `loop.blend`: bodies are drawn that far between their last two
     * fixed steps, so motion is smooth on a screen faster than the step rate.
     */
    sync(world, blend = 1) { state.sync(world, blend) },
    /** How long the card took on the last frame, in milliseconds. */
    gpuTime: state.gpuTime,
    /** Wait until the card has finished everything submitted so far. */
    waitForGPU: state.waitForGPU,
    /** Draw one frame: the world, then the post chain, then the viewmodel in its own pass. */
    draw: state.draw,
    /** One draw of the world scene into a caller-owned render target, its pixels read back into `buffer`. */
    drawInto: state.drawInto,

    // ---- the two hook points ----
    materials: state.materials,
    /** The ordered post-processing passes; an empty list means none at all. */
    passes: state.passes,

    /** The weapon in first person, in its own pass with its own depth buffer. */
    viewmodel: state.viewmodel,

    // ---- what the level says about light, fog and sky ----
    /** A flat background colour, or null to leave the page showing through. */
    setSky: state.setSky,
    /** Exponential-squared fog; density 0 turns it off outright. */
    setFog: state.setFog,
    setAmbient: state.setAmbient,
    /** The sun: which way it shines, how hard, and what colour. */
    setSun: state.setSun,

    // ---- coordinate helpers, used by every viewport tool ----
    toScreen: state.toScreen,
    toWorld: state.toWorld,
    pick: state.pick,
    ray: state.ray,

    bounds: entityDrawSize,

    /**
     * Drop a cached file so the next draw re-fetches it.
     *
     * Textures and models are cached by name for the life of the page, which is
     * right until someone edits one — then the cache is the reason the change
     * appears to do nothing. Every reading of the file goes, and the complaints
     * go with them so a file that is fixed can be complained about again if it
     * breaks a second time.
     */
    forget(file) {
      forgetTextures(file)
      forgetModel(file)
      forgetHull(file)
      clearReported()
      state.invalidateEverything()
    }
  }
}
