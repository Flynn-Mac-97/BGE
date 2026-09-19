/**
 * Profiler — what the frame costs, answered from a terminal.
 *
 * Two numbers, and they answer different questions. CPU time is how long this
 * thread spent describing the frame: it goes up with draw calls and with how
 * much work `sync` has to do, and it is what a merge saves. GPU time is how
 * long the card spent on it: it goes up with pixels and with how heavy a shader
 * is, and it is the only honest answer to "can I afford this material".
 *
 * GPU time is only reported where it can be believed. A WebGL 2 backend with
 * `EXT_disjoint_timer_query_webgl2` says it can time itself and then returns a
 * constant around a thousand milliseconds, which is not a frame time and is far
 * worse than no number at all. Every sample is checked against the wall clock
 * before it is reported: see `believable`.
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

/** Fixed steps a simulation run advances when the caller does not say. */
const STEPS = 600

/** Steps run and thrown away first, so a grid being built once is not a step cost. */
const STEP_WARM = 60

/** Frame plans timed; the median is reported so one GC pause is not the answer. */
const PLAN_SAMPLES = 30

/** A fixed step is 1/60 s, so this is the whole budget one step may spend. */
const BUDGET_MS = 1000 / 60

import { fillWith } from './profiler/fill.js'
import { planFrame } from '../../engine/frame-plan.js'

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

/**
 * The GPU samples the wall clock agrees with, or none and the reason.
 *
 * A frame cannot have taken the card longer than the whole sampling loop took
 * on the clock. A backend reporting otherwise is not measuring per-frame time,
 * and a plausible-looking wrong number is worse than an absent one: it is read
 * into a table and acted on. The number it gave is named so the reader can see
 * why it was dropped.
 */
export function believable(samples, loopMs, backend) {
  if (!samples.length) {
    return { gpu: null, why: `${backend || 'this backend'} reported no GPU time — it cannot time itself` }
  }
  const kept = samples.filter(one => one <= loopMs)
  if (kept.length) return { gpu: spread(kept), why: undefined }
  const worst = Math.max(...samples)
  return {
    gpu: null,
    why: `${backend || 'this backend'} reported ${round(worst)} ms for one frame, and the whole sampling loop took ${round(loopMs)} ms — the timer is not reporting per-frame time, so nothing is reported`
  }
}

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
  const gpuStartedAt = performance.now()
  for (let i = 0; i < samples; i++) {
    drawOnce(renderer, context.world)
    const reported = await renderer.gpuTime?.()
    if (reported) gpu.push(reported)
  }
  const gpuLoopMs = performance.now() - gpuStartedAt
  const timing = believable(gpu, gpuLoopMs, renderer.backend?.name)

  const stats = renderer.stats || {}
  return {
    frames,
    firstFrameMs: first,
    cpu: spread(cpu),
    gpu: timing.gpu,
    gpuTimingWhy: timing.why,
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

/** Total of a list, and the same rounded to microseconds. */
const total = list => list.reduce((sum, value) => sum + value, 0)

/**
 * Wrap every system's `run` with a timer, and return how to put them back.
 *
 * The loop calls the systems directly, so wrapping is the only place their
 * time is visible. One list per plugin and phase, because a plugin may
 * contribute to both.
 */
function timeSystems(systems) {
  const times = new Map()
  const original = systems.map(system => system.run)
  for (const system of systems) {
    const key = `${system.plugin} (${system.phase})`
    const run = system.run
    system.run = (world, seconds, context) => {
      const at = performance.now()
      try { return run(world, seconds, context) } finally {
        const took = performance.now() - at
        const list = times.get(key)
        if (list) list.push(took)
        else times.set(key, [took])
      }
    }
  }
  return {
    times,
    restore() { systems.forEach((system, index) => { system.run = original[index] }) }
  }
}

/**
 * Advance the world `steps` fixed steps and report what each system cost.
 *
 * The loop's own `step` drives it, so the clock advances exactly as in a real
 * run and a system that reads the clock measures what it really costs. One
 * call to `step(1)` is one fixed step and one frame, which is the 60 Hz case.
 *
 * This simulates. The world is somewhere else afterwards, and a level reload
 * is how to put it back.
 */
function measureSteps(context, options = {}) {
  const loop = context.loop
  if (!loop?.step) return { error: 'no loop in this world' }

  const steps = Math.min(20000, Math.max(1, Math.round(Number(options.steps) || STEPS)))
  const warm = Math.min(steps, Math.max(0, Math.round(Number(options.warm) ?? STEP_WARM)))
  const systems = context.loader.contrib.systems
  const timed = timeSystems(systems)

  const whole = []
  try {
    for (let i = 0; i < warm; i++) loop.step(1)
    timed.times.clear()
    for (let i = 0; i < steps; i++) {
      const at = performance.now()
      loop.step(1)
      whole.push(performance.now() - at)
    }
  } finally {
    timed.restore()
  }

  const each = [...timed.times].map(([system, list]) => ({
    system,
    ranPerStep: round(list.length / steps),
    meanMs: round(total(list) / steps),
    worst20Ms: spread(list).worst20,
    mostMs: spread(list).most
  })).sort((first, second) => second.meanMs - first.meanMs)

  const step = spread(whole)
  return {
    steps,
    // A paused world still runs every system, with zero seconds, so nothing
    // moves and every number reads low for a reason nothing else would show.
    paused: loop.paused ? loop.holds : undefined,
    stepMs: step,
    budgetMs: round(BUDGET_MS),
    // The honest headline: how many fixed steps a second this world can do,
    // against the 60 a real-time game needs.
    stepsPerSecond: Math.round(1000 / Math.max(step.mean, 0.0001)),
    systems: each,
    // Update hooks, loop bookkeeping and, in a drawing world, the renderer's
    // own sync and draw. None of them is a system, so none can be wrapped.
    unattributedMs: round(step.mean - total(each.map(entry => entry.meanMs))),
    entities: context.world.entities.length
  }
}

/** The fill measurement, given the helpers every profiler number is made with. */
const measureFill = fillWith({ measure, drawOnce, round })

/**
 * What the renderer's per-entity description costs, with no GL context.
 *
 * `profile.frames` needs a card. This does not: it times `planFrame`, the same
 * pure pass `sync` makes for every entity — the look, the turn, the drawn size
 * and the stillness signature — so the thread's own ceiling can be measured in
 * a headless run, on the machine doing the work rather than a GPU.
 */
function measurePlan(context, options = {}) {
  const world = context.world
  const entities = world?.entities || []
  if (!entities.length) return { error: 'the world holds no entities to plan' }
  const samples = Math.min(200, Math.max(1, Math.round(Number(options.samples) || PLAN_SAMPLES)))
  // One pass thrown away, so the caches a first frame fills are not the answer.
  planFrame(world)
  const times = []
  let counted = null
  for (let index = 0; index < samples; index++) {
    const at = performance.now()
    counted = planFrame(world)
    times.push(performance.now() - at)
  }
  const plan = spread(times)
  return {
    samples,
    planMs: plan,
    budgetMs: round(BUDGET_MS),
    entities: counted.entities,
    meshes: counted.meshes,
    sprites: counted.sprites,
    perEntityMicroseconds: round((plan.median / Math.max(1, counted.entities)) * 1000)
  }
}

export default {
  name: 'Profiler',
  category: 'agents',
  about: 'What a frame costs, per system and thread.',

  lifecycle: 'scoped',
  provides: ['profiler'],
  onLoad(context, scope) {
    context.profiler = {
      measure: options => measure(context, options),
      fill: options => measureFill(context, options),
      steps: options => measureSteps(context, options),
      plan: options => measurePlan(context, options)
    }
    if (scope) {
      const service = context.profiler
      scope.provide('profiler', service)
      scope.defer(() => { if (context.profiler === service) delete context.profiler })
    }
  },

  commands: [{
    id: 'profile.frames',
    label: 'Cost frames',
    // run profile.frames
    // run profile.frames '{"frames": 400, "warm": 30}'
    run: (context, options) => measure(context, options || {})
  }, {
    id: 'profile.fill',
    label: 'Cost quad pixels',
    // run profile.fill '{"material": "hologram"}'
    // run profile.fill '{"material": "hologram", "layers": 24, "frames": 300}'
    run: (context, options) => measureFill(context, options || {})
  }, {
    id: 'profile.steps',
    label: 'Cost per system',
    // run profile.steps
    // run profile.steps '{"steps": 1200, "warm": 120}'
    run: (context, options) => measureSteps(context, options || {})
  }, {
    id: 'profile.plan',
    label: 'Cost per-entity description',
    // run profile.plan
    // run profile.plan '{"samples": 50}'
    run: (context, options) => measurePlan(context, options || {})
  }]
}
