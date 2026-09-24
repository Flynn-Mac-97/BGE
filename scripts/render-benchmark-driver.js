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
 * `world` surface, reads the kernel's own per-pass costs, and drives fixed
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

  /**
   * Read the kernel's per-pass cost for the frame just run.
   *
   * The executor times each pass's extract, prepare and execute; this copies the
   * numbers into the samples the report reads. Nothing here wraps a pass, and a
   * stage the pass does not declare is left out of its bucket.
   */
  function readPassCosts() {
    let callbackMs = 0
    const ordered = graph.passes
    const costs = renderer.stats.passes
    for (let at = 0; at < costs.length; at++) {
      const pass = ordered[at]
      const cost = costs[at]
      const bucket = bucketFor(cost.name)
      if (pass.extract) bucket.extract.push(cost.extractMs)
      if (pass.prepare) bucket.prepare.push(cost.prepareMs)
      bucket.execute.push(cost.executeMs)
      callbackMs += cost.extractMs + cost.prepareMs + cost.executeMs
    }
    samples.callback.push(callbackMs)
  }

  /** Time the executor and the draw. The per-pass costs come from the kernel. */
  function instrument() {
    instrumentFrameSystems()
    if (!graph.run.instrumented) {
      const original = graph.run
      const wrapped = (camera, target, width, height) => {
        if (!measuring) return original(camera, target, width, height)
        const started = now()
        try {
          return original(camera, target, width, height)
        } finally {
          samples.executor.push(now() - started)
          readPassCosts()
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
    const timingCostMs = round(graph.clockReads * pageClock.callMs)

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
      passWorkMs: round(callbackMs - setupMs),
      // The walk is the cost that scales with the scene, so it is the share to
      // watch. The kernel's own stages are reported in ms and sit at the clock
      // floor; a share of the frame would say nothing about them.
      sceneExtractShare: stepMs ? round(walkMs / stepMs) : null,
      passClockReads: graph.clockReads,
      timingCostMs,
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
   * The page clock's quantum and the cost of one read.
   *
   * Chrome clamps `performance.now()` to a coarse quantum on a page that is not
   * cross-origin isolated, so every stage shorter than the quantum reads as the
   * quantum or as zero. The kernel carries its per-pass costs on that clock, so
   * this prices both the quantum and a read: the timing's own cost is reported
   * rather than assumed. The loop's subtraction and comparison are counted in
   * the read cost, so it is an upper bound.
   */
  function measureClock() {
    let smallest = Infinity
    const count = 200000
    const startedAt = now()
    for (let read = 0; read < count; read++) {
      const first = now()
      const step = now() - first
      if (step > 0 && step < smallest) smallest = step
    }
    const elapsed = now() - startedAt
    return {
      resolutionMs: Number.isFinite(smallest) ? smallest : null,
      callMs: elapsed / (count * 2 + 2)
    }
  }

  const pageClock = measureClock()

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
      timerResolutionMs: pageClock.resolutionMs,
      clockCallMs: pageClock.callMs,
      viewport: config.viewport,
      frames: config.frames,
      warmupFrames: config.warmupFrames,
      passNames: graph.passes.map(pass => pass.name)
    },
    scenes: [],
    entityCurve: [],
    passCurve: []
  }

  /**
   * Build one scene through the engine's own world surface.
   *
   * The measured loop and the show path share this, so what a caller looks at is
   * the scene the numbers came from rather than a second copy that can drift.
   */
  async function buildScene(scene) {
    if (scene.kind === 'retro2d') {
      aimOrtho(16)
      spawnSprites(scene.entities)
      return
    }
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

  // Show mode: build one scene and leave it on screen, so a caller can look at
  // what the numbers describe. It settles the post chain and the batching, then
  // returns with the world still standing - a measurement would clear it.
  if (config.show) {
    const scene = config.scenes.find(entry => entry.name === config.show)
    if (!scene) return { problem: `no scene named ${config.show}` }
    await clearWorld()
    registerTypes()
    await buildScene(scene)
    renderer.frameSize(config.viewport[0], config.viewport[1])
    engine.bus.emit('world:changed')
    await settle(scene.settle ?? 2000)
    for (let frame = 0; frame < config.warmupFrames; frame++) runFrame()
    return { shown: scene.name, entities: world.entities.length, environment: results.environment }
  }

  for (const scene of config.scenes) {
    const built = await runScene({ settle: scene.settle, world: () => buildScene(scene) })
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
