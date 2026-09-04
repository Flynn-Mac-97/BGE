/**
 * Test Runner — run the project's tests, and remember how they went.
 *
 * A test is a file, same as a type is a file: `project/tests/coin-pickup.js`,
 * depth 1, `export default {}`. That is the whole point of this plugin. The
 * throwaway scripts an agent writes to check its own work are exactly the
 * scripts worth keeping, and a file in `tests/` survives the session that
 * produced it while a shell one-liner does not.
 *
 * Results live in `project/.engine/tests.json` beside the generated index —
 * outside the tree the user browses, because they are output, not source.
 *
 * A test cannot corrupt a level: running one marks the world simulated, and a
 * simulated world refuses to save.
 */
const RESULTS = '.engine/tests.json'
const HISTORY = 20

/** id -> { name, ok, ms, checks, error, recent } — recent is a 'PPFP' string. */
const results = new Map()
let running = false

/**
 * The list comes from the generated index rather than `import.meta.glob`.
 *
 * A glob is fixed when the page loads, so a test written after that would not
 * exist until a reload — which is exactly the moment you want to run it.
 */
const listed = context => Object.entries(context.editor.index.tests || {})
  .map(([id, test]) => ({ id, ...test }))
  .sort((a, b) => a.id.localeCompare(b.id))

// Through context, because the browser imports a project file by URL and node
// imports it by path. One place knows the difference; this is not it.
const load = (context, file) => context.importProjectFile(file)

export default {
  name: 'Test Runner',
  category: 'agents',
  about: 'Run the project tests, and remember how they went.',
  inspect: () => {
    const ran = [...results.values()]
    const passing = ran.filter(r => r.ok).length
    return ran.length
      ? [{ title: 'Last run', rows: [[`${passing}/${ran.length} passing`, ran.length === passing ? '' : 'some failed']] }]
      : []
  },

  async onLoad(context) {
    // Last run's verdicts, so the panel says something before you press anything.
    try {
      const saved = JSON.parse(await context.files.read(RESULTS))
      for (const [id, r] of Object.entries(saved.tests || {})) results.set(id, r)
    } catch { /* first run, or no results yet */ }
  },

  panels: [{
    id: 'tests',
    title: 'Tests · run',
    dock: 'bottom',
    order: 10,

    actions: [{ label: 'Run all', title: 'Run every test', run: context => runAll(context) }],

    render(ui, context) {
      const ids = listed(context).map(test => test.id)
      if (!ids.length) {
        return ui.empty(`no tests — add ${context.editor.projectDirectory}/tests/<name>.js`)
      }

      const pass = ids.filter(id => results.get(id)?.ok).length
      const ran = ids.filter(id => results.has(id)).length

      return ui.stack([
        ui.list({
          items: ids,
          key: id => id,
          dim: id => !results.has(id),
          row: id => {
            const r = results.get(id)
            const fail = r?.checks?.find(c => !c.ok)
            return [
              ui.glyph(!r ? '·' : r.ok ? '✓' : '✗', { strong: r && !r.ok }),
              ui.label(id),
              ui.meta(r?.name && r.name !== id ? r.name : ''),
              ui.spacer(),
              ui.meta(r?.error || fail?.message || ''),
              ui.meta(r ? `${r.ms}ms` : ''),
              ui.meta(r?.recent || '')
            ]
          },
          onPick: id => runAll(context, id)
        }),
        // Frames the tests left behind, for the reader whose eyes are better
        // than the assertions. One closed fold per test, so many frames do not
        // push the verdict line out of the panel. Stamped by run time so a
        // rerun's picture wins over the browser cache.
        ...ids.map(id => {
          const result = results.get(id)
          const frames = (result?.checks || []).filter(check => check.frame)
          if (!frames.length) return null
          return ui.fold(id,
            ui.gallery(frames.map(check =>
              ui.picture(check.frame, { label: check.message, stamp: `${id}-${result.ms}` }))),
            { meta: `${frames.length} frame${frames.length === 1 ? '' : 's'}` })
        }),
        ui.text(running ? 'running…' : ran ? `${pass}/${ran} passing` : 'not run yet', { dim: true })
      ])
    }
  }],

  commands: [
    {
      id: 'tests.run',
      label: 'Run tests',
      // args: a test id, or nothing for all of them
      run: (context, only) => runAll(context, only)
    },
    {
      id: 'tests.results',
      label: 'Last test results',
      run: () => summary([...results.entries()].map(([id, r]) => ({ id, ...r })))
    }
  ]
}

// ------------------------------------------------------------------ running
async function runAll(context, only) {
  if (running) return { error: 'a test run is already in progress' }
  running = true

  const restore = context.level()
  const out = []

  try {
    // Re-read the index first, so a test written a second ago is included.
    context.editor.index = await context.files.index()

    for (const entry of listed(context)) {
      const id = entry.id
      if (only && id !== only) continue

      let definition
      try {
        definition = await load(context, entry.file)
        if (typeof definition?.run !== 'function') throw new Error('no run(test) exported')
      } catch (e) {
        out.push(record(id, { name: id, ok: false, ms: 0, checks: [], error: `load failed — ${e.message}` }))
        continue
      }
      out.push(record(id, await runOne(definition, id, context)))
    }
  } finally {
    running = false
    // Leave the editor exactly where it was found — a test run is not an edit.
    await context.editor.loadLevel(restore)
    context.redraw()
  }

  // Awaited, or a headless process exits before the write lands and the saved
  // results silently hold the run before this one.
  await save(context)
  return summary(out)
}

async function runOne(definition, id, context) {
  await context.editor.loadLevel(definition.level || context.level())

  const checks = []
  // A subscription outlives the function that made it, so the next test would
  // inherit it. Collected here and dropped below, whether the test passed or threw.
  const unsubscribes = []
  const test = makeT(context, checks, unsubscribes)
  const t0 = performance.now()
  let error = null

  try {
    await definition.run(test)
  } catch (e) {
    error = String(e?.message || e)
  } finally {
    for (const off of unsubscribes) { try { off() } catch { /* already gone */ } }
  }

  // `note` records a line without asserting anything, so it must not count
  // towards whether the test tested.
  const assertions = checks.filter(check => !check.note).length

  return {
    name: definition.name || id,
    // A test that asserted nothing is not passing, it is empty. `every` on an
    // empty array is true, so an early return above a hundred assertions used
    // to sit on the board as a green tick for its whole life — and a dead test
    // is worse than a missing one, because it reads as coverage.
    ok: !error && assertions > 0 && checks.every(check => check.ok),
    assertions,
    ms: Math.round(performance.now() - t0),
    checks,
    error: error || (assertions === 0 ? 'made no assertions' : null)
  }
}

/**
 * The vocabulary a test is written in. Deliberately the same nouns the rest of
 * the engine uses — entities by id, properties, named input actions — so a test
 * reads like the game rather than like a harness.
 */
function makeT(context, checks, unsubscribes) {
  const { world, loop } = context
  let started = false

  const need = id => {
    const e = world.byId(id)
    if (!e) throw new Error(`no entity "${id}"`)
    return e
  }

  const push = (ok, message, got, want) => {
    checks.push(ok ? { ok, message } : { ok, message, got, want })
    return ok
  }

  const same = (a, b) => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b)

  // A real key, so the input plugin's binding is exercised rather than
  // bypassed — but pressed through the plugin rather than through a
  // KeyboardEvent, so the same test runs with no window to dispatch into.
  const key = (action, down) => {
    const code = context.input?.codes?.(action)?.[0]
    if (!code) throw new Error(`no key bound to action "${action}"`)
    if (down) context.input.press(code)
    else context.input.release(code)
  }

  const startAll = () => {
    for (const e of [...world.entities]) world.hook(e, 'start', context)
  }

  const test = {
    /**
     * The live context, the same object every hook is handed.
     *
     * Without it a test could only see the world, so anything a plugin
     * contributed — raycast, damage, weapons, a match — could not be asked
     * anything. Three builtins used to publish a module-level handle purely so a
     * test could import it back, which worked only because a plugin module is a
     * singleton and read like a trick. The verbs below are shortcuts into this.
     */
    context,

    /** Drive the editor the way the terminal does. Commands are the public surface. */
    run: (id, args) => context.run(id, args),

    /** Listen on the bus. Dropped for you when the test ends. */
    on(event, handler) {
      const off = context.bus.on(event, handler)
      unsubscribes.push(off)
      return off
    },

    get state() { return world.state },
    get entities() { return world.entities },

    entity: id => need(id),
    count: type => world.all(type).length,
    exists: id => !!world.byId(id),

    at(id, x, y) { const e = need(id); e.x = x; e.y = y; return e },
    set(id, k, v) { const e = need(id); if (k in e.properties) e.properties[k] = v; else e[k] = v; return e },
    spawn: (type, placement) => context.spawn(type, placement),
    destroy: id => context.destroy(need(id)),

    // Arrange a composition without keeping a level file around just to hold
    // it. Straight to the world rather than through behaviour.attach, because
    // that verb saves, and a test must never write to a level.
    attach: (id, name, properties) => world.attach(need(id), name, properties || {}),
    detach: (id, name) => world.detach(need(id), name),

    /** Advance the fixed clock. No real time passes and no frame is needed. */
    simulate(seconds = 1) {
      if (!started) { startAll(); started = true }
      loop.step(Math.max(1, Math.round(seconds * 60)))
    },
    hold(action, seconds = 0.5) { key(action, true); test.simulate(seconds); key(action, false) },
    tap(action) { key(action, true); test.simulate(1 / 60); key(action, false) },

    is: (got, want, message) => push(same(got, want), message, got, want),
    near: (got, want, tol, message) => push(Math.abs(got - want) <= tol, message, round(got), `${want} ±${tol}`),
    ok: (cond, message) => push(!!cond, message, !!cond, true),
    note: message => checks.push({ ok: true, message, note: true }),

    /**
     * Keep a picture as part of the result — a frame the test made, by
     * checkout path. The panel shows it, because a human's eyes catch what an
     * assertion cannot, and a frame from a seeded run only changes when the
     * game does. Takes the path, or the `files` list a see command answers.
     */
    frame(path, caption) {
      // A checkout path, a `files` list from a see command, or a data URL from
      // a browser sketch — whatever form the frame arrived in, keep it.
      const file = Array.isArray(path) ? path.find(entry => entry.endsWith('.png')) : path
      if (typeof file === 'string') checks.push({ ok: true, message: caption || 'frame', note: true, frame: file })
    }
  }

  return test
}

// ------------------------------------------------------------------ results
function record(id, r) {
  const prev = results.get(id)
  const recent = ((prev?.recent || '') + (r.ok ? 'P' : 'F')).slice(-HISTORY)
  const full = { ...r, recent }
  results.set(id, full)
  return { id, ...full }
}

async function save(context) {
  try {
    await context.files.writeJSON(RESULTS, {
      at: new Date().toISOString(),
      tests: Object.fromEntries(results)
    })
  } catch (e) {
    console.error('[tests] could not write results', e)
  }
}

/** Compact on success, detailed only where something failed. */
function summary(list) {
  return {
    passed: list.filter(r => r.ok).length,
    failed: list.filter(r => !r.ok).length,
    // Coverage as a number rather than a tick. A passing test used to be a tick
    // with nothing behind it, so fifty-one assertions and zero read the same.
    assertions: list.reduce((n, r) => n + (r.assertions || 0), 0),
    ms: list.reduce((n, r) => n + (r.ms || 0), 0),
    tests: list.map(r => r.ok
      ? { id: r.id, ok: true, ms: r.ms, assertions: r.assertions }
      : {
          id: r.id, ok: false, ms: r.ms,
          ...(r.error ? { error: r.error } : {}),
          fails: (r.checks || []).filter(c => !c.ok)
        })
  }
}

const round = n => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n)
