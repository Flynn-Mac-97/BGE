/**
 * The page half of the render benchmark.
 *
 * This file is never imported. `render-benchmark.mjs` reads it and evaluates it
 * inside an editor page over the DevTools protocol, where `window.engine` is
 * the running engine and the real card is attached. It is one function
 * expression: the harness calls it with a config object and gets plain JSON
 * back.
 *
 * Nothing here changes the kernel. It builds worlds through the engine's own
 * `world` surface, wraps the live pass records to time them, and drives fixed
 * frames through `loop.step(0)` — a stopped clock, so every frame is a settled
 * still frame. The one kernel-adjacent write is the wrapper on
 * `renderer.graph.run`, and it only adds a timer around the call.
 */
async config => {
  const engine = window.engine
  const renderer = engine.renderer
  const world = engine.world
  const view = engine.view
  const graph = renderer.graph
  const context = engine.editor.context

  const now = () => performance.now()
  const round = value => (Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null)
  const median = values => {
    if (!values.length) return null
    const sorted = [...values].sort((first, second) => first - second)
    return sorted[sorted.length >> 1]
  }
  const medianOfDifferences = (left, right) =>
    median(left.map((value, at) => value - (right[at] ?? value)))

  // ------------------------------------------------------------ instrumentation

  // The samples for one measured phase. The wrappers below write here only
  // while `measuring` is true, so warmup frames cost nothing and add nothing.
  let measuring = false
  let frameCallbackMilliseconds = 0
  const samples = { step: [], draw: [], executor: [], callback: [] }
  const perPass = new Map()
  const perPlugin = new Map()

  function bucketFor(name) {
    let bucket = perPass.get(name)
    if (!bucket) {
      bucket = { extract: [], prepare: [], execute: [] }
      perPass.set(name, bucket)
    }
    return bucket
  }

  /**
   * Wrap every plugin frame system in place, so the time each plugin spends
   * before the draw is attributed to it by name.
   *
   * The kernel runs these before `sync`; the frame's total holds them, and
   * without this they would read as unknown time between the clock and the
   * renderer.
   */
  function instrumentFrameSystems() {
    const schedule = engine.loader?.schedule?.frame
    if (!schedule) return
    for (const entry of schedule) {
      if (entry.run.instrumented) continue
      const original = entry.run
      const wrapped = (whichWorld, seconds, context) => {
        if (!measuring) return original(whichWorld, seconds, context)
        const started = now()
        try {
          return original(whichWorld, seconds, context)
        } finally {
          let times = perPlugin.get(entry.plugin)
          if (!times) {
            times = []
            perPlugin.set(entry.plugin, times)
          }
          times.push(now() - started)
        }
      }
      wrapped.instrumented = true
      entry.run = wrapped
    }
  }

  /** Wrap one pass callback in place, once, so the record's identity is kept. */
  function timedCallback(passName, stage, original) {
    if (!original || original.instrumented) return original
    const wrapped = (...args) => {
      if (!measuring) return original(...args)
      const started = now()
      try {
        return original(...args)
      } finally {
        const spent = now() - started
        frameCallbackMilliseconds += spent
        bucketFor(passName)[stage].push(spent)
      }
    }
    wrapped.instrumented = true
    return wrapped
  }

  /**
   * Time the executor, the entity sync and the draw, and every pass callback.
   *
   * Wrapping a record in place rather than re-adding it keeps its edges, its
   * target and its position in the order exactly as the kernel built them.
   */
  function instrument() {
    instrumentFrameSystems()
    for (const pass of graph.passes) {
      if (pass.extract) pass.extract = timedCallback(pass.name, 'extract', pass.extract)
      if (pass.prepare) pass.prepare = timedCallback(pass.name, 'prepare', pass.prepare)
      pass.execute = timedCallback(pass.name, 'execute', pass.execute)
    }
    if (!graph.run.instrumented) {
      const original = graph.run
      const wrapped = (camera, target, width, height) => {
        if (!measuring) return original(camera, target, width, height)
        frameCallbackMilliseconds = 0
        const started = now()
        try {
          return original(camera, target, width, height)
        } finally {
          samples.executor.push(now() - started)
          samples.callback.push(frameCallbackMilliseconds)
        }
      }
      wrapped.instrumented = true
      graph.run = wrapped
    }
    if (!renderer.draw.instrumented) {
      const original = renderer.draw
      const wrapped = (...args) => {
        if (!measuring) return original(...args)
        const started = now()
        try {
          return original(...args)
        } finally {
          samples.draw.push(now() - started)
        }
      }
      wrapped.instrumented = true
      renderer.draw = wrapped
    }
  }

  /** One settled frame: frame systems, then the draw, on a stopped clock. */
  function runFrame() {
    if (!measuring) return engine.loop.step(0)
    const started = now()
    engine.loop.step(0)
    samples.step.push(now() - started)
  }

  function resetSamples() {
    for (const key of Object.keys(samples)) samples[key].length = 0
    perPass.clear()
    perPlugin.clear()
    frameCallbackMilliseconds = 0
  }

  /** Read the counters that do not need a frame to settle. */
  function readStats() {
    const stats = renderer.stats
    return {
      drawCalls: stats.drawCalls,
      triangles: stats.triangles,
      entities: stats.entities,
      merged: stats.merged,
      batches: stats.batches,
      keylines: stats.keylines,
      contactShadows: stats.contactShadows,
      groundRings: stats.groundRings,
      materials: stats.materials,
      textures: stats.textures,
      geometries: stats.geometries,
      programs: stats.programs,
      post: stats.post
    }
  }

  /** Turn one measured phase into the numbers the report prints. */
  function summarise() {
    const stepMs = median(samples.step)
    const drawMs = median(samples.draw)
    const executorMs = median(samples.executor)
    const drawTailMs = medianOfDifferences(samples.draw, samples.executor)
    const callbackMs = median(samples.callback)
    const overheadMs = medianOfDifferences(samples.executor, samples.callback)
    const frameSystemsMs = median(samples.step.map((value, at) => value - (samples.draw[at] ?? 0)))

    const passes = []
    for (const [name, bucket] of perPass) {
      passes.push({
        name,
        extractMs: round(median(bucket.extract)),
        prepareMs: round(median(bucket.prepare)),
        executeMs: round(median(bucket.execute)),
        frames: bucket.execute.length
      })
    }
    passes.sort((first, second) => (second.executeMs ?? 0) + (second.prepareMs ?? 0) - (first.executeMs ?? 0) - (first.prepareMs ?? 0))

    const frameSystems = []
    for (const [plugin, times] of perPlugin) frameSystems.push({ plugin, ms: round(median(times)) })
    frameSystems.sort((first, second) => (second.ms ?? 0) - (first.ms ?? 0))

    // The entity walk is the scene pass's extract now, so it is attributed to
    // the pass and not counted as kernel work.
    const walkMs = round(median(perPass.get('scene')?.extract ?? []))
    const setupMs = passes.find(pass => pass.name === 'frame')?.prepareMs ?? 0
    const kernelTotalMs = setupMs + (overheadMs ?? 0) + (drawTailMs ?? 0)

    return {
      frames: samples.step.length,
      stepMs: round(stepMs),
      walkMs,
      drawMs: round(drawMs),
      frameSystemsMs: round(frameSystemsMs),
      executorMs: round(executorMs),
      executorOverheadMs: round(overheadMs),
      drawTailMs: round(drawTailMs),
      callbackMs: round(callbackMs),
      kernelSetupMs: round(setupMs),
      kernelTotalMs: round(kernelTotalMs),
      passWorkMs: round(callbackMs - setupMs),
      kernelShare: stepMs ? round(kernelTotalMs / stepMs) : null,
      passes,
      frameSystems
    }
  }

  async function measure(count) {
    resetSamples()
    measuring = true
    for (let frame = 0; frame < count; frame++) runFrame()
    measuring = false
    const measured = summarise()
    measured.stats = readStats()
    // A real heap number needs a collection first. Chrome exposes `gc` only
    // when the harness passes `--js-flags=--expose-gc`; without it the heap
    // figure is whatever the collector has not got to yet, so it is left null.
    if (typeof window.gc === 'function') {
      window.gc()
      window.gc()
    }
    // How many targets the pool holds for this pass set: one made for a scene is
    // reused by the next, so the count shows the pool working.
    measured.targetsCreated = graph.pool.created
    measured.graphRebuilds = graph.rebuilds
    measured.heapMB =
      typeof window.gc === 'function' && window.performance?.memory
        ? round(window.performance.memory.usedJSHeapSize / 1e6)
        : null
    return measured
  }

  // ------------------------------------------------------------------- worlds

  /**
   * Return the renderer to its default graph and an empty world.
   *
   * The AAA scene leaves a post chain behind that has taken over the scene draw;
   * without handing it back, every later scene would be measured through it and
   * the curves would carry an effect they do not name.
   */
  async function clearWorld() {
    for (const pass of graph.passes) if (pass.name.startsWith('probe')) graph.remove(pass.name)
    await engine.run('post.chain', null)
    world.clear()
    renderer.setSky(null)
    renderer.setFog(0)
  }

  function registerTypes() {
    world.registerType('benchSprite', { sprite: { image: 'probe.png', width: 0.5, height: 0.5 } })
    world.registerType('benchMesh', { mesh: { box: [1, 1, 1], material: 'lambert' } })
    world.registerType('benchSurface', { mesh: { box: [1, 1, 1], material: 'standard', roughness: 0.6, metalness: 0.1 } })
  }

  /** A grid of meshes on and above the ground, in front of the camera. */
  function spawnMeshes(count, typeName) {
    const columns = Math.max(1, Math.ceil(Math.sqrt(count)))
    for (let at = 0; at < count; at++) {
      const column = at % columns
      const row = Math.floor(at / columns)
      world.spawn(typeName, {
        at: [column * 1.2 - columns * 0.6, row * 1.2 - columns * 0.6, -8 - (row % 4) * 2]
      })
    }
  }

  /**
   * A grid of meshes that cannot merge: each carries its own material
   * parameters, so a batch key is unique per entity and every one is its own
   * draw. This is the moving, varied geometry an AAA frame is mostly made of.
   */
  function spawnVariedMeshes(count, typeName) {
    const columns = Math.max(1, Math.ceil(Math.sqrt(count)))
    for (let at = 0; at < count; at++) {
      const column = at % columns
      const row = Math.floor(at / columns)
      world.spawn(typeName, {
        at: [column * 1.2 - columns * 0.6, row * 1.2 - columns * 0.6, -8 - (row % 4) * 2],
        // Flat on the mesh, not inside `material`, because the material key is
        // read from the flat keys and a parameter hidden in the object is not
        // in it — the two would silently share one material and merge.
        mesh: { roughness: 0.15 + (at % 8) * 0.09, metalness: (at % 3) * 0.25 }
      })
    }
  }

  function spawnSprites(count) {
    const columns = Math.max(1, Math.ceil(Math.sqrt(count)))
    for (let at = 0; at < count; at++) {
      const column = at % columns
      const row = Math.floor(at / columns)
      world.spawn('benchSprite', { at: [column * 0.7 - columns * 0.35, row * 0.7 - columns * 0.35, 0] })
    }
  }

  /** One directional light entity, the only kind that can cast a shadow here. */
  function spawnShadowSun() {
    world.spawn('light', {
      id: 'bench-sun',
      at: [18, 30, 12],
      properties: { kind: 'directional', color: '#fff2d8', intensity: 2.2, shadow: true, range: 60 }
    })
  }

  function aimOrtho(zoom) {
    view.mode = 'ortho'
    view.x = 0
    view.y = 0
    view.zoom = zoom
  }

  function aimPerspective() {
    view.mode = 'persp'
    view.x = 0
    view.y = 4
    view.z = 14
    view.yaw = 0
    view.pitch = -0.15
    view.fov = 60
  }

  /** Extra passes that really draw: each renders the world into its own transient. */
  function addProbePasses(count) {
    for (let at = 0; at < count; at++) {
      const name = `probe${at}`
      const resource = `probeColour${at}`
      graph.add({
        name,
        after: ['scene'],
        before: ['ui'],
        always: true,
        writes: [resource],
        target: { format: 'half-float' },
        execute: (frame, targets) => {
          renderer.threeRenderer.setRenderTarget(targets.get(resource))
          renderer.threeRenderer.render(renderer.scene, frame.camera)
        }
      })
    }
    if (count > 0) {
      graph.add({
        name: 'probeRestore',
        after: [`probe${count - 1}`],
        before: ['ui'],
        always: true,
        execute: () => renderer.threeRenderer.setRenderTarget(null)
      })
    }
  }

  /** Let plugin frame systems and asynchronous loads settle before warmup. */
  function settle(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
  }

  /**
   * Build a scene, run its warmup frames, then measure.
   *
   * The warmup exists for two reasons: batching needs 45 still frames before
   * four members merge, and a post chain compiles its shaders on first draw.
   */
  async function runScene(definition) {
    await clearWorld()
    registerTypes()
    if (definition.world) await definition.world()
    renderer.frameSize(config.viewport[0], config.viewport[1])
    engine.bus.emit('world:changed')
    await settle(definition.settle ?? 400)
    instrument()
    for (let frame = 0; frame < config.warmupFrames; frame++) runFrame()
    const measured = await measure(config.frames)
    measured.gpuMs = await readGpuMs()
    measured.gpuInclusiveMs = await readGpuInclusiveMs()
    return { ...measured, entities: world.entities.length }
  }

  async function readGpuMs() {
    try {
      const value = await renderer.gpuTime()
      return Number.isFinite(value) ? round(value) : null
    } catch {
      return null
    }
  }

  /** Wall time for a frame that waits for the card, so the number includes it. */
  async function readGpuInclusiveMs() {
    const durations = []
    for (let at = 0; at < 4; at++) {
      const started = now()
      renderer.draw(world)
      const reached = await renderer.waitForGPU()
      if (!reached) return null
      durations.push(now() - started)
    }
    return round(median(durations))
  }

  async function finish() {
    await clearWorld()
    renderer.setSky('#8fa3bf')
  }

  // -------------------------------------------------------------------- run

  /**
   * The smallest non-zero step the page's clock can report.
   *
   * Chrome clamps `performance.now()` to a coarse quantum on a page that is not
   * cross-origin isolated, so every stage shorter than the quantum reads as the
   * quantum or as zero. The report states it rather than pretending the small
   * numbers are finer than they are.
   */
  function timerResolutionMs() {
    let smallest = Infinity
    for (let at = 0; at < 200000; at++) {
      const started = now()
      const step = now() - started
      if (step > 0 && step < smallest) smallest = step
    }
    return Number.isFinite(smallest) ? smallest : null
  }

  const gpuContext = (() => {
    try {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl2')
      if (!gl) return null
      const information = gl.getExtension('WEBGL_debug_renderer_info')
      return {
        version: gl.getParameter(gl.VERSION),
        renderer: information ? gl.getParameter(information.UNMASKED_RENDERER_WEBGL) : null,
        disjointTimerQuery: !!gl.getExtension('EXT_disjoint_timer_query_webgl2')
      }
    } catch {
      return null
    }
  })()

  const results = {
    environment: {
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      gpu: gpuContext,
      backend: renderer.backend
        ? { name: renderer.backend.name, webgpu: renderer.backend.webgpu, timestampQuery: renderer.backend.has('timestamp-query') }
        : null,
      timerResolutionMs: timerResolutionMs(),
      viewport: config.viewport,
      frames: config.frames,
      warmupFrames: config.warmupFrames,
      passNames: graph.passes.map(pass => pass.name)
    },
    scenes: [],
    entityCurve: [],
    passCurve: []
  }

  for (const scene of config.scenes) {
    const built = await runScene({
      settle: scene.settle,
      world: async () => {
        if (scene.kind === 'retro2d') {
          aimOrtho(16)
          spawnSprites(scene.entities)
        } else {
          aimPerspective()
          if (scene.unmergeable) spawnVariedMeshes(scene.entities, 'benchSurface')
          else spawnMeshes(scene.entities, scene.material === 'standard' ? 'benchSurface' : 'benchMesh')
          renderer.setSky('#8fa3bf')
          renderer.setFog(0.012, '#8fa3bf')
          renderer.setAmbient('#93a7c4', 0.5)
          renderer.setSun([-0.4, -1, -0.3], '#fff2d8', 0.9)
          if (scene.shadows) spawnShadowSun()
          if (scene.probePasses) addProbePasses(scene.probePasses)
          if (scene.post) await engine.run('post.chain', scene.post)
        }
      }
    })
    results.scenes.push({ name: scene.name, kind: scene.kind, ...built })
  }

  for (const count of config.entityCurve) {
    const built = await runScene({
      settle: 300,
      world: () => {
        aimPerspective()
        spawnMeshes(count, 'benchMesh')
        renderer.setSky('#8fa3bf')
        renderer.setFog(0.012, '#8fa3bf')
        renderer.setAmbient('#93a7c4', 0.5)
        renderer.setSun([-0.4, -1, -0.3], '#fff2d8', 0.9)
      }
    })
    results.entityCurve.push({ name: `entities-${count}`, entities: count, ...built })
  }

  for (const count of config.passCurve) {
    const built = await runScene({
      settle: 300,
      world: () => {
        aimPerspective()
        spawnVariedMeshes(config.passCurveEntities, 'benchSurface')
        renderer.setSky('#8fa3bf')
        renderer.setAmbient('#93a7c4', 0.5)
        renderer.setSun([-0.4, -1, -0.3], '#fff2d8', 0.9)
        addProbePasses(count)
      }
    })
    results.passCurve.push({ name: `passes-${count}`, probePasses: count, ...built })
  }

  await finish()
  results.environment.finalPassNames = graph.passes.map(pass => pass.name)
  return results
}
