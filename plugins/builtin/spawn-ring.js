/**
 * Spawn Ring — where "just off screen" is, in metres, right now.
 *
 * Anything that sends a crowd at a player needs the same answer: a point far
 * enough out that nobody watched it appear, near enough that it arrives while
 * it still matters. Get it wrong on the near side and things pop into being in
 * front of the player; get it wrong on the far side and the game is a wait.
 *
 * The number that decides it is not a game's to invent — it is how much ground
 * the camera is showing, which only the engine knows. So it is worked out here
 * from the view and the viewport, and a caller may override it with metres of
 * its own when it knows better.
 *
 *     context.spawnRing.visibleRadius()               how far the camera sees
 *     context.spawnRing.point(around, options)        one point on the ring
 *     context.spawnRing.cluster(around, count, opts)  several, on one bearing
 *     context.spawnRing.offScreen(x, z, around)       has this drifted out of sight
 *
 * `around` is an entity or a point. Options are `{ minimum, maximum, ahead,
 * spread }`, all in metres except `ahead`, which is how strongly the bearing is
 * pulled toward the way the target is travelling — 0 is an even ring, 1 puts
 * everything in the target's path.
 */

/** A ring this much beyond the visible radius, when the caller names no metres of its own. */
const NEAR_MARGIN = 1.15
const FAR_MARGIN = 1.5

/**
 * What the ortho estimate is multiplied by when the camera is a perspective one.
 *
 * A perspective camera looking down at the ground shows more of it than an
 * orthographic camera of the same zoom, and how much more depends on the eye
 * height and the pitch — neither of which the view carries when a game camera
 * is only following in two dimensions. Erring large is the safe direction: too
 * far out is a slightly longer walk, too near is a monster appearing on screen.
 */
const PERSPECTIVE_MARGIN = 1.6

const TAU = Math.PI * 2

/** An entity, a point, or an array of three numbers — whichever the caller had. */
function asPoint(value) {
  if (Array.isArray(value)) return { x: +value[0], y: +value[1], z: +value[2] }
  if (value && typeof value === 'object' && Number.isFinite(value.x)) {
    return { x: value.x, y: value.y ?? 0, z: value.z ?? 0 }
  }
  return null
}

export default {
  name: 'Spawn Ring',

  category: 'game',
  onLoad(context) {
    if (context.spawnRing) {
      console.error('[spawn-ring] something else already put a spawnRing on context — replacing it')
    }

    /**
     * The distance from the middle of the screen to a corner of it, on the
     * ground.
     *
     * Orthographic is exact: the viewport is a rectangle of pixels and zoom is
     * pixels per metre, so the corner is one hypotenuse away. Everything else
     * is an estimate, said out loud in the guide, because a game camera that
     * only writes x and y gives this file nothing else to measure with.
     */
    function visibleRadius() {
      const view = context.view || {}
      const viewport = context.viewport || {}
      const zoom = Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 32
      const width = Number.isFinite(viewport.width) ? viewport.width : 1280
      const height = Number.isFinite(viewport.height) ? viewport.height : 720
      const flat = Math.hypot(width / 2 / zoom, height / 2 / zoom)
      return view.mode === 'ortho' || !view.mode ? flat : flat * PERSPECTIVE_MARGIN
    }

    function band(options = {}) {
      const seen = visibleRadius()
      const minimum = options.minimum ?? seen * NEAR_MARGIN
      const maximum = Math.max(minimum, options.maximum ?? seen * FAR_MARGIN)
      return { minimum, maximum }
    }

    /**
     * A bearing, pulled toward where the target is heading.
     *
     * An even ring is fair and reads as nothing in particular. Biasing toward
     * the direction of travel is what makes a horde feel like it is cutting the
     * player off rather than trailing behind — the player runs into the next
     * batch, which is the whole rhythm of the genre.
     */
    function bearing(target, ahead) {
      const even = context.random() * TAU
      if (!ahead) return even
      const velocityX = target?.velocityX ?? 0
      const velocityZ = target?.velocityZ ?? 0
      if (!velocityX && !velocityZ) return even
      const travelling = Math.atan2(velocityX, velocityZ)
      // Blended as an offset from the travel direction rather than as a lerp
      // between two angles, which would take the short way round the circle and
      // leave a gap the crowd never spawns in.
      const spread = (1 - Math.min(1, ahead)) * Math.PI
      return travelling + context.random.range(-spread, spread)
    }

    function place(around, angle, distance) {
      const at = asPoint(around) || { x: 0, y: 0, z: 0 }
      return {
        x: at.x + Math.sin(angle) * distance,
        y: at.y,
        z: at.z + Math.cos(angle) * distance
      }
    }

    context.spawnRing = {
      visibleRadius,

      /** One point on the ring around `around`. */
      point(around, options = {}) {
        const { minimum, maximum } = band(options)
        const angle = bearing(asPoint(around) ? around : null, options.ahead ?? 0)
        return place(around, angle, context.random.range(minimum, maximum))
      },

      /**
       * Several points on one bearing, so a flock arrives together from one
       * side instead of being sprinkled evenly round the player. A group that
       * arrives as a group is the only way a wave reads as a wave.
       */
      cluster(around, count, options = {}) {
        const { minimum, maximum } = band(options)
        const spread = options.spread ?? 0.35
        const centre = bearing(asPoint(around) ? around : null, options.ahead ?? 0)
        const out = []
        for (let i = 0; i < Math.max(0, count); i++) {
          out.push(place(
            around,
            centre + context.random.range(-spread, spread),
            context.random.range(minimum, maximum)
          ))
        }
        return out
      },

      /**
       * Has this point drifted out of sight of the target?
       *
       * The counterpart of spawning: a thing that wandered off the far side is
       * costing a frame budget nobody is watching, and the cheapest fix is to
       * take it away and send it back in from the front.
       */
      offScreen(x, z, around, options = {}) {
        const at = asPoint(around) || { x: 0, y: 0, z: 0 }
        const beyond = options.beyond ?? band(options).maximum * 1.6
        return Math.hypot(x - at.x, z - at.z) > beyond
      }
    }
  },

  commands: [{
    id: 'spawnRing.state',
    label: 'Camera reach, spawn sites',
    run(context) {
      if (!context.spawnRing) return { error: 'Spawn Ring did not load' }
      const seen = context.spawnRing.visibleRadius()
      return {
        mode: context.view?.mode ?? null,
        zoom: context.view?.zoom ?? null,
        viewport: [context.viewport?.width ?? null, context.viewport?.height ?? null],
        visibleRadius: round(seen),
        defaultRing: [round(seen * NEAR_MARGIN), round(seen * FAR_MARGIN)],
        exact: context.view?.mode === 'ortho' || !context.view?.mode,
        note: context.view?.mode === 'ortho' || !context.view?.mode
          ? 'orthographic, so this is the exact distance to a screen corner'
          : `a perspective camera shows more ground than its zoom implies — this is the flat estimate times ${PERSPECTIVE_MARGIN}. Pass your own minimum and maximum if you know the eye height.`
      }
    }
  }]
}

const round = n => Math.round(n * 1000) / 1000
