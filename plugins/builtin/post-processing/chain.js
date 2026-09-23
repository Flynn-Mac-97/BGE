/**
 * Post Processing's chain: the ordered effects, composed into one pass record.
 *
 * This lives with the plugin because the effects a game wants are a game
 * decision. The kernel hands over the device, the scene and the camera; this
 * builds one three RenderPipeline over the scene. The plugin registers the
 * result as a `post` pass through `renderer.graph`, which orders and runs it
 * like any other pass.
 */
import * as THREE from 'three/webgpu'
import { mrt, output, pass, vec4 } from 'three/tsl'
import * as TSL from 'three/tsl'
import { reportOnce } from '../../../engine/render/report.js'

export function makePostChain(renderer) {
  // The effects, in draw order. An empty list takes the chain down: no render
  // target, no pipeline, no cost.
  let passList = []
  // The chain that draws, and the one whose shaders are still compiling.
  // Each is `{ list, camera, chain, passes }`.
  let built = null
  let warming = null
  // The node frame the last post draw used; a draw that finds it unchanged advances it.
  let drawnFrameId = null

  /**
   * Build the chain, or take it down.
   *
   * An effect is `{ name, needsNormals, apply(colour, parts) }` — a function
   * from the picture so far to a new picture. That is the whole contract: this
   * file still holds no opinion about what an effect does, only about the order
   * they run in and about what the scene pass can offer them.
   *
   * `parts` carries what an effect cannot make for itself: the scene pass, the
   * camera, and — when anything asked for one — depth and view-space normals
   * read from that same pass. Normals are reconstructed from depth rather than
   * drawn in a second pass, so `needsNormals` costs no extra geometry pass.
   *
   * `parts.sceneOutput(name)` is one more buffer the scene pass writes, named as
   * three's TSL names it (`diffuseColor`, `velocity`). Every effect's requests
   * go into one set of outputs, so two effects never replace each other's.
   * An effect with `singleSample` turns multisampling off on the scene pass,
   * because its outputs are read per sample, as temporal antialiasing does. A
   * depth read also needs multisampling off, so `needsNormals` turns it off too.
   */
  /** The scene pass, with multisampling off when something needs a per-sample read. */
  function scenePassFor(list, camera, needsNormals) {
    const perSample = list.some(effect => effect.singleSample) || needsNormals
    return perSample ? pass(renderer.scene, camera, { samples: 0 }) : pass(renderer.scene, camera)
  }

  /**
   * The buffers the scene pass offers an effect.
   *
   * `sceneOutput(name)` is one more buffer the scene pass writes, named as three's
   * TSL names it (`diffuseColor`, `velocity`). Every effect's requests go into one
   * set of outputs, so two effects never replace each other's.
   */
  function postParts(scenePass, camera, outputs) {
    return {
      scene: scenePass, depth: null, normal: null, camera,
      sceneOutput(name) {
        if (!TSL[name]) throw new Error(`three has no scene output called "${name}"`)
        outputs[name] = TSL[name]
        return scenePass.getTextureNode(name)
      }
    }
  }

  /** Read depth, and view-space normals reconstructed from it, from the colour pass. */
  function readNormals(parts, scenePass) {
    const depth = scenePass.getTextureNode('depth')
    // Rendered once to a texture because ambient occlusion and denoise sample
    // normals at neighbouring pixels rather than only at their own.
    const normals = TSL.getNormalFromDepth(TSL.screenUV, depth, TSL.cameraProjectionMatrixInverse)
    parts.depth = depth
    parts.normal = TSL.convertToTexture(vec4(normals, 1))
  }

  /** Run each effect over the picture so far, skipping any that fails to build. */
  function applyEffects(list, colour, parts) {
    for (const effect of list) {
      try {
        const next = effect.apply?.(colour, parts)
        if (next) colour = next
        else reportOnce(`[render] passes: "${effect.name || 'an effect'}" returned nothing — it is skipped and the rest of the chain still runs`)
      } catch (error) {
        reportOnce(`[render] passes: "${effect.name || 'an effect'}" could not be built — ${error?.message || error}. It is skipped and the rest of the chain still runs.`)
      }
    }
    return colour
  }

  /** Compile one pass list for one camera into a drawable chain. */
  function buildPost(list, camera) {
    const needsNormals = list.some(effect => effect.needsNormals)
    const scenePass = scenePassFor(list, camera, needsNormals)
    const outputs = { output }
    const parts = postParts(scenePass, camera, outputs)
    if (needsNormals) readNormals(parts, scenePass)
    const colour = applyEffects(list, scenePass, parts)
    if (Object.keys(outputs).length > 1) scenePass.setMRT(mrt(outputs))

    // Renamed in this version of three; the old name still works and warns.
    const Pipeline = THREE.RenderPipeline || THREE.PostProcessing
    const chain = new Pipeline(renderer.threeRenderer)
    chain.outputNode = colour
    return { list, camera, chain, passes: [scenePass] }
  }

  /**
   * Compiled chains for the current pass list, one per camera.
   *
   * The editor draws through the orthographic camera and play through the
   * perspective one, so every play and stop swaps cameras. Keeping the chain
   * for each means a swap back draws at once instead of compiling again: a
   * heavy scene took over six seconds per compile and drew nothing meanwhile.
   */
  const readyChains = new Map()
  // A camera asked for while another chain compiles, built when that one ends.
  let warmNext = null

  /**
   * Build the chain for this list and camera, and swap it in once its scene
   * shaders are compiled.
   *
   * Compiling on first draw blocks the page: the character scene builds about
   * 90 GPU pipelines and froze the editor for 9 seconds on the switch to 3D.
   * `compileAsync` builds them off the page's thread, and the old chain keeps
   * drawing until they are ready. One compile runs at a time: overlapping ones
   * made records for objects the scene had already dropped.
   */
  function warmPost(camera) {
    if (warming?.list === passList && warming.camera === camera) return
    const ready = readyChains.get(camera)
    if (ready?.list === passList) { built = ready; return }
    if (warming) { warmNext = camera; return }
    const next = buildPost(passList, camera)
    warming = next
    // One pass at a time: each keeps its target and outputs set on the
    // renderer until it finishes, and shaders are built against those.
    renderer.beginCompile()
    next.passes.reduce((before, one) => before.then(() => one.compileAsync(renderer.threeRenderer)), Promise.resolve())
      .catch(error => reportOnce(`[render] passes: shaders could not be compiled ahead — ${error?.message || error}. They compile on first draw instead.`))
      .finally(() => {
        renderer.endCompile()
        if (warming !== next) return
        warming = null
        keepChain(next)
        const camera = warmNext
        warmNext = null
        if (camera) warmPost(camera)
      })
  }

  /** Draw with a compiled chain, and dispose any built for an older pass list. */
  function keepChain(entry) {
    let dropped = false
    for (const [camera, old] of readyChains) {
      if (old.list !== passList) { old.chain.dispose?.(); readyChains.delete(camera); dropped = true }
    }
    if (dropped) renderer.forgetDrawRecords()
    if (entry.list !== passList) { entry.chain.dispose?.(); return }
    readyChains.get(entry.camera)?.chain.dispose?.()
    readyChains.set(entry.camera, entry)
    built = entry
  }

  /** Dispose every post chain and forget them, so the next draw builds fresh. */
  function dropPost() {
    warming?.chain.dispose?.()
    for (const entry of readyChains.values()) entry.chain.dispose?.()
    readyChains.clear()
    warmNext = null
    warming = built = null
  }

  /**
   * Replace the whole chain.
   *
   * The only door: Post Processing resolves the level's declaration into an
   * ordered list of effects and states it here. An empty list takes the chain
   * down, so a game with no effects builds no target.
   */
  function setChain(list) {
    passList = Array.isArray(list) ? list.filter(Boolean) : []
    if (!passList.length) dropPost()
  }

  /** Whether the built chain was made for another pass list or another camera. */
  function chainIsStale(camera) {
    return built?.list !== passList || built.camera !== camera
  }

  /**
   * Advance three's node frame when a second draw lands in one animation tick.
   *
   * A pass renders its scene once per node frame, and three advances that frame
   * only on its own animation tick. A second draw in one tick, such as See drawing
   * from another camera, would show the tick's first view.
   */
  function advanceNodeFrame() {
    const nodeFrame = renderer.threeRenderer._nodes?.nodeFrame
    if (nodeFrame && nodeFrame.frameId === drawnFrameId) nodeFrame.update()
    drawnFrameId = nodeFrame?.frameId
  }

  /**
   * Draw the world: the post chain when one is built, the scene straight to the
   * canvas otherwise, and nothing while a chain compiles.
   *
   * The editor draws through an orthographic camera and play through a
   * perspective one. A pass holds the camera it was built with, so the chain is
   * rebuilt when that camera is swapped rather than sampling the wrong depth for
   * a frame. No draw happens while a chain compiles: the canvas keeps its last
   * frame, because compiling keeps a pass's target and outputs set on the
   * renderer and a draw now would build pipelines for the wrong outputs.
   */
  function postDrawWorld(camera) {
    if (chainIsStale(camera)) warmPost(camera)
    if (warming) return
    if (built) {
      advanceNodeFrame()
      built.chain.render()
    }
  }

  /** Whether a chain is built, still compiling, or absent. */
  function postStatus() {
    return built ? (warming ? 'drawing, next chain compiling' : 'drawing') : warming ? 'compiling' : 'none'
  }

  return {
    /** Replace the whole chain; a list of effects, in draw order. */
    set: setChain,
    /** Draw the frame: the chain when one is built, nothing while it compiles. */
    draw: postDrawWorld,
    /** Whether a chain is built, still compiling, or absent. */
    status: postStatus
  }
}
