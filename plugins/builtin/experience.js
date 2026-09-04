/**
 * Experience — points, a curve, and the level they add up to.
 *
 * The shape of the curve is the whole feel of a levelling game. Early levels
 * have to arrive within seconds of each other, or the first minute has no
 * rhythm; late ones have to take real time, or the choices stop being choices.
 * So the curve is a parameter, not a constant: this file knows how to count and
 * when to announce, and the game says what the numbers are.
 *
 *   context.experience.configure({ base: 5, growth: 1.35, maxLevel: 99 })
 *   context.experience.gain(3)
 *   context.bus.on('experience:levelled', ({ level }) => ...)
 *
 * Levelling is announced once per level, in order, even when one pickup crosses
 * three thresholds at once. Anything that stops the world to offer a choice can
 * then queue three offers rather than silently losing two of them.
 *
 * The running totals are mirrored into `world.state` so a HUD reads them with no
 * wiring at all, and so `snapshot()` shows them without anybody asking.
 */

/** Points to get from `level` to the next one, when nobody has said otherwise. */
const DEFAULT_CURVE = { base: 5, growth: 1.35, maxLevel: 99 }

export default {
  name: 'Experience',
  category: 'game',
  about: 'Count experience points against a curve and announce every level gained.',
  inspect: context => {
    const experience = context.experience
    if (!experience) return []
    return [{
      title: 'Progress',
      rows: [
        ['level', String(experience.level)],
        ['into this level', `${experience.intoLevel} / ${experience.needed}`],
        ['total points', String(experience.total)]
      ]
    }]
  },

  onLoad(context) {
    const settings = { ...DEFAULT_CURVE, curve: null }

    const state = { total: 0, level: 1, intoLevel: 0 }

    /**
     * Points from this level to the next.
     *
     * A game may hand in its own `curve(level)` and take the arithmetic away
     * entirely — a table of hand-tuned numbers is a perfectly good curve, and a
     * formula that has to be bent into one is not.
     */
    function needFor(level) {
      if (typeof settings.curve === 'function') return Math.max(1, Math.round(settings.curve(level)))
      return Math.max(1, Math.round(settings.base * Math.pow(level, settings.growth)))
    }

    const atMaximum = () => state.level >= settings.maxLevel

    /** The HUD reads these by name, so they are plain words and always current. */
    function publish() {
      const world = context.world
      world.state.level = state.level
      world.state.experience = state.intoLevel
      world.state.experienceNeeded = needFor(state.level)
      world.state.experienceFraction = atMaximum() ? 1 : state.intoLevel / needFor(state.level)
    }

    /**
     * Take points in, and say how many levels came out.
     *
     * One at a time, in order, because a listener that stops the world to offer
     * a choice has to be handed three level-ups as three events. Rolling them
     * into one "you are now level 4" would quietly delete two choices.
     */
    function gain(amount, source = null) {
      const points = Math.max(0, Number(amount) || 0)
      if (!points) return { level: state.level, levelled: 0 }

      state.total += points
      state.intoLevel += points

      let levelled = 0
      while (!atMaximum() && state.intoLevel >= needFor(state.level)) {
        state.intoLevel -= needFor(state.level)
        state.level++
        levelled++
        publish()
        context.bus.emit('experience:levelled', { level: state.level, source })
      }
      // At the ceiling the bar is full and stays full rather than counting up
      // toward a level that is never coming.
      if (atMaximum()) state.intoLevel = 0

      publish()
      context.bus.emit('experience:gained', { points, source, level: state.level })
      return { level: state.level, levelled, points }
    }

    function reset() {
      state.total = 0
      state.level = 1
      state.intoLevel = 0
      publish()
    }

    context.experience = {
      /** Change the curve. Anything left out keeps the value it had. */
      configure(options = {}) {
        Object.assign(settings, options)
        publish()
        return { ...settings }
      },
      settings: () => ({ ...settings }),

      gain,
      reset,
      needFor,

      /** Total points to have reached `level` from the start — for a result card. */
      totalFor(level) {
        let sum = 0
        for (let n = 1; n < level; n++) sum += needFor(n)
        return sum
      },

      get level() { return state.level },
      get total() { return state.total },
      get intoLevel() { return state.intoLevel },
      get needed() { return needFor(state.level) },
      get fraction() { return atMaximum() ? 1 : state.intoLevel / needFor(state.level) },
      get atMaximum() { return atMaximum() }
    }

    publish()

    // A run's progress belongs to that run. Carrying a level 12 into a fresh
    // level would be the kind of bug nobody notices until the balance is wrong.
    context.bus.on('level:loaded', reset)
  },

  commands: [
    {
      id: 'experience.state',
      label: 'Level and points',
      run: context => ({
        level: context.experience.level,
        intoLevel: context.experience.intoLevel,
        needed: context.experience.needed,
        total: context.experience.total,
        fraction: Math.round(context.experience.fraction * 100) / 100
      })
    },
    {
      id: 'experience.gain',
      label: 'Award experience points',
      run: (context, args) => context.experience.gain(Number([].concat(args ?? [])[0] ?? 1), 'command')
    }
  ]
}
