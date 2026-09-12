/**
 * Rapier 3D — the same contract as Physics 3D, solved by Rapier.
 *
 * It claims the same entities, reads the same keys and writes the same ones
 * back, so a level plays under either. What it adds is what a box pusher
 * cannot do: rotation, mass, friction, resting contacts and sleeping bodies.
 *
 * Only one solver may own an entity, so this one stands down while Physics 3D
 * is enabled and says how to switch. `rapier3d.use` does the switch in one
 * call, and writes it to game.json so the next reload keeps it.
 *
 * Rapier's WebAssembly build is cross-platform deterministic: the same world
 * stepped the same number of times gives the same bytes from
 * `rapier3d.snapshot` on any machine. That is what makes a replay provable
 * rather than hoped for.
 */
import { makeBridge, GRAVITY_3D } from './rapier/bridge.js'

const REPLACES = 'Physics 3D'

/** Three numbers in the collider box is the single flag that says "3D". */
const is3D = entity =>
  Array.isArray(entity?.collider?.box) && entity.collider.box.length === 3

const round = value => Math.round(value * 1000) / 1000

let RAPIER = null
let bridge = null
let loading = null

/** What the panel remembers between renders. */
const panel = { hash: '' }

/**
 * The module is 2 MB of WebAssembly, so it is fetched only once this is the
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
    loading = import('@dimforge/rapier3d-deterministic-compat').then(async module => {
      RAPIER = module.default ?? module
      await RAPIER.init()
      bridge = makeBridge({ RAPIER, tag: 'rapier-3d', claims: is3D, flat: false, gravity: GRAVITY_3D })
      bridge.start()
      return bridge
    }).finally(() => clearInterval(hold))
  }
  return loading
}

const asVector = value => {
  if (Array.isArray(value)) return { x: Number(value[0]), y: Number(value[1]), z: Number(value[2]) }
  if (value && typeof value === 'object') return { x: Number(value.x), y: Number(value.y), z: Number(value.z) }
  return null
}

const real = vector => vector && [vector.x, vector.y, vector.z].every(Number.isFinite)

/**
 * The nearest thing a ray hits, in the shape Physics 3D answers in.
 *
 * A vector with a component that is not a finite number is refused rather
 * than repaired: a zeroed coordinate returns a confident, precise, wrong
 * answer at the world origin.
 */
function raycast(context, origin, direction, maxDistance = 1000, options = {}) {
  if (!bridge?.ready) return null
  const from = asVector(origin)
  const along = asVector(direction)
  if (!real(from) || !real(along)) {
    console.error('[rapier-3d] raycast needs an origin and a direction of three real numbers')
    return null
  }
  const length = Math.hypot(along.x, along.y, along.z)
  if (!(length > 0)) return null
  const unit = { x: along.x / length, y: along.y / length, z: along.z / length }

  const skip = new Set([options.ignore].flat().filter(Boolean)
    .map(item => (typeof item === 'string' ? item : item?.id)))
  const hit = bridge.rapierWorld.castRayAndGetNormal(
    new RAPIER.Ray(from, unit), Number(maxDistance) || 1000, true, undefined, undefined,
    undefined, undefined, collider => !skip.has(bridge.entityFor(collider.handle)?.id))
  if (!hit) return null

  const entity = bridge.entityFor(hit.collider.handle)
  return {
    entity,
    distance: hit.timeOfImpact,
    point: {
      x: from.x + unit.x * hit.timeOfImpact,
      y: from.y + unit.y * hit.timeOfImpact,
      z: from.z + unit.z * hit.timeOfImpact
    },
    normal: hit.normal
  }
}

/** Is there room for this entity to be this tall, where it stands? */
function canStand(entity, height) {
  if (!bridge?.ready || !is3D(entity)) return true
  const tall = Number(height)
  if (!(tall > 0)) {
    console.error('[rapier-3d] canStand needs a height in metres greater than zero')
    return false
  }
  const [width, own, depth] = entity.collider.box
  const scale = entity.scale ?? 1
  const rise = (tall - own * scale) / 2
  const shape = new RAPIER.Cuboid((width * scale) / 2, tall / 2, (depth * scale) / 2)
  const mine = bridge.bodies.get(entity)?.collider

  let room = true
  bridge.rapierWorld.intersectionsWithShape(
    { x: entity.x, y: entity.y + rise, z: entity.z }, { x: 0, y: 0, z: 0, w: 1 }, shape,
    collider => { room = false; return false },
    undefined, undefined, mine, undefined)
  return room
}

/** Whether this solver may run, and the one sentence that says why not. */
function standingDown(context) {
  const other = context.loader.plugins.get(REPLACES)
  if (!other?.enabled) return null
  return `${REPLACES} is still enabled and owns the same entities. Run \`rapier3d.use\` to switch.`
}

/**
 * `context.raycast` and `canStand` follow whichever solver is chosen.
 *
 * Physics 3D puts its own on context in `onLoad`, which runs whether or not
 * it is enabled, so the two are swapped here each step rather than once at
 * load: then the answer never depends on which plugin loaded last.
 */
let took = null

function takeVerbs(context) {
  if (took) return
  took = { raycast: context.raycast, canStand: context.canStand }
  context.raycast = (origin, direction, maxDistance, options) =>
    raycast(context, origin, direction, maxDistance, options || {})
  context.canStand = (entity, height) => canStand(entity, height)
}

function giveBackVerbs(context) {
  if (!took) return
  context.raycast = took.raycast
  context.canStand = took.canStand
  took = null
}

export default {
  name: 'Rapier 3D',
  category: 'engine',
  about: 'Rigid body physics in three dimensions, solved by Rapier. Adds rotation, mass, friction and sleeping to the Physics 3D contract, and replays identically on any machine.',

  onLoad(context) {
    context.rapier3d = {
      snapshot: () => bridge?.snapshot() || null,
      raycast: (origin, direction, maxDistance, options) =>
        raycast(context, origin, direction, maxDistance, options || {}),
      canStand
    }
    // A level reload builds new entities under the same ids, so every body
    // belongs to the level that is gone.
    context.bus.on('level:loaded', () => bridge?.forget())
  },

  inspect: [{
    title: 'Rapier 3D',
    rows: context => {
      const held = standingDown(context)
      if (held) return [['state', held]]
      const stats = bridge?.stats()
      if (!stats) return [['state', 'loading WebAssembly']]
      return [
        ['dynamic bodies', stats.dynamic], ['solids', stats.solid],
        ['sensors', stats.sensors], ['gravity', `${stats.gravity} m/s/s`]
      ]
    }
  }],

  systems: [{
    phase: 'fixed',
    run(world, seconds, context) {
      if (standingDown(context)) { giveBackVerbs(context); return }
      takeVerbs(context)
      if (!bridge) { load(); return }
      bridge.step(world, seconds, context)
    }
  }],

  panels: [{
    id: 'rapier-3d',
    title: 'Rapier 3D',
    dock: 'right',
    order: 44,

    render(ui, context) {
      const held = standingDown(context)
      const stats = bridge?.stats()
      const counts = stats
        ? [['dynamic', stats.dynamic], ['solid', stats.solid], ['sensors', stats.sensors], ['asleep', stats.asleep]]
        : [['state', 'loading WebAssembly']]

      return ui.stack([
        ui.toggle({
          label: 'Solve 3D with Rapier',
          value: !held,
          onChange: value => context.run('rapier3d.use', { on: value })
        }),
        ...(held
          ? [ui.text(held, { dim: true })]
          : counts.map(([name, value]) => ui.row([ui.label(name), ui.value(value)]))),
        ui.button('Hash the world', async () => {
          const reply = await context.run('rapier3d.snapshot')
          panel.hash = reply?.sha256?.slice(0, 16) || reply?.error || 'nothing simulated yet'
          context.redraw()
        }),
        ui.text(panel.hash ? `sha256 ${panel.hash}` : 'hash two runs to compare them', { dim: true })
      ])
    }
  }],

  commands: [
    {
      id: 'rapier3d.use',
      label: 'Switch 3D physics between Rapier and the built-in solver',
      // run rapier3d.use            — Rapier on, Physics 3D off
      // run rapier3d.use '{"on":false}'
      async run(context, options) {
        const on = options?.on === undefined ? true : !!options.on
        await context.run('plugins.enable', [REPLACES, !on])
        await context.run('plugins.enable', ['Rapier 3D', on])
        if (on) await load()
        return {
          solver: on ? 'Rapier 3D' : REPLACES,
          wrote: 'game.json',
          // Turning this off takes this command with it, because a disabled
          // plugin contributes nothing. The way back is the general verb.
          ...(on ? {} : { back: `run plugins.enable '["Rapier 3D", true]'` })
        }
      }
    },
    {
      id: 'rapier3d.bodies',
      label: 'What Rapier 3D is simulating',
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
            at: [round(entity.x), round(entity.y), round(entity.z)],
            velocity: [round(speed.x), round(speed.y), round(speed.z)],
            grounded: entity.grounded === true,
            asleep: entry.body.isSleeping()
          })
        }
        return { bodies, against: bridge.stats() }
      }
    },
    {
      id: 'rapier3d.snapshot',
      label: 'Hash the simulated world, to prove two runs match',
      /**
       * The hash, not the bytes: a snapshot is hundreds of kilobytes and the
       * only question anyone asks of it is whether two of them agree.
       */
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
    },
    {
      id: 'rapier3d.raycast',
      label: 'Cast a ray and say what it hit',
      // run rapier3d.raycast '[[0,1.6,0],[0,0,-1],40]'
      run(context, argument) {
        const [origin, direction, maxDistance] = Array.isArray(argument)
          ? argument
          : [argument?.from, argument?.direction, argument?.maxDistance]
        const point = typeof origin === 'string' ? context.world.byId(origin) : origin
        const hit = raycast(context, point, direction, maxDistance, { ignore: origin })
        return hit
          ? { hit: hit.entity?.id, type: hit.entity?.type, distance: round(hit.distance), point: hit.point, normal: hit.normal }
          : null
      }
    }
  ]
}
