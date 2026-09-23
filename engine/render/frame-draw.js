/**
 * Kernel: one frame out of the card, and what the last one cost.
 *
 * The frame is the default graph — `clear`, `scene`, `post`, `viewmodel`, `ui`,
 * `present` — registered through the same door a plugin uses. `scene` draws the
 * world unless a post chain owns it; `post` draws the chain; `viewmodel` draws
 * the weapon against a cleared depth buffer. The graph executor runs them, so
 * this file supplies the draws and the counters, not the order.
 */
import * as THREE from 'three/webgpu'
import { makePassGraph } from './graph.js'
import { makeFrameStages } from './frame-stages.js'

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
    drawCalls: 0, triangles: 0,
    entities: 0, merged: 0, batches: 0,
    // One draw call each, and one for every contact shadow together — one more
    // for every ground ring together.
    keylines: 0, contactShadows: 0, groundRings: 0,
    materials: 0, textures: 0, geometries: 0, programs: 0,
    // Milliseconds the card spent on the last frame it reported. Null where the
    // backend cannot time itself, which is every WebGL 2 one.
    gpuMs: null,
    // Whether the post chain draws, or is still compiling its shaders.
    post: 'none',
    // Milliseconds spent describing the last frame, on this thread.
    cpuMs: 0
  }

  const graph = makePassGraph()
  state.graph = graph

  /** The core world draw: the scene straight to the frame, or nothing when a chain owns it. */
  function drawScene(frame) {
    if (state.postChainActive()) return
    state.renderer.render(state.scene, frame.camera)
  }

  /** The core post draw: the chain when one owns the world, nothing otherwise. */
  function drawPost(frame) {
    if (!state.postChainActive()) return
    state.postDrawWorld(frame.camera)
  }

  /** The viewmodel draw, in its own pass over a cleared depth buffer. */
  function drawViewmodel() {
    state.viewmodelDraw()
  }

  // The default graph, ordered by label. The four labels `clear`, `scene`, `ui`
  // and `present` are the kernel's; `post` and `viewmodel` are the step-one
  // bridge passes that keep the current picture and become plugin passes next.
  // The chain owns the clear of its own targets, and while it compiles the
  // canvas keeps its last frame, so this pass clears only when the scene will
  // draw straight to the canvas.
  graph.add({ name: 'clear', before: ['scene'], execute: () => { if (!state.postChainActive()) state.renderer.clear() } })
  graph.add({
    name: 'scene', after: ['clear'], before: ['post'],
    // One world-matrix update per frame. The renderer would otherwise repeat it
    // for every scene pass, so it is CPU work that must finish before any draw.
    prepare: () => { state.scene.updateMatrixWorld(); state.updateShadows() },
    execute: drawScene
  })
  graph.add({ name: 'post', after: ['scene'], before: ['viewmodel'], execute: drawPost })
  graph.add({ name: 'viewmodel', after: ['post'], before: ['ui'], execute: drawViewmodel })
  graph.add({ name: 'ui', after: ['viewmodel'], before: ['present'], execute: () => {} })
  graph.add({ name: 'present', after: ['ui'], execute: () => {} })

  makeFrameStages(state, { world: drawScene, post: drawPost, viewmodel: drawViewmodel })

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
        const gl = backend.gl
        gl.finish()
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
        return true
      }
    } catch {
      return false
    }
    return false
  }

  /** Draw one frame: the graph's passes in order, then the counters. */
  function draw() {
    const startedAt = performance.now()
    const camera = state.readyCamera()
    state.renderer.info.reset()

    graph.run(camera, state.renderer.getRenderTarget(), state.viewport.width, state.viewport.height)

    stats.post = state.postStatus()
    // A headless frame has no card to draw into. The passes still run, so a
    // plugin's draw and the frame handed to it can be exercised with no GL, but
    // nothing is submitted and no card time is reported.
    if (state.headless) return
    stats.cpuMs = performance.now() - startedAt
    stats.drawCalls = state.renderer.info.render.drawCalls
    stats.triangles = state.renderer.info.render.triangles
    stats.textures = state.renderer.info.memory.textures
    stats.geometries = state.renderer.info.memory.geometries
    stats.programs = state.renderer.info.programs?.length || 0
    // Resolved without waiting: the answer lands a frame or two later and is
    // read off `info` then. Awaiting here would stall the thread on the card
    // every frame, which would change the very thing being measured.
    if (state.renderer.backend?.trackTimestamp) {
      state.renderer.resolveTimestampsAsync('render').catch(() => {})
      stats.gpuMs = state.renderer.info.render.timestamp || null
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
    const pixels = await state.renderer.readRenderTargetPixelsAsync(
      target, read.x, read.y, read.width, read.height)
    buffer.set(pixels.subarray(0, buffer.length))
    state.renderer.setRenderTarget(keptTarget)
    state.renderer.setClearColor(keptColour, keptAlpha)
    return buffer
  }

  state.stats = stats
  state.gpuTime = gpuTime
  state.waitForGPU = waitForGPU
  state.draw = draw
  state.drawInto = drawInto
}
