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
import { makeLoader } from './rapier/loading.js'
import { installSolver } from './rapier/solver-context.js'

const REPLACES = 'Physics 2D'

/** The plugin's own name, and the hold the world waits under while it compiles. */
const NAME = 'Rapier 2D'
const HOLD = `${NAME} loading`

/** Three numbers in the collider box says 3D, and Rapier 3D claims those. */
const is2D = entity =>
  !!entity?.collider && (Number(entity.collider.circle) > 0 || entity.collider.box?.length !== 3)

const round = value => Math.round(value * 1000) / 1000

const { startLoading, bridgeOf } = makeLoader({
  name: NAME,
  hold: HOLD,
  load: () => import('@dimforge/rapier2d-deterministic-compat'),
  solver: module => makeBridge({ RAPIER: module, tag: 'rapier-2d', claims: is2D, flat: true, gravity: GRAVITY_2D })
})

/** Whether this solver may run, and the one sentence that says why not. */
function standingDown(context) {
  const other = context.loader.plugins.get(REPLACES)
  if (!other?.enabled) return null
  return `${REPLACES} is still enabled and owns the same entities. Run \`rapier2d.use\` to switch.`
}

/**
 * Put this world's solver back to the moment a checkpoint holds.
 *
 * A null capture resets the solver. Otherwise restore bytes and entity bindings
 * after the world has restored its entities.
 *
 * @param {object} context The world's context.
 * @param {object|null} capture Solver bytes and entity bindings, or null.
 * @returns {boolean} Whether the solver is where the checkpoint says it was.
 */
function restoreSolver(context, capture) {
  const bridge = bridgeOf(context)
  // Not loaded yet, so it holds nothing and there is nothing to put back.
  if (!bridge) return true
  if (capture) return bridge.restoreCapture(capture, context.world) === true
  bridge.forget()
  return true
}

export default {
  name: NAME,
  category: 'engine',
  about: 'Rigid body physics in two dimensions, solved by Rapier. Adds rotation, mass, friction and sleeping to the Physics 2D contract, and replays identically on any machine.',

  onLoad(context) {
    installSolver(context, { key: 'rapier2d', name: NAME, bridgeOf, restore: restoreSolver })

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
