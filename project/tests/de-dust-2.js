/**
 * de_dust2 — the checks a map cannot get from being read.
 *
 * Almost everything that is wrong with a level is invisible in a text editor and
 * invisible in a screenshot: a floor rectangle nobody laid, two walls a fifth of
 * a metre inside each other, a spawn buried in a doorframe. Every one of those is
 * a bug you would otherwise find by walking the whole map, which is the one thing
 * nobody is going to do again after the day it was built. So they are asserted.
 *
 * The floor probes are the ones that matter most. A hole in the ground and a
 * floor look identical in a level file and identical from six metres away; the
 * only thing that can tell them apart is dropping something on it.
 */

/** Half the size of an entity's collider box, on each axis, at its scale. */
const halfBox = entity => {
  const scale = entity.scale ?? 1
  return entity.collider.box.map(side => (side * scale) / 2)
}

/**
 * How far two boxes are inside each other, in metres, along the axis they share
 * least. Zero or less means they only touch — which is what every wall standing
 * on a floor does, and is not a fault.
 */
const interpenetration = (a, b) => {
  const [ax, ay, az] = halfBox(a)
  const [bx, by, bz] = halfBox(b)
  return Math.min(
    ax + bx - Math.abs(a.x - b.x),
    ay + by - Math.abs(a.y - b.y),
    az + bz - Math.abs(a.z - b.z)
  )
}

/** A standing player, as a box, centred where a spawn point puts one. */
const bodyAt = entity => ({
  x: entity.x, y: entity.y, z: entity.z,
  scale: 1,
  collider: { box: [0.6, 1.8, 0.6] }
})

// A centimetre of this is a rounding error in a level file. Five is a mistake.
const TOLERANCE = 0.05

// The probe: a body the width of a player and short enough to fit on a stair
// tread and under a tunnel ceiling. It is dropped 1.2 m, which is far enough to
// be certain it fell rather than started where it finished.
const PROBE = [0.8, 1.2, 0.8]
const REST = PROBE[1] / 2
const DROP = 1.8

/**
 * One point in every area of the map, and the height of the ground under it.
 *
 * Between them these say the map is one continuous surface: each named place is
 * somewhere a body can stand, at the height the level meant it to be. Stair
 * flights are not probed directly — their treads are half a metre and a probe
 * would straddle three of them — but every flight has an area at each end, and
 * both ends are here.
 */
const GROUND = [
  ['T spawn', 40, -10, 0],
  ['long doors', 31.5, -16, 0],
  ['long A', 17, -18, 0],
  ['the pit', 16.8, -28.5, -1.5],
  ['A site', 0, -22, 1.3],
  ['A site, back', -5, -32, 1.3],
  ['A ramp, halfway up', -8, -12, 0.78],
  ['A ramp, foot', -8, -7, 0],
  ['catwalk', 6.5, -9, 2.0],
  ['upper mid, north end', 15, -9, 0],
  ['upper mid', 13, 0, 0],
  ['lower mid', 13, 10, 0],
  ['CT mid', 0, 1.5, 0],
  ['CT spawn', -15, 5, 0],
  ['T ramp', 25, 5, 0],
  ['outside T spawn', 35, 16, 0],
  ['outside tunnels', 25, 31, 0],
  ['upper tunnels', 8, 33, 0],
  ['the tunnel between them', -3.5, 33, 0],
  ['lower tunnels', -14, 32, 0],
  ['B doors', -17, 12, 0],
  ['B site', -18, 24, 0],
  ['B back plat', -27.5, 20, 1.3],
  ['the cubby', -10, 20, 0]
]

export default {
  name: 'de_dust2 loads, has its ten spawns, and is a surface you can stand on',
  level: 'de_dust2',

  run(test) {
    const placed = [...test.entities]
    test.ok(placed.length > 200, `the level loaded — ${placed.length} entities`)

    // ---------------------------------------------------------------- 1. types
    // An entity whose type file is missing still spawns: the world hands it an
    // empty definition and it sits there with no mesh, no collider and nothing
    // to say. Among hundreds of brushes that is invisible, so count them.
    const unknown = placed.filter(entity => Object.keys(entity._definition || {}).length === 0)
    test.is(unknown.length, 0, unknown.length
      ? `every placement names a type that exists — but ${[...new Set(unknown.map(e => e.type))].join(', ')} do not`
      : 'every placement names a type that exists')

    // A brush you can see through but not walk through, or the other way round,
    // is the hardest kind of map bug to describe to anybody.
    const mismatched = placed.filter(entity =>
      entity.mesh?.box && entity.collider?.box &&
      String(entity.mesh.box) !== String(entity.collider.box))
    test.is(mismatched.length, 0, 'what a brush draws is the size of what it hits')

    // --------------------------------------------------------------- 2. spawns
    const spawns = placed.filter(entity => entity.type === 'spawn-point')
    const team = name => spawns.filter(entity => entity.properties.team === name)
    test.is(team('terrorist').length, 5, 'five terrorist spawns')
    test.is(team('counter-terrorist').length, 5, 'five counter-terrorist spawns')
    test.is(spawns.length, 10, 'and none belonging to neither side')

    const solids = placed.filter(entity =>
      entity.properties?.body === 'solid' && entity.collider?.box?.length === 3)
    test.ok(solids.length > 150, `the map is ${solids.length} solid brushes`)

    let buried = null
    for (const spawn of spawns) {
      const body = bodyAt(spawn)
      for (const solid of solids) {
        const deep = interpenetration(body, solid)
        if (deep > TOLERANCE && (!buried || deep > buried.deep)) buried = { spawn, solid, deep }
      }
    }
    test.ok(!buried, buried
      ? `no spawn stands inside a wall — but ${buried.spawn.id} is ${buried.deep.toFixed(2)} m inside ${buried.solid.id}`
      : 'no spawn stands inside a wall')

    // ---------------------------------------------------------- 4. bomb sites
    const sites = placed.filter(entity => entity.type === 'bomb-site')
    test.is(sites.length, 2, 'two bomb sites')
    test.is(sites.filter(entity => entity.properties.site === 'A').length, 1, 'one of them is A')
    test.is(sites.filter(entity => entity.properties.site === 'B').length, 1, 'the other is B')
    test.ok(sites.every(entity => entity.properties.body === 'trigger'),
      'both are triggers, so nobody walks into the plant zone')

    // ------------------------------------------------------------- 5. overlaps
    // Two solids deep inside each other is how a map ends up with an invisible
    // wall in the middle of an open yard: the resolver pushes you out of one and
    // straight back into the other, and there is nothing to see.
    let worst = null
    for (let i = 0; i < solids.length; i++) {
      for (let j = i + 1; j < solids.length; j++) {
        const deep = interpenetration(solids[i], solids[j])
        if (deep > TOLERANCE && (!worst || deep > worst.deep)) {
          worst = { a: solids[i], b: solids[j], deep }
        }
      }
    }
    test.ok(!worst, worst
      ? `no two solid brushes interpenetrate — but ${worst.a.id} and ${worst.b.id} share ${worst.deep.toFixed(2)} m`
      : 'no two solid brushes interpenetrate')

    // ------------------------------------------------------------ 3. the floor
    // Drop something at every spawn and in every area, all at once — they are
    // metres apart, so one simulate answers for all of them and the test stays
    // cheap enough that nobody is tempted to delete it.
    const drops = [
      ...spawns.map(spawn => ({ where: spawn.id, x: spawn.x, z: spawn.z, ground: 0 })),
      ...GROUND.map(([where, x, z, ground]) => ({ where, x, z, ground }))
    ]

    const probes = drops.map(drop => test.spawn('crate', {
      at: [drop.x, drop.ground + DROP, drop.z],
      mesh: { box: PROBE, tint: '#ff00ff' },
      collider: { box: PROBE },
      properties: { body: 'dynamic' }
    }))

    test.simulate(1.5)
    for (let i = 0; i < probes.length; i++) {
      test.near(probes[i].y, drops[i].ground + REST, 0.15,
        `a body dropped at ${drops[i].where} landed on the ground`)
    }

    // Landing is not resting: a body settling one step and sinking the next has
    // found a floor it is slowly going through.
    const landed = probes.map(probe => probe.y)
    test.simulate(0.5)
    for (let i = 0; i < probes.length; i++) {
      test.near(probes[i].y, landed[i], 0.01, `and stayed on it at ${drops[i].where}`)
    }
    test.ok(probes.every(probe => probe.grounded === true), 'every one of them reported ground contact')
  }
}
