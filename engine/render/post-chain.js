/**
 * Kernel: an ordered list of passes, and no opinion whatever about what they do.
 */
import * as THREE from 'three/webgpu'
import { mrt, output, pass, vec4 } from 'three/tsl'
import * as TSL from 'three/tsl'
import { reportOnce } from './report.js'

export function makePostChain(state) {
  /**
   * An ordered list of passes, and no opinion whatever about what they do.
   *
   * The renderer must not grow a list of effects. Which effects a game wants —
   * bloom on the muzzle flash, a flashbang wash, a scope blur — is a decision
   * the game makes and therefore a decision a plugin makes, and putting the list
   * here is the tempting wrong answer that turns one GL context into a framework.
   * All this knows is the order, and that an empty list means draw straight to
   * the canvas: no chain, no render target, no cost.
   */
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
  function buildPost(list, camera) {
    const needsNormals = list.some(effect => effect.needsNormals)
    // Ambient occlusion samples normals at low resolution, so a second full
    // geometry pass only to produce them is wasted. Reconstruct view-space
    // normals from the colour pass's own depth instead. The colour pass then
    // must not be multisampled, because a multisampled depth texture cannot be
    // read back; the level's own antialiasing pass still runs.
    const scenePass = list.some(effect => effect.singleSample) || needsNormals
      ? pass(state.scene, camera, { samples: 0 })
      : pass(state.scene, camera)

    const outputs = { output }
    const parts = {
      scene: scenePass, depth: null, normal: null, camera,
      sceneOutput(name) {
        if (!TSL[name]) throw new Error(`three has no scene output called "${name}"`)
        outputs[name] = TSL[name]
        return scenePass.getTextureNode(name)
      }
    }
    const passes = [scenePass]
    if (needsNormals) {
      const depth = scenePass.getTextureNode('depth')
      // Rendered once to a texture because ambient occlusion and denoise sample
      // normals at neighbouring pixels rather than only at their own.
      const normals = TSL.getNormalFromDepth(TSL.screenUV, depth, TSL.cameraProjectionMatrixInverse)
      parts.depth = depth
      parts.normal = TSL.convertToTexture(vec4(normals, 1))
    }

    let colour = scenePass
    for (const effect of list) {
      try {
        const next = effect.apply?.(colour, parts)
        if (next) colour = next
        else reportOnce(`[render] passes: "${effect.name || 'an effect'}" returned nothing — it is skipped and the rest of the chain still runs`)
      } catch (error) {
        reportOnce(`[render] passes: "${effect.name || 'an effect'}" could not be built — ${error?.message || error}. It is skipped and the rest of the chain still runs.`)
      }
    }
    if (Object.keys(outputs).length > 1) scenePass.setMRT(mrt(outputs))

    // Renamed in this version of three; the old name still works and warns.
    const Pipeline = THREE.RenderPipeline || THREE.PostProcessing
    const chain = new Pipeline(state.renderer)
    chain.outputNode = colour
    return { list, camera, chain, passes }
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
    state.compilesRunning++
    next.passes.reduce((before, one) => before.then(() => one.compileAsync(state.renderer)), Promise.resolve())
      .catch(error => reportOnce(`[render] passes: shaders could not be compiled ahead — ${error?.message || error}. They compile on first draw instead.`))
      .finally(() => {
        state.compilesRunning--
        state.releaseAgainAfterCompile()
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
    if (dropped) state.forgetDrawRecords()
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

  /** The ordered post-processing passes; an empty list means none at all. */
  const passes = {
    /** The current list, so a neutral draw can take it away and put it back. */
    get list() { return [...passList] },
    set(list) {
      passList = Array.isArray(list) ? list.filter(Boolean) : []
      if (!passList.length) dropPost()
    }
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
    if (passList.length && (built?.list !== passList || built.camera !== camera)) warmPost(camera)
    if (warming) return
    if (built) {
      // A pass renders its scene once per node frame, and three advances that
      // frame only on its own animation tick. A second draw in one tick, such
      // as See drawing from another camera, would show the tick's first view.
      const nodeFrame = state.renderer._nodes?.nodeFrame
      if (nodeFrame && nodeFrame.frameId === drawnFrameId) nodeFrame.update()
      drawnFrameId = nodeFrame?.frameId
      built.chain.render()
      return
    }
    state.renderer.clear()
    state.renderer.render(state.scene, camera)
  }

  /** What the post chain is doing, for `stats.post`. */
  function postStatus() {
    return built ? (warming ? 'drawing, next chain compiling' : 'drawing') : warming ? 'compiling' : 'none'
  }

  state.passes = passes
  state.postDrawWorld = postDrawWorld
  state.postStatus = postStatus
}
