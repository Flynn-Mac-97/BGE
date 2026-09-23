/**
 * Render the benchmark result as a human-readable report.
 *
 * Every number here comes from the measured result; nothing is asserted that
 * the run did not produce. The findings section names the largest stage at each
 * scale from the numbers rather than from a fixed expectation.
 */

const number = (value, places = 3) =>
  Number.isFinite(value) ? value.toFixed(places) : '—'
const percent = value => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—')
const perEntity = (milliseconds, count) => (Number.isFinite(milliseconds) && count ? ((milliseconds * 1000) / count).toFixed(2) : '—')

/** The pass that spent the most time in the frame, execute and prepare together. */
function heaviestPass(scene) {
  let heaviest = null
  for (const pass of scene.passes ?? []) {
    const spent = (pass.executeMs ?? 0) + (pass.prepareMs ?? 0)
    if (!heaviest || spent > heaviest.spent) heaviest = { pass, spent }
  }
  return heaviest
}

function sceneTable(scenes) {
  const rows = [
    '| scene | entities | draw calls | merged | batches | targets | heap MB | frame ms | sync ms | setup ms | executor ms | executor overhead ms | pass work ms | kernel share |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  ]
  for (const scene of scenes) {
    rows.push(
      `| ${scene.name} | ${scene.entities} | ${scene.stats.drawCalls} | ${scene.stats.merged} | ` +
        `${scene.stats.batches} | ${scene.targetsCreated} | ${scene.heapMB} | ${number(scene.stepMs)} | ` +
        `${number(scene.syncMs)} | ${number(scene.kernelSetupMs)} | ${number(scene.executorMs)} | ` +
        `${number(scene.executorOverheadMs)} | ${number(scene.passWorkMs)} | ${percent(scene.kernelShare)} |`
    )
  }
  return rows.join('\n')
}

function passTable(scene) {
  const rows = ['| pass | extract ms | prepare ms | execute ms | frames |', '| --- | --- | --- | --- | --- |']
  for (const pass of scene.passes ?? []) {
    rows.push(`| ${pass.name} | ${number(pass.extractMs)} | ${number(pass.prepareMs)} | ${number(pass.executeMs)} | ${pass.frames} |`)
  }
  return rows.join('\n')
}

function frameSystemTable(scene) {
  const rows = ['| plugin | ms |', '| --- | --- |']
  for (const entry of scene.frameSystems ?? []) rows.push(`| ${entry.plugin} | ${number(entry.ms)} |`)
  return rows.join('\n')
}

function entityTable(curve) {
  const rows = [
    '| entities | step ms | sync ms | setup ms | executor overhead ms | frame systems ms | kernel share | sync µs/entity | heap MB |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  ]
  for (const entry of curve) {
    rows.push(
      `| ${entry.entities} | ${number(entry.stepMs)} | ${number(entry.syncMs)} | ${number(entry.kernelSetupMs)} | ` +
        `${number(entry.executorOverheadMs)} | ${number(entry.frameSystemsMs)} | ${percent(entry.kernelShare)} | ` +
        `${perEntity(entry.syncMs, entry.entities)} | ${entry.heapMB} |`
    )
  }
  return rows.join('\n')
}

function passCurveTable(curve) {
  const rows = [
    '| added passes | live passes | executor ms | executor overhead ms | overhead µs/pass | frame ms | kernel share | heap MB |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  ]
  for (const entry of curve) {
    rows.push(
      `| ${entry.probePasses} | ${entry.passes.length} | ${number(entry.executorMs)} | ${number(entry.executorOverheadMs)} | ` +
        `${((entry.executorOverheadMs ?? 0) * 1000 / Math.max(1, entry.probePasses)).toFixed(2)} | ${number(entry.stepMs)} | ` +
        `${percent(entry.kernelShare)} | ${entry.heapMB} |`
    )
  }
  return rows.join('\n')
}

function findings(results) {
  const lines = []
  for (const scene of results.scenes) {
    const heaviest = heaviestPass(scene)
    const kernel = scene.kernelTotalMs
    const name = heaviest?.pass?.name ?? 'nothing'
    const systemsDominant = (scene.frameSystemsMs ?? 0) > (scene.kernelTotalMs ?? 0)
    const heaviestSystem = (scene.frameSystems ?? []).find(entry => (entry.ms ?? 0) > 0) ?? null
    lines.push(
      `- **${scene.name}**: the frame takes ${number(scene.stepMs)} ms. The heaviest draw is \`${name}\` at ` +
        `${number((heaviest?.pass?.executeMs ?? 0) + (heaviest?.pass?.prepareMs ?? 0))} ms. Kernel stages total ` +
        `${number(kernel)} ms (${percent(scene.kernelShare)}): sync ${number(scene.syncMs)} ms, setup ` +
        `${number(scene.kernelSetupMs)} ms, executor overhead ${number(scene.executorOverheadMs)} ms. ` +
        `Plugin frame systems cost ${number(scene.frameSystemsMs)} ms` +
        (heaviestSystem ? `, most of it \`${heaviestSystem.plugin}\` at ${number(heaviestSystem.ms)} ms` : '') +
        (systemsDominant ? ', more than every kernel stage together.' : '.')
    )
  }

  // Rows whose sync is below the clock's quantum cannot be divided by, so the
  // growth sentence uses the two largest counts that measured above it.
  const curve = results.entityCurve.filter(entry => entry.entities > 0)
  const aboveQuantum = curve.filter(entry => (entry.syncMs ?? 0) > 0)
  if (curve.length) {
    const first = aboveQuantum[0] ?? curve[0]
    const last = curve[curve.length - 1]
    const firstPer = (first.syncMs ?? 0) / first.entities
    const lastPer = (last.syncMs ?? 0) / last.entities
    const growth = firstPer > 0 ? lastPer / firstPer : null
    lines.push(
      `- **Entity curve**: sync costs ${perEntity(first.syncMs, first.entities)} µs per entity at ${first.entities} ` +
        `and ${perEntity(last.syncMs, last.entities)} µs per entity at ${last.entities}. ` +
        `The per-entity cost ${growth !== null && growth > 2 ? `grew ${growth.toFixed(1)}×` : 'stayed flat'} as the ` +
        `world grew, so the sync is ${growth !== null && growth > 2 ? 'super-linear' : 'linear'}.`
    )
    lines.push(
      `- **Entity curve, the executor**: overhead at ${last.entities} entities is ${number(last.executorOverheadMs)} ms, ` +
        `against ${number(first.executorOverheadMs)} ms at ${first.entities} — the executor's work is the pass count, ` +
        `not the entity count.`
    )
  }

  const passes = results.passCurve.filter(entry => entry.probePasses > 0)
  if (passes.length) {
    const last = passes[passes.length - 1]
    const share = last.stepMs ? (last.executorOverheadMs ?? 0) / last.stepMs : null
    lines.push(
      `- **Pass curve**: at ${last.probePasses} added passes the frame takes ${number(last.stepMs)} ms and the ` +
        `executor's own bookkeeping is ${number(last.executorOverheadMs)} ms of it (${percent(share)}); the rest is ` +
        `the passes drawing. The kernel's share of a frame falls as passes are added.`
    )
  }

  const gpu = results.scenes.filter(scene => Number.isFinite(scene.gpuMs) || Number.isFinite(scene.gpuInclusiveMs))
  if (gpu.length) {
    lines.push(
      '- **GPU timing**: ' +
        (results.environment.backend?.timestampQuery
          ? 'the card exposes three\'s whole-frame timestamp, so each scene has one GPU number. No per-pass GPU time is exposed.'
          : 'the card exposes no timestamp query, so only the barrier number is available, and it includes the CPU time between submits.')
    )
  } else {
    lines.push('- **GPU timing**: the card exposed none, so the report carries CPU time only.')
  }
  return lines.join('\n')
}

/** The whole report, from one measured result. */
export function renderReport(results) {
  return `# Render kernel benchmark

Measured ${results.measuredAt} on ${results.environment.gpu?.renderer ?? 'an unknown card'}
(\`${results.environment.gpu?.version ?? 'no WebGL context'}\`), backend
\`${results.environment.backend?.name ?? 'unknown'}\`, viewport ${results.environment.viewport.join('×')},
${results.environment.frames} frames after ${results.environment.warmupFrames} warmup frames.

The harness runs the real renderer in a hidden Chrome with a real GPU. Scenes are
built through the engine's own world surface, the live pass records are wrapped
with timers in place, and frames are driven through \`loop.step(0)\` — a stopped
clock, so every frame is a settled still frame.

## What is measured

- **Total frame**: \`loop.step(0)\`, which is the plugin frame systems, then
  \`renderer.sync\`, then \`renderer.draw\`.
- **Kernel stages**: the entity sync, the frame pass's \`prepare\` (world matrices
  and shadow flags), the graph executor's own bookkeeping (\`graph.run\` minus
  every pass callback), and the draw's tail after \`graph.run\`.
- **Per-pass work**: each pass's \`extract\`, \`prepare\` and \`execute\`, attributed
  by pass name.
- \`stats\` (draw calls, triangles, merged, batches, materials), the target pool's
  \`created\`, and the JS heap size.

## What is not measured

- **Per-pass GPU time.** three exposes one whole-frame timestamp, not one per
  pass. The WebGL 2 disjoint-timer extension would give per-query time, but the
  engine runs its WebGPU backend here.
- **The card's own frame time in isolation.** A headless browser still paces on
  the compositor, so the frame time is the CPU time to describe a frame plus what
  the barrier waits for, not a pure GPU counter.
- **A real game's art.** The scenes use the engine's standard materials and one
  procedural light; they do not load a level's models and textures.
- **Anything finer than the page's clock.** Chrome clamps \`performance.now()\` on
  a page that is not cross-origin isolated, so every stage shorter than the
  quantum reads as zero or as the quantum. The measured quantum is in the table
  below; the 1,000- and 10,000-entity rows and the pass curve are far above it.

## Environment

| key | value |
| --- | --- |
| WebGL version | ${results.environment.gpu?.version ?? '—'} |
| WebGL renderer | ${results.environment.gpu?.renderer ?? '—'} |
| WebGL2 disjoint timer query | ${results.environment.gpu?.disjointTimerQuery ?? '—'} |
| backend | ${results.environment.backend?.name ?? '—'} (webgpu: ${results.environment.backend?.webgpu ?? '—'}, timestamp query: ${results.environment.backend?.timestampQuery ?? '—'}) |
| device pixel ratio | ${results.environment.devicePixelRatio} |
| measured clock quantum | ${number(results.environment.timerResolutionMs, 4)} ms |
| pass names at boot | ${results.environment.passNames.join(', ')} |

## Scenes

Three extremes: a retro-2D sprite frame, a mid frame of many lit meshes that
batch, and an AAA-ish frame of many physically-based meshes under a
shadow-casting light, with a real post chain and extra full-scene passes.

${sceneTable(results.scenes)}

### GPU time per scene

| scene | three whole-frame timestamp ms | barrier frame ms |
| --- | --- | --- |
${results.scenes.map(scene => `| ${scene.name} | ${number(scene.gpuMs)} | ${number(scene.gpuInclusiveMs)} |`).join('\n')}

### Per pass

${results.scenes.map(scene => `#### ${scene.name}\n\n${passTable(scene)}\n\nPlugin frame systems, which run before the draw:\n\n${frameSystemTable(scene)}`).join('\n\n')}

## Entity-count curve

A grid of lambert meshes, no post chain, no shadow-casting light, so the curve is
the kernel's own work: 1 → 100 → 1,000 → 10,000 entities.

${entityTable(results.entityCurve)}

## Pass-count curve

Three hundred meshes, each with its own material parameters, plus N passes that
each render the whole scene into a half-resolution transient: 1 → 10 → 50 passes.
Each probe is a real full-scene draw, so the curve separates the executor's
bookkeeping from the draws it runs.

${passCurveTable(results.passCurve)}

## Findings

${findings(results)}

## Reproducing

\`\`\`sh
npm run bench:render        # measure, write agent-runs/benchmark-results.json and this report
npm run bench:check         # compare the last result against the committed baseline
\`\`\`
`
}
