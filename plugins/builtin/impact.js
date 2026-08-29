/**
 * Impact — the punch: the frames a hit freezes on, and the shake that follows.
 *
 * A hit is three separate things happening at once, and every game gets them
 * from three different places: a flash on the victim, a number in the air, and
 * a jolt to the whole picture. This file owns the third, and it is the one that
 * cannot live on the victim — a screen freeze and a screen shake are properties
 * of the moment, not of the thing that was hit.
 *
 * Hit stop is the loop holding still for two or three fixed steps while the
 * frame keeps drawing. It is the oldest trick in the genre and still the most
 * effective: the eye reads a pause as weight. It is deliberately measured in
 * whole steps, because a fraction of a fixed step is not a fixed step and this
 * engine's determinism rests on every step being the same size.
 *
 * Everything here is one number, `weight`, from zero to one. A game says how
 * big a hit was; how many frames that is worth, how far the picture moves and
 * how loud it is are this file's business — so tuning the feel of a game is one
 * table in one place rather than three numbers at every call site.
 */

/** Weight one: the heaviest hit a game should ever ask for. */
const MOST_HOLD = 0.11      // seconds the world stops
const MOST_SHAKE = 0.45     // metres the camera wanders

/**
 * Below this, a hit is not worth freezing for.
 *
 * A survivor kills forty things a second. Freezing on every one of them is not
 * impact, it is a game running at half speed, and the fix is a floor rather
 * than asking every caller to remember.
 */
const WORTH_HOLDING = 0.34

/** Hits this second, so a crowd cannot freeze the game solid. See `budget`. */
const state = { held: 0, shaken: 0, hits: 0, spentAt: -1, spent: 0 }

/** Seconds of hold allowed per second of play. A third is generous and still safe. */
const BUDGET = 0.34

const asVector = value => {
  if (Array.isArray(value)) return { x: +value[0] || 0, y: +value[1] || 0, z: +value[2] || 0 }
  if (value && typeof value === 'object') return { x: +value.x || 0, y: +value.y || 0, z: +value.z || 0 }
  return null
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

export default {
  name: 'Impact',
  about: 'Hit stop and screen shake — the frames a heavy hit freezes on, and the jolt after it.',

  inspect: () => [{
    title: 'Impact',
    rows: [['hits', state.hits], ['held', `${round(state.held)}s`], ['shaken', round(state.shaken)]]
  }],

  onLoad(context) {
    /**
     * How much freezing this second still has left.
     *
     * Without this, a screen full of things dying at once asks for forty holds
     * and the game stops. The budget refills every second of engine time, so a
     * lone big hit gets its full pause and a massacre gets one.
     */
    function budget(wanted) {
      const second = Math.floor(context.time)
      if (second !== state.spentAt) { state.spentAt = second; state.spent = 0 }
      const left = Math.max(0, BUDGET - state.spent)
      const given = Math.min(wanted, left)
      state.spent += given
      return given
    }

    /**
     * One hit landed. Everything else here is a convenience over this.
     *
     * @param how  weight  0 to 1 — how big this was
     *             at      where, for a sound; the shake is screen-wide
     *             sound   a name for the audio plugin, if the game has one
     *             hold    seconds, to override the weight's own answer
     *             shake   metres, likewise
     */
    function hit(how = {}) {
      const weight = clamp(Number(how.weight ?? 0.4), 0, 1)
      state.hits++

      // Squared, not linear: the difference between a light hit and a medium
      // one should be small, and the difference between a medium one and a
      // killing blow should be everything.
      const curve = weight * weight

      const shake = Number.isFinite(Number(how.shake)) ? Number(how.shake) : MOST_SHAKE * curve
      if (shake > 0 && typeof context.camera?.shake === 'function') {
        context.camera.shake(shake)
        state.shaken = Math.max(state.shaken, shake)
      }

      const asked = Number.isFinite(Number(how.hold))
        ? Number(how.hold)
        : (weight >= WORTH_HOLDING ? MOST_HOLD * curve : 0)
      const given = asked > 0 ? budget(asked) : 0
      if (given > 0 && typeof context.loop?.hold === 'function') {
        context.loop.hold(given)
        state.held += given
      }

      if (how.sound && typeof context.play === 'function') {
        // Heavier hits sound lower. One sound file then covers a whole weapon
        // rack, which is what a game has before anyone has recorded anything.
        context.play(how.sound, { rate: 1.15 - curve * 0.3, volume: 0.5 + curve * 0.5 })
      }

      const at = asVector(how.at)
      context.bus.emit('impact', { weight, hold: given, shake, at })
      return { weight, hold: given, shake }
    }

    context.impact = {
      hit,
      /** Just the freeze, for something that is not a hit — a boss landing. */
      hold: seconds => context.loop?.hold(seconds) ?? 0,
      /** Just the jolt. */
      shake: metres => context.camera?.shake(metres),
      get holding() { return context.loop?.holding ?? 0 },
      state: () => ({ ...state })
    }

    context.bus.on('level:loaded', () => {
      state.held = 0
      state.shaken = 0
      state.hits = 0
      state.spent = 0
      state.spentAt = -1
    })
  },

  commands: [
    {
      id: 'impact.state',
      label: 'How much the picture has been punched',
      run: context => context.impact.state()
    },
    {
      id: 'impact.hit',
      label: 'Land one impact by hand',
      /** `run impact.hit 0.8` */
      run: (context, weight) => context.impact.hit({ weight: typeof weight === 'number' ? weight : 0.5 })
    }
  ]
}

const round = n => Math.round(n * 1000) / 1000
