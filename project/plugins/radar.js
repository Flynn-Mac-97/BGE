/**
 * Radar — the 1.6 radar, top left, derived from the map rather than painted.
 *
 * A dark rounded square with the shape of the level in it, your team as
 * coloured dots with a facing tick, the bomb as its own marker, and enemies
 * shown ONLY while somebody on your team can actually see them. It rotates so
 * that up is the way you are facing.
 *
 * ---------------------------------------------------------------------------
 * Three decisions worth stating, because each of them is the reason this is a
 * plugin rather than a picture.
 *
 * 1. THE OUTLINE COMES FROM THE GEOMETRY. Shipping a radar image means the
 *    radar is wrong the first time somebody moves a wall, and wrong silently.
 *    This reads every solid box in the level once per level load, keeps its
 *    footprint, and draws the ones that are obstacles AT YOUR HEIGHT — so
 *    standing in the tunnels does not show you the walls of the courtyard
 *    above. That is also what 1.6 did, and it is why its radar was readable.
 *
 * 2. IT ROTATES WITH YOU. Up is where you are pointing. A north-up radar makes
 *    you translate a compass bearing into "left or right" every time you glance
 *    at it; a rotating one is read without thinking, which is the only way a
 *    radar survives contact with a firefight.
 *
 * 3. ENEMIES ARE EARNED. An enemy dot appears when a living team mate has a
 *    clear line to them and is looking that way — one `context.raycast` per
 *    pair, ten times a second rather than sixty, because a radar that lags a
 *    tenth of a second is indistinguishable from one that does not and it costs
 *    a sixth as much.
 *
 * The dots are worked out in the FIXED system and drawn in the FRAME one, so
 * "how many enemies can we see" is a question a headless test can ask.
 */

/**
 * The live radar, for a test to read — the same singleton-module handle
 * `plugins/builtin/camera.js` exposes, and for the same reason: a test file is
 * handed the `test` object and nothing else.
 */
let running = null
export const runningRadar = () => running

const TERRORIST = 'terrorist'
const COUNTER_TERRORIST = 'counter-terrorist'

const COLOUR = {
  frame: 'rgba(150,170,190,0.35)',
  back: 'rgba(6,10,14,0.62)',
  floor: 'rgba(120,140,160,0.20)',
  low: 'rgba(150,168,186,0.32)',
  wall: 'rgba(196,210,226,0.52)',
  you: '#ffffff',
  terrorist: '#e0a03c',
  counterTerrorist: '#6ea8e0',
  enemy: '#ff4438',
  bomb: '#ffd24a'
}

/** How far the radar sees, in metres. About a third of de_dust2 across. */
const RANGE = 45

/** How far a player is credited with seeing, and how wide their attention is. */
const SIGHT = 45
const SIGHT_CONE = Math.cos(75 * Math.PI / 180)

/** Ten times a second. Any faster and the rays cost more than the radar is worth. */
const REFRESH = 0.1

/** An obstacle counts as one when its top is above your knees and its foot below your head. */
const KNEE = 0.6
const CHEST = 1.4
const HEAD = 2.2

/** Where the eyes are, for the line-of-sight ray. Counter-Strike's standing eye. */
const EYE = 1.62
const CHEST_HEIGHT = 1.1

export default {
  name: 'Radar',
  // Ordering only; both are guarded where they are used, because a radar that
  // vanishes when the physics plugin is switched off is worse than one that
  // simply stops showing enemies.
  needs: ['Game Camera', 'Physics 3D'],

  onLoad(context) {
    const radar = fresh()
    running = { radar, context }

    // The outline belongs to the map, so a new map means a new outline. Keeping
    // the old one would draw the last level's walls over this one.
    context.bus.on('level:loaded', () => {
      const kept = radar.reported
      Object.assign(radar, fresh())
      radar.reported = kept
    })
  },

  systems: [
    {
      phase: 'fixed',
      run(world, seconds, context) {
        const radar = running?.radar
        if (radar) look(radar, world, context)
      }
    },
    {
      phase: 'frame',
      run(world, seconds, context) {
        const radar = running?.radar
        if (!radar?.active) return
        if (!context.loop.running && !context.hud?.always) return
        const layer = ensureLayer(radar, context)
        if (layer) paint(layer, radar, context)
      }
    }
  ],

  commands: [{
    id: 'radar.read',
    label: 'What the radar can see',
    run: () => {
      const radar = running?.radar
      if (!radar) return { error: 'the Radar plugin has not loaded' }
      // The radar is worked out on the fixed step, so a world that has not been
      // stepped has nothing to report yet. Say which of the two it is.
      if (radar.shapes === null) {
        return { active: false, why: 'the world has not been stepped yet — simulate at least one step' }
      }
      return {
        active: radar.active,
        counterStrikeLevel: radar.counterStrikeLevel,
        shapes: radar.shapes.length,
        dots: radar.dots.length,
        enemies: radar.dots.filter(dot => dot.kind === 'enemy').length,
        bomb: radar.dots.some(dot => dot.kind === 'bomb'),
        list: radar.dots.map(dot => `${dot.kind} ${dot.id} at ${round(dot.x)},${round(dot.z)}`)
      }
    }
  }]
}

function fresh() {
  return {
    active: false,
    counterStrikeLevel: false,
    shapes: null,      // null until the level has been read once
    dots: [],
    you: null,
    nextLookAt: 0,
    reported: new Set(),
    layer: null
  }
}

// ------------------------------------------------------------------ thinking
function look(radar, world, context) {
  if (radar.shapes === null) {
    radar.shapes = readTheMap(world)
    // A radar belongs to a Counter-Strike map, and a map says it is one by
    // having bomb sites and team spawns in it. Derived rather than declared, so
    // this cannot appear over a level that has nothing to do with the game and
    // cannot fail to appear over a map somebody adds tomorrow.
    radar.counterStrikeLevel = world.all('bomb-site').length > 0 &&
      world.all('spawn-point').some(entity => !!entity.properties?.team)
  }

  // The camera's target is whose radar this is: whatever the level said to
  // follow is by definition the body you are looking out of. `you` is the id
  // de_dust2 gives that body, and `player-controlled` is the behaviour that
  // makes a body yours.
  const you = context.camera?.target ||
    world.byId('you') ||
    world.entities.find(entity => !!entity['player-controlled']) ||
    null
  radar.you = you || null
  radar.active = !!(you && radar.counterStrikeLevel && radar.shapes.length)
  if (!radar.active) return

  // Everything except the enemy rays is cheap and wants to be current: your own
  // dot has to move every step or the radar visibly stutters.
  if (context.time >= radar.nextLookAt) {
    radar.nextLookAt = context.time + REFRESH
    radar.dots = findEveryone(radar, world, you, context)
  } else {
    for (const dot of radar.dots) {
      const entity = world.byId(dot.id)
      if (!entity) continue
      dot.x = entity.x
      dot.z = entity.z
      dot.yaw = facingOf(entity, you, context)
    }
  }

  const state = world.state
  state.radarDots = radar.dots.length
  state.radarEnemies = radar.dots.filter(dot => dot.kind === 'enemy').length
  state.radarBomb = radar.dots.some(dot => dot.kind === 'bomb') ? 1 : 0
}

/**
 * Every solid box in the level, as a footprint and the two heights that decide
 * whether it is a floor, a crate or a wall.
 *
 * Read once. A level has a few hundred boxes and this walks all of them; doing
 * it per frame would be the most expensive thing on screen by a wide margin.
 */
function readTheMap(world) {
  const shapes = []
  for (const entity of world.entities) {
    if (entity.properties?.body !== 'solid') continue
    const box = entity.mesh?.box || entity.collider?.box
    if (!Array.isArray(box) || box.length < 3) continue

    const scale = Number.isFinite(entity.scale) ? entity.scale : 1
    const height = box[1] * scale
    shapes.push({
      x: entity.x,
      z: entity.z,
      width: box[0] * scale,
      depth: box[2] * scale,
      top: entity.y + height / 2,
      bottom: entity.y - height / 2
    })
  }
  return shapes
}

/**
 * Who is on the radar: you, your team, the bomb, and the enemies somebody can
 * see. An entity is a combatant when it carries the damage lane's bag or is a
 * player — a plain field read, which is the only way one lane may ask about
 * another.
 */
function findEveryone(radar, world, you, context) {
  const yourTeam = teamOf(you)
  const dots = []
  const friends = []
  const enemies = []

  for (const entity of world.entities) {
    if (!isCombatant(entity)) continue
    if (entity.damageable && entity.damageable.alive === false) continue
    const team = teamOf(entity)
    if (entity === you || !yourTeam || team === yourTeam) friends.push(entity)
    else enemies.push(entity)
  }

  for (const friend of friends) {
    dots.push({
      kind: friend === you ? 'you' : 'friend',
      id: friend.id,
      team: teamOf(friend) || yourTeam,
      x: friend.x,
      z: friend.z,
      yaw: facingOf(friend, you, context),
      carryingBomb: !!carryOf(friend)?.bomb || friend.hasBomb === true
    })
  }

  for (const enemy of enemies) {
    if (!friends.some(friend => canSee(radar, friend, enemy, you, context))) continue
    dots.push({
      kind: 'enemy',
      id: enemy.id,
      team: teamOf(enemy),
      x: enemy.x,
      z: enemy.z,
      yaw: facingOf(enemy, you, context)
    })
  }

  const bomb = bombMarker(world, context)
  if (bomb) dots.push({ kind: 'bomb', id: bomb.id, team: null, x: bomb.x, z: bomb.z, yaw: null })

  return dots
}

/**
 * Where the bomb is, and everyone may see it.
 *
 * The dropped or planted C4 is a real entity, so it is found the same way
 * anything else is. Failing that, a planted bomb the match lane has named a
 * site for marks the site itself: a counter-terrorist who knows the round is
 * lost at A but cannot see which corner is exactly the player 1.6 was drawing
 * this for.
 */
function bombMarker(world, context) {
  const entity = world.entities.find(thing =>
    thing.properties?.bomb === true || thing.type === 'c4' || thing.type === 'bomb')
  if (entity) return entity

  const state = context.match?.state
  if (!state || !(state.bombPlantedAt > 0) || !state.bombSite) return null
  return world.all('bomb-site').find(site => site.properties?.site === state.bombSite) || null
}

/**
 * Does this one have eyes on that one?
 *
 * Range, then a generous cone when the viewer's facing is known, then one ray.
 * The cone is skipped rather than guessed when nothing has written a facing:
 * reporting an enemy a team mate has their back to is a smaller lie than
 * hiding one because this plugin assumed the wrong convention.
 */
function canSee(radar, viewer, target, you, context) {
  const dx = target.x - viewer.x
  const dz = target.z - viewer.z
  const flat = Math.hypot(dx, dz)
  if (flat > SIGHT) return false
  if (flat < 0.001) return true

  // Through facingOf, not knownFacing: you are a viewer too, and the way *you*
  // are looking is the view, not a field on your body.
  const yaw = facingOf(viewer, you, context)
  if (yaw !== null) {
    // The camera's convention, stated once in plugins/builtin/camera.js: yaw 0
    // faces -Z and positive yaw turns left.
    const facingX = -Math.sin(yaw)
    const facingZ = -Math.cos(yaw)
    if ((dx / flat) * facingX + (dz / flat) * facingZ < SIGHT_CONE) return false
  }

  const raycast = context.raycast
  if (!raycast) {
    once(radar, 'no-raycast', 'there is no context.raycast, so line of sight cannot be tested and every enemy in range is shown. Check that Physics 3D loaded.')
    return true
  }

  const from = { x: viewer.x, y: viewer.y + EYE - halfHeight(viewer), z: viewer.z }
  const to = { x: target.x, y: target.y + CHEST_HEIGHT - halfHeight(target), z: target.z }
  const along = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
  const distance = Math.hypot(along.x, along.y, along.z)
  if (distance < 0.001) return true

  const hit = safely(radar, 'raycast', () => raycast(
    from,
    { x: along.x / distance, y: along.y / distance, z: along.z / distance },
    distance,
    { ignore: [viewer] }
  ))
  // Nothing in the way, or the thing in the way is the target.
  return !hit || hit.entity === target || hit.distance >= distance - 0.05
}

/**
 * Which way this one is looking, in radians, or null when nobody has said.
 *
 * Three plain fields, in the order the movement lane documents them.
 * `player-controlled` writes `aimYaw`; `bot-brain` writes `yaw` and mirrors it
 * into `rotation` in degrees; and `rotation` alone is what a placement means by
 * "the way this faces" — `types/spawn-point.js` says so. None of them is asked
 * for: each is read, which is the only way one lane may learn about another.
 */
function knownFacing(entity) {
  if (Number.isFinite(entity.aimYaw)) return entity.aimYaw
  if (Number.isFinite(entity.yaw)) return entity.yaw
  if (Number.isFinite(entity.rotation) && entity.rotation !== 0) return entity.rotation * Math.PI / 180
  return null
}

/** The same, but the local player's facing is the view itself. */
function facingOf(entity, you, context) {
  if (entity === you && context.view) return context.view.yaw || 0
  return knownFacing(entity)
}

// ------------------------------------------------------------------ the layer
function ensureLayer(radar, context) {
  if (typeof document === 'undefined') return null

  const existing = radar.layer
  if (existing && document.contains(existing.canvas)) return existing

  const host = context.shell?.viewport
  if (!host) {
    once(radar, 'no-viewport', 'there is no viewport to attach the radar canvas to, so nothing is drawn. "radar.read" still answers.')
    return null
  }

  const canvas = existing?.canvas || document.createElement('canvas')
  // Its own canvas, not the HUD's. Two plugins drawing into one element is a
  // shared-mutable-DOM bug waiting to happen, and this one is redrawn on a
  // different schedule anyway.
  canvas.className = 'radar-layer'
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
  host.prepend(canvas)
  const under = host.querySelector('.counter-strike-hud-layer') ||
    host.querySelector('.hud-layer') ||
    host.querySelector('#gl')
  if (under) under.after(canvas)

  const layer = { canvas, g: canvas.getContext('2d') }
  radar.layer = layer
  return layer
}

// ------------------------------------------------------------------- drawing
function paint(layer, radar, context) {
  const { canvas, g } = layer
  const ratio = Math.min(devicePixelRatio || 1, 2)
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (!width || !height) return
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio
    canvas.height = height * ratio
  }
  g.setTransform(ratio, 0, 0, ratio, 0, 0)
  g.clearRect(0, 0, width, height)

  const unit = clamp(height / 720, 0.7, 2)
  const size = 190 * unit
  const left = 16 * unit
  const top = 16 * unit
  const centreX = left + size / 2
  const centreY = top + size / 2
  const scale = (size / 2) / RANGE
  const you = radar.you
  const yaw = context.view?.yaw || 0
  const feet = you.y - halfHeight(you)

  g.save()
  roundedRectangle(g, left, top, size, size, 10 * unit)
  g.fillStyle = COLOUR.back
  g.fill()
  g.clip()

  drawMap(g, radar, { centreX, centreY, scale, yaw, you, feet })
  drawDots(g, radar, { centreX, centreY, scale, yaw, you, unit, size })
  g.restore()

  roundedRectangle(g, left, top, size, size, 10 * unit)
  g.strokeStyle = COLOUR.frame
  g.lineWidth = Math.max(1, unit)
  g.stroke()
}

/**
 * The map, drawn in world coordinates through one transform.
 *
 * Rotating the canvas rather than every corner means the shapes stay plain
 * `fillRect` calls in metres — which is also why the level's own numbers can be
 * used unchanged. The transform maps a world offset (dx, dz) to (dx·cos − dz·sin,
 * dx·sin + dz·cos), which puts the direction you are facing at the top.
 */
function drawMap(g, radar, frame) {
  const { centreX, centreY, scale, yaw, you, feet } = frame
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)

  g.save()
  g.translate(centreX, centreY)
  g.transform(cos * scale, sin * scale, -sin * scale, cos * scale, 0, 0)
  g.translate(-you.x, -you.z)

  const floors = []
  const lows = []
  const walls = []
  for (const shape of radar.shapes) {
    if (Math.abs(shape.x - you.x) > RANGE + shape.width) continue
    if (Math.abs(shape.z - you.z) > RANGE + shape.depth) continue
    const above = shape.top - feet
    if (above < -0.6) continue                       // below the floor you stand on
    if (shape.bottom - feet > HEAD) continue         // a ceiling, not a wall
    if (above <= KNEE) floors.push(shape)
    else if (above <= CHEST) lows.push(shape)
    else walls.push(shape)
  }

  for (const [list, colour] of [[floors, COLOUR.floor], [lows, COLOUR.low], [walls, COLOUR.wall]]) {
    g.fillStyle = colour
    for (const shape of list) {
      g.fillRect(shape.x - shape.width / 2, shape.z - shape.depth / 2, shape.width, shape.depth)
    }
  }
  g.restore()
}

/**
 * The dots, in screen space rather than through the transform, so a dot is the
 * same size however far the radar is zoomed and a facing tick does not shear.
 */
function drawDots(g, radar, frame) {
  const { centreX, centreY, scale, yaw, you, unit, size } = frame
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const edge = size / 2 - 6 * unit

  for (const dot of radar.dots) {
    const dx = dot.x - you.x
    const dz = dot.z - you.z
    let x = dx * cos - dz * sin
    let z = dx * sin + dz * cos
    let px = x * scale
    let py = z * scale

    // A team mate off the edge is clamped to the rim rather than dropped, the
    // way 1.6 did it — "somebody is over there, a long way" is worth knowing.
    const reach = Math.hypot(px, py)
    const clamped = reach > edge
    if (clamped && reach > 0) {
      px = (px / reach) * edge
      py = (py / reach) * edge
    }

    const screenX = centreX + px
    const screenY = centreY + py
    const radius = (dot.kind === 'you' ? 4 : 3.6) * unit

    if (dot.kind === 'bomb') {
      drawBomb(g, screenX, screenY, 5 * unit)
      continue
    }

    g.fillStyle = dot.kind === 'enemy' ? COLOUR.enemy
      : dot.kind === 'you' ? COLOUR.you
        : teamColour(dot.team)
    g.globalAlpha = clamped ? 0.55 : 1
    g.beginPath()
    g.arc(screenX, screenY, radius, 0, Math.PI * 2)
    g.fill()

    // The facing tick: which way that dot is looking. Yours points straight up
    // by construction, which is the whole point of a rotating radar.
    const facing = dot.kind === 'you' ? 0 : (dot.yaw === null ? null : dot.yaw - yaw)
    if (facing !== null) {
      const tipX = screenX - Math.sin(facing) * radius * 2.6
      const tipY = screenY - Math.cos(facing) * radius * 2.6
      g.strokeStyle = g.fillStyle
      g.lineWidth = Math.max(1, 1.6 * unit)
      g.beginPath()
      g.moveTo(screenX, screenY)
      g.lineTo(tipX, tipY)
      g.stroke()
    }

    // The one carrying the C4 wears a ring, so you can cover them without
    // asking.
    if (dot.carryingBomb) {
      g.strokeStyle = COLOUR.bomb
      g.lineWidth = Math.max(1, 1.4 * unit)
      g.beginPath()
      g.arc(screenX, screenY, radius + 3 * unit, 0, Math.PI * 2)
      g.stroke()
    }
    g.globalAlpha = 1
  }
}

/** The planted bomb: a diamond, so it is not another round dot in a hurry. */
function drawBomb(g, x, y, size) {
  g.fillStyle = COLOUR.bomb
  g.beginPath()
  g.moveTo(x, y - size)
  g.lineTo(x + size, y)
  g.lineTo(x, y + size)
  g.lineTo(x - size, y)
  g.closePath()
  g.fill()
}

// ------------------------------------------------------------------ helpers
/** Types that are people even before the damage lane has given them a bag. */
const COMBATANT_TYPES = new Set(['player', 'bot', 'terrorist', 'counter-terrorist'])

/**
 * The engine files a behaviour's bag under its file name, so the carrying bag
 * is really `entity['carries-weapons']`; the contract every lane was handed
 * says `entity.carriesWeapons`. Read either.
 */
const carryOf = entity => entity?.carriesWeapons || entity?.['carries-weapons'] || null

const isCombatant = entity =>
  !!entity && (!!entity.damageable || !!carryOf(entity) || COMBATANT_TYPES.has(entity.type))

const teamOf = entity => entity?.properties?.team || entity?.damageable?.team || null

const teamColour = team =>
  team === TERRORIST ? COLOUR.terrorist
    : team === COUNTER_TERRORIST ? COLOUR.counterTerrorist
      : COLOUR.you

/** Half a body, so a ray can start at the eye and end at the chest. */
const halfHeight = entity => {
  const box = entity.collider?.box
  return Array.isArray(box) && box.length >= 2 ? box[1] / 2 : 0.915
}

function safely(radar, key, read) {
  try {
    return read()
  } catch (e) {
    once(radar, key, `${key} threw (${e?.message || e}) — the radar is falling back to showing less`)
    return undefined
  }
}

function once(radar, key, message) {
  if (radar.reported.has(key)) return
  radar.reported.add(key)
  console.error(`[radar] ${message}`)
}

function roundedRectangle(g, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + width, y, x + width, y + height, r)
  g.arcTo(x + width, y + height, x, y + height, r)
  g.arcTo(x, y + height, x, y, r)
  g.arcTo(x, y, x + width, y, r)
  g.closePath()
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
const round = value => Math.round(value * 100) / 100
