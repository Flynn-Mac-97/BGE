/**
 * Kernel: the WebAssembly load, and the hold that makes the wait safe.
 *
 * Both Rapier solvers fetch the same shape of module and both must hold the world
 * while it compiles: a step taken before the solver lands moves a world with no
 * physics in it and answers as though it had, so two runs of one level disagree
 * by however long the load took. The hold is named, so `snapshot().paused` and a
 * `simulate` reply say what the world is waiting for.
 *
 * The compiled module is shared — megabytes, and compiling it twice for two
 * worlds costs seconds for nothing. The Rapier world and the entity-to-body map
 * are not: a bridge reconciles against one entity list and drops every body that
 * is not in it, so each world gets its own.
 *
 * The promise is held rather than the bridge, so a step that arrives while the
 * module is still compiling waits on the first load instead of building a second
 * solver under the same world. A bare context in a unit test has neither a loop
 * nor a startup registry, and there the load starts unannounced.
 */
export function makeLoader({ name, hold, load, loaded = () => {}, solver }) {
  let loading = null
  const solvers = new WeakMap()

  /** The module, fetched once for the process. */
  function loadModule() {
    if (!loading) {
      // An interval counts as pending work in node, so a headless process with
      // nothing else to do does not exit part-way through the load and report
      // success.
      const keepAlive = setInterval(() => {}, 50)
      loading = load().then(async module => {
        const toolkit = module.default ?? module
        await toolkit.init()
        loaded(toolkit)
        return toolkit
      }).finally(() => clearInterval(keepAlive))
    }
    return loading
  }

  /** This world's bridge, or null until the module lands. */
  const bridgeOf = context => solvers.get(context)?.bridge || null

  /** Start the load, build this world's solver, and hold the world until it lands. */
  function startLoading(context) {
    let held = solvers.get(context)
    if (!held) { held = { bridge: null, started: null }; solvers.set(context, held) }
    if (held.started) return held.started
    context.loop?.hold(hold)
    held.started = loadModule().then(module => {
      held.bridge = solver(module)
      held.bridge.start()
      return held.bridge
    }).finally(() => context.loop?.release(hold))
    context.startup?.add(name, held.started)
    return held.started
  }

  return { startLoading, bridgeOf }
}
