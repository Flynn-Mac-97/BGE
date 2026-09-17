/**
 * Rapier 2D — the same contract as Physics 2D, solved by Rapier.
 *
 * The collider shape still decides who owns an entity: two numbers in the box,
 * or a circle, and it is ours. What Rapier adds is rotation, mass, friction
 * and sleeping, and a circle is a real circle here rather than a box the same
 * size.
 *
 * Only one solver may own an entity, so this stands down while Physics 2D is
 * enabled. `rapier2d.use` switches in one call and writes it to game.json.
 */
import { makeBridge, GRAVITY_2D } from './rapier/bridge.js'

const REPLACES = 'Physics 2D'

/** The plugin's own name, and the hold the world waits under while it compiles. */
const NAME = 'Rapier 2D'
const HOLD = `${NAME} loading`

/** Three numbers in the collider box says 3D, and Rapier 3D claims those. */
const is2D = entity =>
  !!entity?.collider && (Number(entity.collider.circle) > 0 || entity.collider.box?.length !== 3)

const round = value => Math.round(value * 1000) / 1000

let loading = null

/**
 * This world's solver, by its context.
 *
 * The compiled module is shared — megabytes, and compiling it twice for two worlds
 * costs seconds for nothing. The Rapier world and the entity-to-body map are not:
 * a bridge reconciles against one entity list and drops every body that is not in
 * it, so one bridge over two worlds made each step tear the other world's bodies
 * down and build them again from the entities.
 */
const solvers = new WeakMap()

/** This world's bridge, or null while the WebAssembly is still compiling. */
const bridgeOf = context => solvers.get(context)?.bridge || null

/** What the panel remembers between renders, per world. */
const panelHashes = new WeakMap()

/**
 * The module is megabytes of WebAssembly, so it is fetched once for the process.
 *
 * The timer holds the event loop open. Neither the import nor Rapier's `init`
 * counts as pending work in node, so a headless process with nothing else to
 * do exits part-way through the load and reports success.
 */
async function loadModule() {
  if (!loading) {
    const hold = setInterval(() => {}, 50)
    loading = import('@dimforge/rapier2d-deterministic-compat').then(async module => {
      const loaded = module.default ?? module
      await loaded.init()
      return loaded
    }).finally(() => clearInterval(hold))
  }
  return loading
}

/**
 * Start the WebAssembly, build this world's solver, and hold the world until it
 * lands.
 *
 * The hold is what makes the wait safe. A step taken while the solver is still
 * compiling moves a world with no physics in it and answers as though it had,
 * and two runs of the same level then disagree by however long the load took.
 * The hold is named, so `snapshot().paused` and a `simulate` reply say what the
 * world is waiting for.
 *
 * The promise is held rather than the bridge, so a step that arrives while the
 * module is still compiling waits on the first load instead of building a second
 * solver under the same world.
 *
 * A world from the kernel has a loop to hold and a startup registry the caller
 * waits on. A bare context in a unit test has neither, and there the load starts
 * unannounced, which is how it behaved before.
 */
function startLoading(context) {
  let solver = solvers.get(context)
  if (!solver) { solver = { bridge: null, started: null }; solvers.set(context, solver) }
  if (solver.started) return solver.started
  context.loop?.hold(HOLD)
  solver.started = loadModule().then(module => {
    solver.bridge = makeBridge({ RAPIER: module, tag: 'rapier-2d', claims: is2D, flat: true, gravity: GRAVITY_2D })
    solver.bridge.start()
    return solver.bridge
  }).finally(() => context.loop?.release(HOLD))
  context.startup?.add(NAME, solver.started)
  return solver.started
}

/** Whether this solver may run, and the one sentence that says why not. */
function standingDown(context) {
  const other = context.loader.plugins.get(REPLACES)
  if (!other?.enabled) return null
  return `${REPLACES} is still enabled and owns the same entities. Run \`rapier2d.use\` to switch.`
}

/**
 * Put this world's solver back to the moment a checkpoint holds.
 *
 * `bytes` null means the checkpoint was taken while the solver held nothing — it
 * was still compiling, or nothing had stepped yet. Holding nothing is what it was,
 * so the bodies are dropped and built again from the entities on the next step.
 * Keeping them would leave the bodies of the later run standing in a world rewound
 * to an earlier one, with the entities looking right and the velocities wrong.
 *
 * @param {object} context The world's context.
 * @param {Uint8Array|null} bytes A snapshot, or null.
 * @returns {boolean} Whether the solver is where the checkpoint says it was.
 */
function restoreSolver(context, bytes) {
  const bridge = bridgeOf(context)
  // Not loaded yet, so it holds nothing and there is nothing to put back.
  if (!bridge) return true
  if (bytes) return bridge.restore(bytes) === true
  bridge.forget()
  return true
}

export default {
  name: NAME,
  category: 'engine',
  about: 'Rigid body physics in two dimensions, solved by Rapier. Adds rotation, mass, friction and sleeping to the Physics 2D contract, and replays identically on any machine.',

  onLoad(context) {
    context.rapier2d = {
      snapshot: () => bridgeOf(context)?.snapshot() || null,
      /** Put the solver back to a snapshot's moment. False when it would not go. */
      restore: bytes => bridgeOf(context)?.restore(bytes) === true
    }
    // What this solver holds, so a checkpoint of the run carries the bodies. The
    // entities alone are not enough: a ball restored to where it was with no
    // velocity behind it is a world that stands still and looks right. Null is a
    // moment taken before the solver had bodies, and putting that back means
    // holding none — otherwise the rewind replays the later run's velocities.
    context.checkpoints?.add(NAME, {
      capture: () => bridgeOf(context)?.snapshot() || null,
      restore: bytes => restoreSolver(context, bytes)
    })
    context.bus.on('level:loaded', () => bridgeOf(context)?.forget())

    // Started here, before anything can step, so no run begins without its
    // solver. The choice is already readable: this stands down while Physics 2D
    // is enabled, and then the module is never fetched.
    if (!standingDown(context)) startLoading(context)
  },

  inspect: [{
    title: 'Rapier 2D',
    rows: context => {
      const held = standingDown(context)
      if (held) return [['state', held]]
      const stats = bridgeOf(context)?.stats()
      if (!stats) return [['state', 'loading WebAssembly']]
      return [
        ['dynamic bodies', stats.dynamic], ['solids', stats.solid],
        ['sensors', stats.sensors], ['asleep', stats.asleep], ['gravity', `${stats.gravity} m/s/s`]
      ]
    }
  }],

  systems: [{
    phase: 'fixed',
    run(world, seconds, context) {
      if (standingDown(context)) return
      const bridge = bridgeOf(context)
      if (!bridge) { startLoading(context); return }
      bridge.step(world, seconds, context)
    }
  }],

  panels: [{
    id: 'rapier-2d',
    title: 'Rapier 2D',
    dock: 'right',
    order: 45,

    render(ui, context) {
      const held = standingDown(context)
      const stats = bridgeOf(context)?.stats()
      const counts = stats
        ? [['dynamic', stats.dynamic], ['solid', stats.solid], ['sensors', stats.sensors], ['asleep', stats.asleep]]
        : [['state', 'loading WebAssembly']]

      return ui.stack([
        ui.toggle({
          label: 'Solve 2D with Rapier',
          value: !held,
          onChange: value => context.run('rapier2d.use', { on: value })
        }),
        ...(held
          ? [ui.text(held, { dim: true })]
          : counts.map(([name, value]) => ui.row([ui.label(name), ui.value(value)]))),
        ui.button('Hash the world', async () => {
          const reply = await context.run('rapier2d.snapshot')
          panelHashes.set(context, reply?.sha256?.slice(0, 16) || reply?.error || 'nothing simulated yet')
          context.redraw()
        }),
        ui.text(panelHashes.get(context) ? `sha256 ${panelHashes.get(context)}` : 'hash two runs to compare them', { dim: true })
      ])
    }
  }],

  commands: [
    {
      id: 'rapier2d.use',
      label: 'Switch 2D physics between Rapier and the built-in solver',
      // run rapier2d.use            — Rapier on, Physics 2D off
      // run rapier2d.use '{"on":false}'
      async run(context, options) {
        const on = options?.on === undefined ? true : !!options.on
        await context.run('plugins.enable', [REPLACES, !on])
        await context.run('plugins.enable', ['Rapier 2D', on])
        if (on) await startLoading(context)
        return {
          solver: on ? 'Rapier 2D' : REPLACES,
          wrote: 'game.json',
          // Turning this off takes this command with it, because a disabled
          // plugin contributes nothing. The way back is the general verb.
          ...(on ? {} : { back: `run plugins.enable '["Rapier 2D", true]'` })
        }
      }
    },
    {
      id: 'rapier2d.bodies',
      label: 'What Rapier 2D is simulating',
      run(context) {
        const held = standingDown(context)
        if (held) return { standingDown: held }
        const bridge = bridgeOf(context)
        if (!bridge) return { state: 'loading WebAssembly — call again' }
        const bodies = []
        for (const [entity, entry] of bridge.bodies) {
          if (entity.properties?.body !== 'dynamic') continue
          const speed = entry.body.linvel()
          bodies.push({
            id: entity.id,
            at: [round(entity.x), round(entity.y)],
            velocity: [round(speed.x), round(speed.y)],
            spin: round(entity.rotation || 0),
            grounded: entity.grounded === true,
            asleep: entry.body.isSleeping()
          })
        }
        return { bodies, against: bridge.stats() }
      }
    },
    {
      id: 'rapier2d.snapshot',
      label: 'Hash the simulated world, to prove two runs match',
      async run(context) {
        const bytes = bridgeOf(context)?.snapshot()
        if (!bytes) return { error: 'nothing simulated yet' }
        const digest = await crypto.subtle.digest('SHA-256', bytes)
        return {
          bytes: bytes.length,
          steps: context.loop.steps,
          sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
        }
      }
    }
  ]
}
