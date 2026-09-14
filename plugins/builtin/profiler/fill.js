/**
 * The fill measurement: what a material's PIXELS cost.
 *
 * `profile.frames` answers what an OBJECT costs — draw calls, and the work
 * `sync` does per entity. It cannot answer what a SHADER costs, because one
 * surface covering a twelfth of the screen is too cheap for any timer here to
 * see. This fills the frame instead, and stacks the fill, so the only thing
 * that grows is the pixels the shader is asked for. Cost rises with the layer
 * count, which is what says the measurement is reaching the shader at all.
 *
 * The quad size is computed from the camera rather than guessed, so the fill is
 * full by construction and the size is reported for checking.
 *
 * EVERY FRAME IS WAITED FOR. Both backends queue work and return, so wall-clock
 * time around a draw measures this thread: without a barrier a heavy shader
 * reads FASTER than a cheap one, because the thread does less waiting per
 * submission. `renderer.waitForGPU` is that barrier, and it costs a fixed
 * couple of milliseconds a frame — so compare against the `lambert` baseline in
 * the same run and read the DIFFERENCE, never the absolute number, and never
 * across two backends.
 *
 * Split from `profiler.js` because that file owns the plugin and the two
 * measurements a game already had. Its helpers arrive as arguments rather than
 * by import, so there is no cycle back to the plugin and every number here is
 * made with the same spread and rounding as the rest of the profiler.
 */
/** Layers stacked when the caller does not say. */
const LAYERS = 8

/** How far in front of the camera the stack is built, in metres. */
const DISTANCE = 6

/**
 * Frames thrown away before a fill is measured.
 *
 * Above the renderer's own merge settle, because the stack is spawned by this
 * command: a fill measured straight after building one measures the merge.
 */
const FILL_WARM = 60

/** Fraction over full coverage, so no edge of the frame can miss the fill. */
const MARGIN = 1.08

/**
 * How wide and tall a quad must be to fill the frame at `distance`.
 *
 * Read off the camera three is actually drawing with, because the editor draws
 * through an orthographic camera and play through a perspective one, and a size
 * that fills one leaves gaps in the other.
 */
export function sizeToFill(camera, distance) {
  if (!camera) return null
  if (camera.isOrthographicCamera) {
    const zoom = camera.zoom || 1
    return {
      wide: ((camera.right - camera.left) / zoom) * MARGIN,
      tall: ((camera.top - camera.bottom) / zoom) * MARGIN,
      from: 'orthographic camera'
    }
  }
  if (camera.isPerspectiveCamera) {
    const tall = 2 * distance * Math.tan((camera.fov * Math.PI) / 360)
    return { wide: tall * (camera.aspect || 1) * MARGIN, tall: tall * MARGIN, from: 'perspective camera' }
  }
  return null
}

/**
 * Where to put the stack, and the rotation that turns it to face the camera.
 *
 * A quad's own normal is +Z, and a level's rotation is degrees in YXZ order, so
 * the yaw comes from the direction's X and Z and the pitch from its Y.
 */
export function facing(camera, distance) {
  // Taken out of the world matrix rather than through `getWorldDirection`,
  // which wants a Vector3 to write into and three is not imported here.
  let forward = { x: 0, y: 0, z: -1 }
  if (camera?.matrixWorld) {
    camera.updateWorldMatrix?.(true, false)
    const matrix = camera.matrixWorld.elements
    const length = Math.hypot(matrix[8], matrix[9], matrix[10]) || 1
    forward = { x: -matrix[8] / length, y: -matrix[9] / length, z: -matrix[10] / length }
  }
  const at = camera?.position
    ? [camera.position.x + forward.x * distance,
       camera.position.y + forward.y * distance,
       camera.position.z + forward.z * distance]
    : [0, 0, -distance]
  const degrees = value => (value * 180) / Math.PI
  return {
    at,
    forward,
    rotation: [degrees(Math.asin(Math.max(-1, Math.min(1, forward.y)))),
               degrees(Math.atan2(-forward.x, -forward.z)), 0]
  }
}

export function fillWith({ measure, drawOnce, round }) {
  return async function measureFill(context, options = {}) {
    const renderer = context.renderer
    if (!renderer?.draw) return { error: 'nothing is drawing — no renderer in this world' }

    const material = String(options.material ?? '').trim()
    if (!material) return { error: 'profile.fill needs a material: {"material":"hologram"}' }
    if (context.materials && !context.materials.has(material)) {
      return { error: `no material named "${material}" — run materials.list` }
    }

    const layers = Math.min(200, Math.max(1, Math.round(Number(options.layers) || LAYERS)))
    const distance = Math.max(0.5, Number(options.distance) || DISTANCE)
    const camera = renderer.camera
    const size = sizeToFill(camera, distance)
    if (!size) return { error: 'the camera is neither perspective nor orthographic, so no size can fill the frame' }

    const place = facing(camera, distance)
    // Stacked towards the camera, so every layer is in front of the one behind
    // and none is clipped by the near plane.
    const step = 0.02
    const spawned = []
    try {
      for (let layer = 0; layer < layers; layer++) {
        const back = distance - layer * step
        spawned.push(context.world.spawn('profiler-fill', {
          id: `profiler-fill-${layer}`,
          at: [camera.position.x + place.forward.x * back,
               camera.position.y + place.forward.y * back,
               camera.position.z + place.forward.z * back],
          rotation: place.rotation,
          mesh: { quad: [round(size.wide), round(size.tall)], material, ...(options.mesh || {}) }
        }))
      }

      const measured = await measure(context, { ...options, warm: options.warm ?? FILL_WARM })
      if (measured.error) return measured

      // Every frame is drawn AND waited for, so the number is one frame start to
      // finish. Waiting once at the end of a run instead measures submission:
      // the queue is only a few frames deep, so the card has almost caught up by
      // then and a heavy shader reads as cheap.
      const frames = measured.frames
      let waited = true
      const wallAt = performance.now()
      for (let i = 0; i < frames; i++) {
        drawOnce(renderer, context.world)
        if (!(await renderer.waitForGPU?.())) waited = false
      }
      const wallMs = performance.now() - wallAt

      return {
        material,
        layers,
        quad: [round(size.wide), round(size.tall)],
        sizedFrom: size.from,
        distance: round(distance),
        // Only reported where the card was actually waited for. A submission
        // time labelled as a frame cost is the failure this avoids.
        wallMsPerFrame: waited ? round(wallMs / frames) : null,
        framesPerSecond: waited ? Math.round(frames / (wallMs / 1000)) : null,
        wallTimingWhy: waited
          ? undefined
          : 'no backend barrier is reachable, so wall-clock time measures submission rather than drawing and is not reported',
        ...measured
      }
    } finally {
      for (const entity of spawned) context.world.destroy(entity)
      context.bus.emit('world:changed')
    }
  }

}
