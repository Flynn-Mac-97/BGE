/**
 * Physics, as a plugin — which is the point. Swap this for Rapier or Box2D by
 * disabling it and enabling something else; the collision contract is the only
 * thing that has to match.
 *
 * Runs on the fixed step, so `onCollide` fires deterministically and game code
 * never has to learn what a fixed step is.
 */
const GRAVITY = -22

/**
 * A collider box with three numbers says the entity lives in the 3D world, and
 * Physics 3D claims exactly those. Two plugins, disjoint sets of entities,
 * nothing to configure — the shape of the collider decides which one owns it.
 */
const flat = entity => entity.collider?.box?.length !== 3

const shape = e => {
  if (e.collider?.circle) return { kind: 'circle', r: e.collider.circle * (e.scale ?? 1) }
  const box = e.collider?.box || [1, 1]
  const s = e.scale ?? 1
  return { kind: 'box', w: box[0] * s, h: box[1] * s }
}

function overlap(a, b) {
  const sa = shape(a), sb = shape(b)
  if (sa.kind === 'circle' && sb.kind === 'circle')
    return Math.hypot(a.x - b.x, a.y - b.y) < sa.r + sb.r

  // circle/box and box/box both reduce to an AABB test at this fidelity
  const aw = sa.kind === 'circle' ? sa.r * 2 : sa.w
  const ah = sa.kind === 'circle' ? sa.r * 2 : sa.h
  const bw = sb.kind === 'circle' ? sb.r * 2 : sb.w
  const bh = sb.kind === 'circle' ? sb.r * 2 : sb.h
  return Math.abs(a.x - b.x) < (aw + bw) / 2 && Math.abs(a.y - b.y) < (ah + bh) / 2
}

/**
 * Push `e` out of `solid` along the shallowest axis, and report which side of
 * the solid `e` ended up on — 'above' means e is on top, which is what being
 * grounded means.
 */
function resolve(e, solid) {
  const se = shape(e), ss = shape(solid)
  const ew = se.kind === 'circle' ? se.r * 2 : se.w
  const eh = se.kind === 'circle' ? se.r * 2 : se.h
  const sw = ss.kind === 'circle' ? ss.r * 2 : ss.w
  const sh = ss.kind === 'circle' ? ss.r * 2 : ss.h

  const dx = e.x - solid.x, dy = e.y - solid.y
  const px = (ew + sw) / 2 - Math.abs(dx)
  const py = (eh + sh) / 2 - Math.abs(dy)
  if (px <= 0 || py <= 0) return null

  if (px < py) { e.x += dx > 0 ? px : -px; e.velocityX = 0; return dx > 0 ? 'right' : 'left' }
  e.y += dy > 0 ? py : -py
  e.velocityY = 0
  return dy > 0 ? 'above' : 'below'
}

export default {
  name: 'Physics 2D',

  category: 'engine',
  systems: [{
    phase: 'fixed',
    run(world, seconds, context) {
      const bodies = world.entities.filter(e => flat(e) && e.properties?.body === 'dynamic')
      const solids = world.entities.filter(e => flat(e) && e.properties?.body === 'solid')
      const colliders = world.entities.filter(e => e.collider && flat(e))

      for (const e of bodies) {
        e.velocityX = e.velocityX ?? 0
        e.velocityY = (e.velocityY ?? 0) + (e.properties.gravity ?? GRAVITY) * seconds
        e.x += e.velocityX * seconds
        e.y += e.velocityY * seconds
        e.grounded = false

        for (const s of solids) {
          if (!overlap(e, s)) continue
          if (resolve(e, s) === 'above') e.grounded = true
        }
      }

      // report contacts once, on the frame they begin
      const seen = new Set()
      for (let i = 0; i < colliders.length; i++) {
        for (let j = i + 1; j < colliders.length; j++) {
          const a = colliders[i], b = colliders[j]
          if (a.properties?.body === 'solid' && b.properties?.body === 'solid') continue
          if (!overlap(a, b)) continue
          const key = a.id + '|' + b.id
          seen.add(key)
          if (world._contacts?.has(key)) continue
          // Through world.hook, so a behaviour can answer a collision too — a
          // `breakable` should not have to be written into every type that
          // wants it.
          world.hook(a, 'onCollide', b, context)
          world.hook(b, 'onCollide', a, context)
        }
      }
      world._contacts = seen
    }
  }],

  commands: [{
    id: 'physics.gravity',
    label: 'Set world gravity for every 2D entity',
    /**
     * The three system filters above skip 3D entities, and this has to skip them
     * too or the disjoint-domains claim is only true of the simulation and not
     * of the plugin. Writing `properties.gravity` on every entity in the world
     * meant `physics.gravity` quietly reset the gravity of a 3D map that
     * Physics 3D owns — under a name that says 2D nowhere.
     *
     * A gravity that is not a number is refused rather than written: it would
     * become a NaN velocity on the first step, and a body with one stops being
     * simulated at all.
     */
    run(context, g) {
      const gravity = Number(g)
      if (!Number.isFinite(gravity)) {
        throw new Error(`[physics-2d] gravity must be a number of metres per second per second — "${g}" is not one. Nothing was changed.`)
      }
      let changed = 0
      let skipped = 0
      for (const e of context.world.entities) {
        if (!e.properties) continue
        if (!flat(e)) { skipped++; continue }
        e.properties.gravity = gravity
        changed++
      }
      return {
        gravity,
        changed,
        skipped,
        note: skipped
          ? `${skipped} ${skipped === 1 ? 'entity has' : 'entities have'} a three-number collider box, so ${skipped === 1 ? 'it belongs' : 'they belong'} to Physics 3D and ${skipped === 1 ? 'was' : 'were'} left alone`
          : 'every entity with a collider in this world is flat, so all of them were set'
      }
    }
  }]
}
