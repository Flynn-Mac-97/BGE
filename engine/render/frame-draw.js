/**
 * Kernel: one frame out of the card, and what the last one cost.
 *
 * The frame is the default graph — `frame`, `clear`, `scene`, `ui`, `present`
 * — registered through the same door a plugin uses. `frame` updates world
 * matrices and shadow flags before any draw; `clear` clears the canvas; `scene`
 * walks the entities into scene objects in its `extract` and draws them in its
 * `execute`. A post chain is a plugin pass: it registers through `graph.add`
 * and disables `clear` and `scene` while its own pass draws the frame, so no
 * effect list reaches this file. The graph executor runs the passes, so this
 * file supplies the draws and the counters, not the order.
 */
import * as THREE from 'three/webgpu'
import { makePassGraph } from './graph.js'
import { reportOnce } from './report.js'

/** Builds the frame draw controller for one render state: the default graph and its stats. */
export function makeFrameDraw(state) {
  /**
   * What the last frame cost.
   *
   * Read as `context.renderer.stats`. It exists so that the next change to this
   * file can be measured rather than guessed at: `drawCalls` before and after is
   * the whole argument for merging, and `merged` against `entities` says how
   * much of the map the merge actually caught.
   */
  const stats = {
    drawCalls: 0,
    triangles: 0,
    entities: 0,
    merged: 0,
    batches: 0,
    // One draw call each, and one for every contact shadow together — one more
    // for every ground ring together.
    keylines: 0,
    contactShadows: 0,
    groundRings: 0,
    materials: 0,
    textures: 0,
    geometries: 0,
    programs: 0,
    // Milliseconds the card spent on the last frame it reported. Null where the
    // backend cannot time itself, which is every WebGL 2 one.
    gpuMs: null,
    // Whether a post pass draws this frame.
    post: 'none',
    // Milliseconds spent describing the last frame, on this thread.
    cpuMs: 0
  }

  // A pass that declares `depth: 'clear'` empties the depth buffer before it
  // draws. The graph holds no renderer, so the one call is supplied here.
  //
  // `hasFeature` is the device's own answer, so a pass that declares a feature
  // this device lacks is dropped before it runs. `pixelRatio` sizes a target to
  // the drawing buffer rather than to the CSS viewport.
  const graph = makePassGraph({
    clearDepth: () => state.renderer.clearDepth(),
    hasFeature: state.hasFeature,
    pixelRatio: state.pixelRatio
  })
  state.graph = graph

  /** The core world draw: the scene straight to the frame. */
  function drawScene(frame) {
    state.renderer.render(state.scene, frame.camera)
  }

  // The default graph, ordered by label. `frame`, `clear`, `scene`, `ui` and
  // `present` are the kernel's labels; a plugin orders against them and adds
  // its own passes between. `frame` runs even while a plugin owns the scene,
  // because world matrices and shadow flags are frame setup, not a draw, and
  // every draw reads them.
  graph.add({
    name: 'frame',
    before: ['clear'],
    prepare: () => {
      state.scene.updateMatrixWorld()
      state.updateShadows()
    },
    execute: () => {}
  })
  graph.add({ name: 'clear', after: ['frame'], before: ['scene'], execute: () => state.renderer.clear() })
  // The entity walk is this pass's extract, not the kernel's. Replacing or
  // disabling the scene pass removes the walk with the draw it feeds.
  graph.add({
    name: 'scene',
    after: ['clear'],
    before: ['ui'],
    extract: frame => state.sync(frame.world, frame.blend),
    execute: drawScene
  })
  graph.add({ name: 'ui', after: ['scene'], before: ['present'], execute: () => {} })
  graph.add({ name: 'present', after: ['ui'], execute: () => {} })

  /**
   * How long the card took on the last frame, in milliseconds.
   *
   * Awaited rather than read, because the answer lands a frame or two behind.
   * Null where the backend cannot time itself.
   */
  async function gpuTime() {
    if (!state.renderer.backend?.trackTimestamp) return null
    try {
      await state.renderer.resolveTimestampsAsync('render')
      return state.renderer.info.render.timestamp || null
    } catch {
      return null
    }
  }

  /**
   * Wait until the card has finished everything submitted so far.
   *
   * Both backends queue work and return at once, so wall-clock time taken
   * around a draw measures this thread and not the card — a heavy shader can
   * read FASTER that way than a cheap one, because the thread does less
   * waiting per submission. This is the barrier that makes a wall-clock
   * measurement include the card's own work.
   *
   * Asked for by feature, never by backend name: WebGPU has a promise that
   * settles when the queue drains, WebGL 2 has a blocking finish. False where
   * neither is reachable, which is the caller's cue not to report a
   * wall-clock number as a GPU cost.
   */
  async function waitForGPU() {
    const backend = state.renderer.backend
    try {
      if (backend?.device?.queue?.onSubmittedWorkDone) {
        await backend.device.queue.onSubmittedWorkDone()
        return true
      }
      if (backend?.gl) {
        // One pixel read back, not `finish()`. Chrome runs WebGL in another
        // process and returns from `finish()` before the card is done, so a
        // wall-clock measurement built on it reads a heavy shader as cheap.
        // A synchronous read cannot return until the pixel exists.
        const glContext = backend.gl
        glContext.finish()
        glContext.readPixels(0, 0, 1, 1, glContext.RGBA, glContext.UNSIGNED_BYTE, new Uint8Array(4))
        return true
      }
    } catch {
      return false
    }
    return false
  }

  /** Whether a post pass draws this frame. An indexed walk allocates nothing. */
  function drawsPost() {
    const ordered = graph.passes
    for (let index = 0; index < ordered.length; index++) if (ordered[index].name === 'post') return true
    return false
  }

  /**
   * Copy what the card reports into `stats`, for a frame that has a card.
   *
   * GPU time is resolved without waiting: the answer lands a frame or two later
   * and is read off `info` then. Awaiting here would stall the thread on the
   * card every frame, which would change the very thing being measured.
   */
  function readCounters(startedAt) {
    stats.cpuMs = performance.now() - startedAt
    stats.drawCalls = state.renderer.info.render.drawCalls
    stats.triangles = state.renderer.info.render.triangles
    stats.textures = state.renderer.info.memory.textures
    stats.geometries = state.renderer.info.memory.geometries
    stats.programs = state.renderer.info.programs?.length || 0
    if (state.renderer.backend?.trackTimestamp) {
      state.renderer.resolveTimestampsAsync('render').catch(() => {})
      stats.gpuMs = state.renderer.info.render.timestamp || null
    }
  }

  /**
   * Draw one frame from a world: the graph's passes in order, then the counters.
   *
   * A call with no world reuses the one the last `sync` stored, and that sync
   * already ran the extract, so a sync-then-draw pair walks the world once.
   *
   * A throw outside the passes — a camera that will not build, a device call
   * that fails — is reported and the frame returns. The graph already contains
   * a pass that throws, so this is the outer boundary that keeps the draw from
   * reaching the loop: a half-drawn frame is a frame, a stopped loop is not.
   */
  function draw(world = graph.frame.world, blend = graph.frame.blend ?? 1) {
    // A lost device cannot be drawn on. Report the first skip and return, so
    // the loop keeps ticking and never asks the dead device again.
    if (state.deviceLost) {
      reportOnce('[render] the frame was skipped because the device is lost')
      return
    }
    const startedAt = performance.now()
    try {
      const camera = state.readyCamera()
      state.renderer.info.reset()
      // The scene pass's extract reads these. A pass set with no scene extract
      // never reaches the walk; the fields cost one store either way.
      graph.frame.world = world
      graph.frame.blend = blend

      graph.run(camera, state.renderer.getRenderTarget(), state.viewport.width, state.viewport.height)

      stats.post = drawsPost() ? 'drawing' : 'none'
      // A headless frame has no card to draw into. The passes still run, so a
      // plugin's draw and the frame handed to it can be exercised with no GL, but
      // nothing is submitted and no card time is reported.
      if (state.headless) return
      readCounters(startedAt)
    } catch (error) {
      reportOnce(`[render] draw stopped — ${error?.message || error}`)
    }
  }

  /**
   * One draw of the world scene into a caller-owned render target, the
   * pixels read straight back into `buffer`.
   *
   * This is how a query consumes a frame as data — the See plugin's ID
   * buffer — without the canvas being touched: the bound target and the
   * clear colour are restored before returning. The clear colour is forced
   * to zero for the draw so an unwritten pixel reads back as nothing rather
   * than as whatever the page background is. What the caller changed for
   * its pass — materials, layers, visibility, the scene background — is the
   * caller's to restore. `region` is in target pixels from the bottom left,
   * because that is the orientation GL reads back in.
   */
  async function drawInto(target, buffer, region = null) {
    // A query is a draw too: with no device there are no pixels to read, and
    // zeros are the truth rather than a throw.
    if (state.deviceLost) {
      buffer.fill(0)
      reportOnce('[render] the readback was skipped because the device is lost')
      return buffer
    }
    const camera = state.readyCamera()
    state.scene.updateMatrixWorld()
    const keptTarget = state.renderer.getRenderTarget()
    const keptColour = state.renderer.getClearColor(new THREE.Color())
    const keptAlpha = state.renderer.getClearAlpha()
    state.renderer.setClearColor(0x000000, 0)
    state.renderer.setRenderTarget(target)
    state.renderer.clear()
    await state.renderer.renderAsync(state.scene, camera)
    const read = region || { x: 0, y: 0, width: target.width, height: target.height }
    // Reading a target back is asynchronous on this renderer. The bytes are
    // returned rather than filled in, so they are copied into the caller's
    // buffer here and every caller awaits.
    const pixels = await state.renderer.readRenderTargetPixelsAsync(target, read.x, read.y, read.width, read.height)
    buffer.set(pixels.subarray(0, buffer.length))
    state.renderer.setRenderTarget(keptTarget)
    state.renderer.setClearColor(keptColour, keptAlpha)
    return buffer
  }

  /**
   * Draw the entity scene from a view that is not the session camera, into a
   * target the kernel owns.
   *
   * The scene pass's walk already built the scene objects, so this is a draw
   * and not a sync: the same scene is drawn again from another camera and the
   * world is not walked a second time. It runs inside a pass's execute with the
   * target the pass declared, so the graph pools that target, sizes it with the
   * viewport, rebuilds it after a device restore, frees it when nothing
   * declares it, and the executor attributes the draw's cost to the pass.
   *
   * `view` is a plain record of camera parameters — the shape `cameraProjection`
   * reads. The target's pixel size is the viewport for that projection, so the
   * view's aspect matches what it is drawn into. The target is cleared first,
   * because a pooled target holds the last thing drawn into it and no other
   * door clears one. The bound target is put back before returning.
   */
  function drawView(view, target) {
    const camera = state.viewCamera(view, { width: target.width, height: target.height })
    const keptTarget = state.renderer.getRenderTarget()
    state.renderer.setRenderTarget(target)
    state.renderer.clear()
    state.renderer.render(state.scene, camera)
    state.renderer.setRenderTarget(keptTarget)
  }

  state.stats = stats
  state.gpuTime = gpuTime
  state.waitForGPU = waitForGPU
  state.draw = draw
  state.drawInto = drawInto
  state.drawView = drawView
}
