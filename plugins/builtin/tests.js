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
let version = 0

/**
 * The list comes from the generated index rather than `import.meta.glob`.
 *
 * A glob is fixed when the page loads, so a test written after that would not
 * exist until a reload — which is exactly the moment you want to run it.
 */
const listed = context => Object.entries(context.editor.index.tests || {})
  .map(([id, test]) => ({ id, ...test }))
  .sort((a, b) => a.id.localeCompare(b.id))

const load = async file => (await import(/* @vite-ignore */ `/project/${file}?hot=${++version}`)).default

export default {
  name: 'Test Runner',

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
        return ui.empty('no tests — add project/tests/<name>.js')
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
        definition = await load(entry.file)
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

  save(context)
  return summary(out)
}

async function runOne(definition, id, context) {
  await context.editor.loadLevel(definition.level || context.level())

  const checks = []
  const test = makeT(context, checks)
  const t0 = performance.now()
  let error = null

  try {
    await definition.run(test)
  } catch (e) {
    error = String(e?.message || e)
  }

  return {
    name: definition.name || id,
    ok: !error && checks.every(c => c.ok),
    ms: Math.round(performance.now() - t0),
    checks,
    error
  }
}

/**
 * The vocabulary a test is written in. Deliberately the same nouns the rest of
 * the engine uses — entities by id, properties, named input actions — so a test
 * reads like the game rather than like a harness.
 */
function makeT(context, checks) {
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

  // Real key events, so the input plugin is exercised rather than bypassed.
  const key = (action, type) => {
    const code = context.input?.codes?.(action)?.[0]
    if (!code) throw new Error(`no key bound to action "${action}"`)
    dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }))
  }

  const startAll = () => {
    for (const e of [...world.entities]) world.hook(e, 'start', context)
  }

  const test = {
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
    hold(action, seconds = 0.5) { key(action, 'keydown'); test.simulate(seconds); key(action, 'keyup') },
    tap(action) { key(action, 'keydown'); test.simulate(1 / 60); key(action, 'keyup') },

    is: (got, want, message) => push(same(got, want), message, got, want),
    near: (got, want, tol, message) => push(Math.abs(got - want) <= tol, message, round(got), `${want} ±${tol}`),
    ok: (cond, message) => push(!!cond, message, !!cond, true),
    note: message => checks.push({ ok: true, message, note: true })
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
    ms: list.reduce((n, r) => n + (r.ms || 0), 0),
    tests: list.map(r => r.ok
      ? { id: r.id, ok: true, ms: r.ms }
      : {
          id: r.id, ok: false, ms: r.ms,
          ...(r.error ? { error: r.error } : {}),
          fails: (r.checks || []).filter(c => !c.ok)
        })
  }
}

const round = n => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n)
