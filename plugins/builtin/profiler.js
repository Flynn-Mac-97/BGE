/**
 * Profiler — what the frame costs, answered from a terminal.
 *
 * Two numbers, and they answer different questions. CPU time is how long this
 * thread spent describing the frame: it goes up with draw calls and with how
 * much work `sync` has to do, and it is what a merge saves. GPU time is how
 * long the card spent on it: it goes up with pixels and with how heavy a shader
 * is, and it is the only honest answer to "can I afford this material".
 *
 * GPU time needs the `timestamp-query` feature. Three turns the tracking off by
 * itself where the feature is missing, which is every WebGL 2 backend, and the
 * number is then absent rather than wrong.
 *
 * Drawing in a tight loop rather than on the animation frame is deliberate: the
 * animation frame is capped to the screen's refresh, so a scene that could run
 * at four hundred frames a second and one that can just manage sixty both
 * measure as sixty and the headroom is invisible.
 *
 * MEASURE TWICE. Nothing is merged for the first SETTLE frames after anything
 * in the scene moves, so one run straight after a change measures the engine
 * settling and reads two to three times high. Run it, throw that away, run it
 * again.
 */

/** How many frames a run draws when the caller does not say. */
const FRAMES = 120

/** Frames drawn and thrown away first, so a compile is not counted as a frame. */
const WARM = 12

const sorted = list => [...list].sort((a, b) => a - b)

/** Mean, middle and worst-in-twenty of a list of milliseconds. */
function spread(times) {
  if (!times.length) return null
  const order = sorted(times)
  const total = order.reduce((sum, value) => sum + value, 0)
  const at = fraction => order[Math.min(order.length - 1, Math.floor(order.length * fraction))]
  return {
    mean: round(total / order.length),
    median: round(at(0.5)),
    worst20: round(at(0.95)),
    most: round(order[order.length - 1])
  }
}

const round = value => Math.round(value * 1000) / 1000

/** One frame, drawn now rather than when the screen next refreshes. */
function drawOnce(renderer, world) {
  renderer.sync(world)
  renderer.draw()
}

/**
 * Draw `frames` frames and report what they cost.
 *
 * The world is synced every frame, as the loop does, so the measurement covers
 * the same work a running game pays for rather than a redraw of a scene that is
 * already built.
 */
async function measure(context, options = {}) {
  const renderer = context.renderer
  if (!renderer?.draw) return { error: 'nothing is drawing — no renderer in this world' }

  const frames = Math.min(2000, Math.max(1, Math.round(Number(options.frames) || FRAMES)))
  const warm = Math.min(frames, Math.max(0, Math.round(Number(options.warm) ?? WARM)))

  // Reported on its own and kept out of the average. It catches a pending
  // compile or a scene not yet built — but only if the loop has not already
  // drawn this scene, which it usually has, so a low number means nothing was
  // outstanding rather than that nothing costs anything.
  const firstAt = performance.now()
  drawOnce(renderer, context.world)
  const first = round(performance.now() - firstAt)

  for (let i = 0; i < warm; i++) drawOnce(renderer, context.world)

  const cpu = []
  for (let i = 0; i < frames; i++) {
    const at = performance.now()
    drawOnce(renderer, context.world)
    cpu.push(performance.now() - at)
  }

  // The card answers a frame or two behind, so each sample draws and then waits
  // for that frame's own number. No timer and no animation frame: a hidden tab
  // fires neither, and a profiler that only works in a focused tab is a
  // profiler an agent cannot use.
  const gpu = []
  const samples = Math.min(60, Math.max(4, Math.round(Number(options.gpuSamples) || 20)))
  for (let i = 0; i < samples; i++) {
    drawOnce(renderer, context.world)
    const reported = await renderer.gpuTime?.()
    if (reported) gpu.push(reported)
  }

  const stats = renderer.stats || {}
  return {
    frames,
    firstFrameMs: first,
    cpu: spread(cpu),
    gpu: gpu.length ? spread(gpu) : null,
    gpuTimingWhy: gpu.length
      ? undefined
      : 'this backend cannot time itself — `timestamp-query` is a WebGPU feature and no WebGL 2 backend has it',
    frame: {
      drawCalls: stats.drawCalls,
      triangles: stats.triangles,
      entities: stats.entities,
      merged: stats.merged,
      batches: stats.batches,
      keylines: stats.keylines,
      materials: stats.materials,
      programs: stats.programs
    },
    backend: renderer.backend?.name
  }
}

export default {
  name: 'Profiler',
  category: 'agents',
  about: 'Measures what a frame costs on the thread and on the card, over many frames drawn back to back rather than at the screen refresh.',

  onLoad(context) {
    context.profiler = { measure: options => measure(context, options) }
  },

  commands: [{
    id: 'profile.frames',
    label: 'Draw many frames and report what they cost, on the thread and on the card',
    // run profile.frames
    // run profile.frames '{"frames": 400, "warm": 30}'
    run: (context, options) => measure(context, options || {})
  }]
}
