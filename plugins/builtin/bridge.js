/**
 * Terminal Bridge — the door any CLI walks in through.
 *
 * The editor already exposes everything as `window.engine`. This plugin makes
 * that same surface reachable from outside the browser, so an agent running in
 * a terminal (any agent — this file names no vendor) can read and drive a live
 * editor without a screenshot and without being embedded in our UI.
 *
 * Transport is Vite's existing dev-server websocket. No extra port, no extra
 * dependency, and it dies with the dev server rather than outliving it.
 *
 *   terminal  ->  bin/engine.mjs  ->  POST /api/engine  ->  ws  ->  here
 *
 * An op is just a method name on window.engine, so this file never needs
 * editing when a verb is added — the surface and the bridge stay in step by
 * construction.
 */
export default {
  name: 'Terminal Bridge',

  onLoad(context) {
    const hot = import.meta.hot
    if (!hot) {
      // production build: no dev socket, so no bridge. Not an error.
      return
    }

    hot.on('engine:call', async ({ id, op, args = [] }) => {
      let out
      try {
        out = { id, ok: true, result: await invoke(op, args, context) }
      } catch (e) {
        out = { id, ok: false, error: String(e?.message || e), stack: e?.stack }
      }
      hot.send('engine:reply', safe(out))
    })

    context.bus.emit('bridge:ready')
    console.log('%cbridge open', 'font-weight:600', '— node bin/engine.mjs snapshot')
  },

  commands: [{
    id: 'bridge.status',
    label: 'Bridge: status',
    run: () => ({ open: !!import.meta.hot, transport: 'vite ws' })
  }]
}

/**
 * `window.engine` is resolved per call, not captured: plugins boot before the
 * inspect surface is built, so capturing it here would capture undefined.
 */
async function invoke(op, args, context) {
  if (op === 'eval') {
    // The escape hatch. Anything the surface does not cover, an agent can still
    // reach — which is the point of running in the page rather than beside it.
    return await (0, eval)(`(async () => { ${args[0]} })()`)
  }
  if (op === 'ping') return { ready: !!window.engine, level: context.level() }

  const api = window.engine
  if (!api) throw new Error('engine not ready yet — the editor is still booting')

  const fn = api[op]
  if (typeof fn === 'function') return await fn.apply(api, args)

  // Not a method — try it as a command id. This is what makes the CLI extend
  // itself: a plugin that adds `tests.run` has just added a terminal verb, and
  // bin/engine.mjs never had to hear about it.
  // A command takes a single `args` value, so pass one through as itself.
  if (api.commands().some(c => c.id === op)) {
    return await api.run(op, args.length > 1 ? args : args[0])
  }

  throw new Error(
    `no op "${op}".\n  methods:  ${Object.keys(api).filter(k => typeof api[k] === 'function').join(' ')}` +
    `\n  commands: ${api.commands().map(c => c.id).join(' ')}`
  )
}

/**
 * Results cross a JSON boundary. Drop what cannot survive it rather than
 * failing the whole call — a command that returns a DOM node should still
 * report that it ran.
 */
function safe(value) {
  const seen = new WeakSet()
  return JSON.parse(JSON.stringify(value, (k, v) => {
    if (typeof v === 'function') return `[fn ${v.name || 'anonymous'}]`
    if (typeof v === 'bigint') return String(v)
    if (v instanceof Node) return `[dom ${v.nodeName.toLowerCase()}]`
    if (v && typeof v === 'object') {
      if (seen.has(v)) return '[circular]'
      seen.add(v)
    }
    return v
  }))
}
