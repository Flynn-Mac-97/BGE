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
 * A visual drawn beside one entity — a keyline, a contact shadow, a ground
 * ring — is a mark, and a mark belongs to a plugin. The `marks` registry is the
 * door: the Readability plugin registers all three through it, and so may any
 * other. This file holds the registry and the one place the sync writes a mark,
 * and it never learns what a keyline is.
 *
 * The draw order is the pass graph's: the kernel registers `frame`, `clear`,
 * `scene`, `ui` and `present`, and a plugin adds its own pass between the
 * labels. A first-person weapon, a post chain and a screen effect are all
 * passes, so this file never learns what any of them is.
 *
 * There are three doors into a frame and no more: `graph` is the pass graph, the
 * one place a pass is registered and ordered; `materials` is what a surface is
 * made of; and `marks` is a visual drawn beside one entity. All are
 * deliberately dumb. A renderer that holds the list of materials a game uses,
 * the marks it draws, the passes it runs, or the way it draws the world, has
 * started to know what the game is — and in this engine that knowledge lives in
 * a plugin. This file owns one GL context and one draw order, and it must never
 * learn what bloom is.
 *
 * What it does know about is cost. Several hundred walls that never move are
 * merged by material into a handful of meshes, each one still small enough to be
 * frustum-culled, and `stats` reports what that bought so the next change here
 * can be measured rather than argued about.
 *
 * The implementation is one concern per module under `engine/render/`. This file
 * owns the GL context, the state every part of the renderer shares, and the
 * surface a caller sees; `draw` drives a frame, and `sync` runs the graph's
 * extract phase for a caller that wants the scene built without drawing it.
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
import { clearReported } from './render/report.js'
import { makeCamera } from './render/camera.js'
import { makeLighting } from './render/lighting.js'
import { makeMaterialRegistry } from './render/material-registry.js'
import { makeObjectBuilder } from './render/object-builder.js'
import { makeBatching } from './render/batching.js'
import { makeMarkRegistry } from './render/mark-registry.js'
import { makeEntitySync } from './render/entity-sync.js'
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
  try {
    return localStorage.getItem('engine.forceWebGL') === 'true'
  } catch {
    return false
  }
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
    setSize() {},
    setPixelRatio() {},
    getMaxAnisotropy: () => 1,
    autoClear: false,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap },
    backend: null,
    hasFeature: () => false,
    // eslint-disable-next-line id-denylist -- three.js names this renderer field info.
    info: { autoReset: false, reset() {}, render: {}, memory: {}, programs: [] },
    render() {},
    clear() {},
    clearDepth() {},
    setRenderTarget() {},
    getRenderTarget: () => null,
    setClearColor() {},
    getClearColor: color => color,
    getClearAlpha: () => 0,
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
  // The ratio the drawing buffer uses. A headless world has no screen, so its
  // buffer is the viewport, one pixel per pixel.
  const initialPixelRatio = headless ? 1 : Math.min(devicePixelRatio, 2)
  const renderer = headless
    ? headlessRenderer()
    : new THREE.WebGPURenderer({
        canvas,
        antialias: true,
        alpha: true,
        trackTimestamp: true,
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
    renderer.setPixelRatio(initialPixelRatio)
    setMaxAnisotropy(renderer.getMaxAnisotropy())
    // The frame is several passes over one target, so clearing is this file's
    // job rather than three's — and the counters have to survive every pass to
    // be worth reading.
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

  /**
   * Whether the device reports a named optional feature.
   *
   * The graph asks this before it runs a pass that declares `requires`, so a
   * pass this device cannot run is dropped rather than failing at draw. The
   * surface's `backend.has` is the same answer, from the same call.
   */
  const deviceHasFeature = name => {
    try {
      return renderer.hasFeature(name) === true
    } catch {
      return false
    }
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
    canvas,
    view,
    viewport,
    headless,
    renderer,
    // The device's own feature answer, and the ratio its drawing buffer uses.
    hasFeature: deviceHasFeature,
    pixelRatio: initialPixelRatio,
    scene,
    meshes: new Map(), // entity id -> the object standing for it
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

  makeCamera(state)
  makeLighting(state)
  makeMaterialRegistry(state)
  makeObjectBuilder(state)
  makeBatching(state)
  // The marks registry is empty until a plugin registers into it. The
  // Readability plugin fills this object in place with its own defaults.
  makeMarkRegistry(state)
  state.readability = {}
  makeEntitySync(state)
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

    /**
     * The scene object standing for one entity, or null before it is built.
     *
     * The id-to-object map the sync already holds, so a plugin does not have to
     * traverse `renderer.scene` looking for `userData.entity`.
     */
    objectFor: entity => state.meshes.get(entity?.id) ?? null,

    /**
     * Release one object the scene owns: dispose it and its children, and drop
     * three's records for them. A plugin that adds a scene object releases it
     * here rather than leaving a draw record behind.
     */
    dispose: state.release,

    // Both are the session's objects, re-exposed so existing plugins that reach
    // for renderer.view keep working.
    view,
    get size() {
      return { w: viewport.width, h: viewport.height }
    },
    scene,
    // The one currently drawing, so a caller that wants the camera gets the one
    // the picture came out of rather than whichever was built first.
    get camera() {
      return state.activeCamera()
    },
    get stats() {
      return { ...state.stats }
    },
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
        has: deviceHasFeature
      }
    },
    /** 'loading' | 'ready' | 'failed' | null — so a capture can wait for a
        declared model instead of shipping the placeholder box. */
    modelState: file => modelCache.get(file)?.status || null,
    // Which lights cast is a decision about the level, and the plugin that owns
    // the lights needs somewhere to read the switch and set its quality.
    get shadowMap() {
      return renderer.shadowMap
    },
    /**
     * three's own renderer, for a plugin that sets how the frame is rendered —
     * tone mapping, exposure, an environment map it has to build on the GPU.
     * How the picture looks is a plugin's decision, so this file holds none.
     */
    get threeRenderer() {
      return renderer
    },

    /**
     * The defaults the Readability plugin's marks fall back to, filled by that
     * plugin when it loads. Empty when it is absent.
     *
     * Written to, not replaced: `renderer.readability.keyline = 3`. A colour
     * changed here reaches the next keyline built, not the ones already drawn.
     */
    readability: state.readability,

    resize: state.resize,
    frameSize: state.frameSize,
    /** The ratio the drawing buffer uses. */
    get pixelRatio() {
      return state.pixelRatio
    },
    /** Take a new ratio: the buffer, the camera and the pooled targets follow it. */
    setPixelRatio: state.setPixelRatio,
    forgetDrawRecords: state.forgetDrawRecords,

    /**
     * Defer disposal while a pass compiles its shaders.
     *
     * three's `compileAsync` lists the scene's objects when it starts and makes a
     * render record for each when it ends, so an object released in between gets
     * a record nothing frees. A pass that compiles wraps that work in these two;
     * `endCompile` disposes anything released meanwhile a second time.
     */
    beginCompile() {
      state.compilesRunning++
    },
    endCompile() {
      state.compilesRunning--
      state.releaseAgainAfterCompile()
    },

    /**
     * Build the scene graph without drawing it.
     *
     * Runs the graph's extract phase, so the scene pass walks the entities and
     * every other pass's extract runs too. The walk belongs to the scene pass,
     * not the kernel: a plugin that replaces that pass replaces the walk. A
     * `draw` that follows reuses that extract, so the pair walks once; the play
     * loop calls `draw(world, blend)` alone.
     */
    sync(world, blend = 1) {
      const graph = state.graph
      graph.frame.world = world
      graph.frame.blend = blend
      graph.extract()
    },
    /** How long the card took on the last frame, in milliseconds. */
    gpuTime: state.gpuTime,
    /** Wait until the card has finished everything submitted so far. */
    waitForGPU: state.waitForGPU,
    /** Draw one frame from a world: the graph's passes in order, then the counters. */
    draw: state.draw,
    /** One draw of the world scene into a caller-owned render target, its pixels read back into `buffer`. */
    drawInto: state.drawInto,

    // ---- the three hook points ----
    materials: state.materials,
    /**
     * The per-entity marks: a visual drawn beside one entity, by name.
     *
     * `register(name, { draw })` and `remove(name)`. `draw(entity, object,
     * place, declared, record)` runs once per mesh entity the sync visits. A
     * mark may also carry optional frame hooks — `begin`, `grow`, `move`,
     * `place`, `count`, `holds`, `holdsMoving`, `heldId`, `changed`,
     * `blocksMerge`, `forget` — so the core drives it without knowing its name.
     */
    marks: state.marks,
    /**
     * The pass graph: the ordered draws one frame runs, orderable by label.
     *
     * `add`, `remove`, `replace`, `disable` and `enable` change the pass set;
     * `passes` is the live order and `run` is the executor. A plugin that draws
     * its own frame adds a pass and disables the core draw it takes over, so the
     * kernel draw never runs underneath it.
     */
    graph: state.graph,

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
      state.forgetMarks(file)
      clearReported()
      state.invalidateEverything()
    }
  }
}
