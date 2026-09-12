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

/** Three numbers in the collider box says 3D, and Rapier 3D claims those. */
const is2D = entity =>
  !!entity?.collider && (Number(entity.collider.circle) > 0 || entity.collider.box?.length !== 3)

const round = value => Math.round(value * 1000) / 1000

let bridge = null
let loading = null

/**
 * The module is megabytes of WebAssembly, so it loads only once this is the
 * chosen solver.
 *
 * The timer holds the event loop open. Neither the import nor Rapier's `init`
 * counts as pending work in node, so a headless process with nothing else to
 * do exits part-way through the load and reports success.
 */
async function load() {
  if (bridge) return bridge
  if (!loading) {
    const hold = setInterval(() => {}, 50)
    loading = import('@dimforge/rapier2d-deterministic-compat').then(async module => {
      const RAPIER = module.default ?? module
      await RAPIER.init()
      bridge = makeBridge({ RAPIER, tag: 'rapier-2d', claims: is2D, flat: true, gravity: GRAVITY_2D })
      bridge.start()
      return bridge
    }).finally(() => clearInterval(hold))
  }
  return loading
}

/** Whether this solver may run, and the one sentence that says why not. */
function standingDown(context) {
  const other = context.loader.plugins.get(REPLACES)
  if (!other?.enabled) return null
  return `${REPLACES} is still enabled and owns the same entities. Run \`rapier2d.use\` to switch.`
}

/** What the panel remembers between renders. */
const panel = { hash: '' }

export default {
  name: 'Rapier 2D',
  category: 'engine',
  about: 'Rigid body physics in two dimensions, solved by Rapier. Adds rotation, mass, friction and sleeping to the Physics 2D contract, and replays identically on any machine.',

  onLoad(context) {
    context.rapier2d = { snapshot: () => bridge?.snapshot() || null }
    context.bus.on('level:loaded', () => bridge?.forget())
  },

  inspect: [{
    title: 'Rapier 2D',
    rows: context => {
      const held = standingDown(context)
      if (held) return [['state', held]]
      const stats = bridge?.stats()
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
      if (!bridge) { load(); return }
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
      const stats = bridge?.stats()
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
          panel.hash = reply?.sha256?.slice(0, 16) || reply?.error || 'nothing simulated yet'
          context.redraw()
        }),
        ui.text(panel.hash ? `sha256 ${panel.hash}` : 'hash two runs to compare them', { dim: true })
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
        if (on) await load()
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
        const bytes = bridge?.snapshot()
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
