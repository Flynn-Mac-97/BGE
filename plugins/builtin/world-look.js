/**
 * World Look — the fog and the light, declared in the level.
 *
 * The level already says where the camera goes and what the HUD shows, and this
 * is there for the same reason: what a place looks like belongs to the place.
 * The haze over a map is a fact about the map, not about a plugin and not about
 * any type in it.
 *
 *   "world": {
 *     "fog": [0.014, "#8a94a3"],
 *     "ambient": { "intensity": 0.55, "color": "#93a7c4" },
 *     "sun": { "direction": [-0.4, -1, -0.3], "intensity": 0.9, "color": "#fff2d8" }
 *   }
 *
 * The sky is its own plugin — Skybox owns `world.sky` and `world.skyTexture`.
 * `world.look` and `world.set` still answer for the whole block, reading the
 * sky's part from `context.skybox` when that plugin is loaded.
 *
 * Every key is optional. A level with no `world` block at all gets a lit
 * default and no fog, which is exactly what the 2D path had before this file
 * existed.
 *
 * All of it is also drivable from a terminal, so finding the right numbers is a
 * round trip rather than an edit and a reload:
 *
 *   node bin/engine.mjs run world.look
 *   node bin/engine.mjs run world.set '["fog", 0.02]'
 *
 * Nothing here feeds the simulation. It is handed to the renderer, which is
 * absent whenever nothing is drawing, so every call is guarded — and a headless
 * run still answers `world.look` with the numbers it would have used.
 */

/**
 * Exponential fog, and the one number in this file worth arguing about.
 *
 * Three's FogExp2 washes a surface out by `1 - exp(-(density * metres)^2)`, so
 * at 0.014 a wall 40 m away is a quarter gone, half at 60 m, and nine tenths by
 * 100 m. That is the balance a long sightline wants: it stays readable end to
 * end while the far edge of the world quietly disappears rather than ending in
 * a hard line against the sky. Doubling it hides the far end; halving it makes
 * the map look like plastic.
 */
const DEFAULT_FOG_DENSITY = 0.014

/** Distance at which fog of a given density has washed out half of a surface. */
const HALF_WASH = Math.sqrt(Math.LN2)

/**
 * Lit by default, because black is the one answer that tells an author nothing.
 *
 * These are the values a level gets when it declares no light of its own: a
 * cool sky bounce and a warm sun a little over the shoulder, which is the light
 * most outdoor maps reach for. Unlit materials — every 2D sprite in this engine —
 * ignore both, so applying them costs the 2D path nothing.
 */
const DEFAULT_AMBIENT = { intensity: 0.55, color: '#93a7c4' }
const DEFAULT_SUN = { direction: [-0.4, -1, -0.3], intensity: 0.9, color: '#fff2d8' }

export default {
  name: 'World Look',
  about: 'The fog and the global light — ambient and sun, declared in the level.',
  inspect: context => {
    const look = context.worldLook?.resolved
    if (!look) return []
    return [{
      title: 'Look',
      rows: [
        ['fog', look.fog?.density ? `${look.fog.density} (half by ${Math.round(HALF_WASH / look.fog.density)} m)` : 'off'],
        ['ambient', `${look.ambient?.intensity ?? 0} ${look.ambient?.color ?? ''}`.trim()],
        ['sun', `${look.sun?.intensity ?? 0} ${look.sun?.color ?? ''}`.trim()]
      ]
    }]
  },

  onLoad(context) {
    const look = {
      declared: {},        // the level's "world" block, exactly as it was written
      overrides: {},       // world.set, this session only — never written to disk
      resolved: resolveLook({}, {}, () => {}),
      said: new Set(),     // problems already reported, so a reload does not repeat them

      /**
       * Resolves once the level's own world block has been read off disk.
       *
       * `bus.emit` does not await its listeners, so the level:loaded handler
       * cannot be the thing that reads the file — a command asking what the look
       * is a millisecond after boot would be answered with the defaults, and
       * answered confidently. The handler assigns this synchronously and every
       * command waits on it.
       */
      declaredRead: Promise.resolve(),
      reading: false,      // true while that read is in flight

      /** Work out the whole look and hand it to the renderer. Safe with no renderer. */
      apply() {
        look.resolved = resolveLook(look.declared, look.overrides, message => sayOnce(look, message))
        const renderer = context.renderer
        if (renderer) {
          const { fog, ambient, sun } = look.resolved
          drive(look, renderer, 'setFog', [fog.density, fog.color])
          drive(look, renderer, 'setAmbient', [ambient.intensity, ambient.color])
          drive(look, renderer, 'setSun', [sun.direction, sun.intensity, sun.color])
        }
        return look.report()
      },

      /**
       * One key, in the same shapes the level file accepts. `null` drops the
       * change and hands the key back to whatever the level said, so a session
       * of tuning is undoable without reloading the level.
       *
       * The sky keys belong to the Skybox plugin, so they are routed there
       * when it is loaded; `world.set sky` still works either way.
       */
      set(key, value) {
        if (SKY_KEYS.includes(key)) {
          if (context.skybox) {
            const result = context.skybox.set(key, value)
            return report(context, look)
          }
          throw new Error(`no sky key "${key}" — the Skybox plugin is not loaded`)
        }
        if (!SETTABLE.includes(key)) {
          throw new Error(`no world key "${key}". One of ${SETTABLE.join(', ')} (or ${SKY_KEYS.join(', ')} for the sky)`)
        }
        if (value === null) delete look.overrides[key]
        else look.overrides[key] = value
        return look.apply()
      },

      report: () => report(context, look)
    }
    context.worldLook = look

    /**
     * Read one level's world block and apply it.
     *
     * A newer level may load while this read is in flight — it wins, exactly as
     * the camera's rule read does, or a slow disk decides what the look is.
     */
    let loadedFor = null
    async function readDeclared(name) {
      let declared = {}
      let failure = null
      try {
        declared = JSON.parse(await context.files.read(`levels/${name}.json`)).world || {}
      } catch (e) {
        failure = e
      }
      if (loadedFor !== name) return
      look.declared = declared
      look.reading = false
      if (failure) console.error(`[World Look] could not read the world block of levels/${name}.json —`, failure.message)
      look.apply()
    }

    // The level's world block is the rule; re-read it whenever a level loads,
    // and drop whatever world.set changed — the file has just had the last word.
    // Everything that must happen before the next line of anybody's code runs
    // happens here; the read itself is held in declaredRead for a command to
    // wait on.
    context.bus.on('level:loaded', name => {
      look.declared = {}
      look.overrides = {}
      loadedFor = name
      look.reading = true
      // The resolved values go back to the defaults at once, so nothing reports
      // the *previous* level's look as this one's.
      look.resolved = resolveLook({}, {}, () => {})
      look.declaredRead = readDeclared(name)
    })
  },

  commands: [
    {
      id: 'world.look',
      label: 'Sky, fog, ambient and sun as they are set now',
      // The level's block is read off disk and this is often the very first
      // thing a headless run asks. Waiting is the difference between reporting
      // what the level said and reporting the defaults as though it said nothing.
      run: async context => {
        await context.worldLook.declaredRead
        const own = context.worldLook.report()
        // The sky belongs to the Skybox plugin; answer for it too when it is
        // loaded, so one command still reports the whole world block.
        const sky = await context.skybox?.declaredRead?.then(() => context.skybox.report())
        if (sky) {
          return { ...own, ...sky, declared: { ...own.declared, ...sky.declared }, notes: [...own.notes, ...sky.notes] }
        }
        return own
      }
    },
    {
      id: 'world.set',
      label: 'Change the sky, fog, ambient or sun for this session',
      // args: ['fog', 0.02] or ['sun', { intensity: 1.4 }] — or a whole block,
      // { fog: 0.02, sky: '#6d7f96' }, which is the same shape the level uses.
      run: async (context, args) => {
        const look = context.worldLook
        // Same reason as world.look, and a stronger one: a change applied before
        // the level's own block arrives is a change the read then overwrites.
        await look.declaredRead
        if (args && !Array.isArray(args) && typeof args === 'object') {
          for (const [key, value] of Object.entries(args)) look.set(key, value)
          return worldSetReport(context)
        }
        // One command takes one argument, so `run world.set fog 0.02` loses the
        // number on the way here. Say so with the syntax that works, rather than
        // quietly setting the key to nothing.
        if (typeof args === 'string') {
          throw new Error(`world.set takes one JSON argument — run world.set '["${args}", <value>]'`)
        }
        const [key, value] = [].concat(args ?? [])
        if (!key) throw new Error(`world.set needs a key: ${SETTABLE.join(', ')}`)
        look.set(key, value ?? null)
        return worldSetReport(context)
      }
    }
  ]
}

/**
 * `world.set` sets one plugin's keys; the report it answers with is the whole
 * block, the same way `world.look` reads it.
 */
async function worldSetReport(context) {
  const own = context.worldLook.report()
  const sky = await context.skybox?.declaredRead?.then(() => context.skybox.report())
  return sky ? { ...own, ...sky, notes: [...own.notes, ...sky.notes] } : own
}

/** The keys a level may declare, and therefore the ones world.set will take. */
const SETTABLE = ['fog', 'ambient', 'sun']

/** The keys the Skybox plugin owns; world.set routes these to it. */
const SKY_KEYS = ['sky', 'skyTexture']

// ------------------------------------------------------------------ resolving
/**
 * The level's block, plus this session's changes, plus the defaults underneath.
 *
 * Every value is read in the loosest form that is unambiguous — a bare number,
 * a bare colour, a pair, or the full object — because a look is tuned by typing
 * one number and a syntax that demands the other four is a syntax nobody edits.
 * Each reader returns only what was actually stated, so `world.set fog 0.02`
 * keeps the colour the level chose instead of silently resetting it.
 */
function resolveLook(declared, overrides, say) {
  const stated = key => (key in overrides ? overrides[key] : declared[key])
  // A key written as null is a key deliberately turned off, not a key missing.
  const has = key => stated(key) != null
  // A key the level never wrote is skipped rather than read as `undefined`. It
  // reads the same for a light, but not for fog: readFog(undefined) answers
  // "density 0", and that answer then beat the default underneath it — so
  // `world.set fog true` on a level that declares no fog turned fog on at a
  // density of nothing, and said so to nobody.
  const parts = (key, read) => ({
    ...(key in declared ? read(declared[key], say, key) : {}),
    ...(key in overrides ? read(overrides[key], say, key) : {})
  })

  // Fog matched to the sky is most of what makes distance read as air rather
  // than as a filter over the picture, so the sky colour is its default.
  const fog = has('fog')
    ? { density: DEFAULT_FOG_DENSITY, color: DEFAULT_AMBIENT.color, ...parts('fog', readFog) }
    : { density: 0, color: DEFAULT_AMBIENT.color }

  return {
    fog: { density: Math.max(0, Number(fog.density) || 0), color: colour(fog.color, DEFAULT_AMBIENT.color, 'fog', say) },
    ambient: { ...DEFAULT_AMBIENT, ...parts('ambient', readLight) },
    sun: { ...DEFAULT_SUN, ...parts('sun', readLight), ...parts('sun', readDirection) }
  }
}

/** `0.02`, `"#8a94a3"`, `[0.02, "#8a94a3"]` or `{ density, color }`. */
function readFog(value, say) {
  if (value == null || value === false) return { density: 0 }
  if (value === true) return {}
  if (typeof value === 'number') return { density: value }
  if (typeof value === 'string') return { color: value }
  if (Array.isArray(value)) return pick({ density: value[0], color: value[1] })
  if (typeof value === 'object') return pick({ density: value.density, color: value.color ?? value.colour })
  say(`[World Look] fog must be a density, a colour, [density, colour] or { density, color } — got ${JSON.stringify(value)}`)
  return {}
}

/** `0.6`, `"#93a7c4"`, `[0.6, "#93a7c4"]` or `{ intensity, color }`, for both lights. */
function readLight(value, say, key) {
  if (value == null) return {}
  if (typeof value === 'number') return { intensity: value }
  if (typeof value === 'string') return { color: value }
  // An array on the sun is its direction, which readDirection takes. Anywhere
  // else it is the same [value, colour] pair fog accepts.
  if (Array.isArray(value)) return key === 'sun' ? {} : pick({ intensity: value[0], color: value[1] })
  if (typeof value === 'object') return pick({ intensity: value.intensity, color: value.color ?? value.colour })
  say(`[World Look] a light must be an intensity, a colour or { intensity, color } — got ${JSON.stringify(value)}`)
  return {}
}

/** The sun also carries a direction, written either as `sun.direction` or as three numbers. */
function readDirection(value, say) {
  const raw = Array.isArray(value) ? value : value?.direction
  if (raw == null) return {}
  const direction = Array.isArray(raw) && raw.length === 3 ? raw.map(Number) : null
  if (!direction || direction.some(n => !Number.isFinite(n)) || direction.every(n => n === 0)) {
    say(`[World Look] the sun direction must be three numbers that are not all zero — got ${JSON.stringify(raw)}`)
    return {}
  }
  return { direction }
}

const pick = object => Object.fromEntries(Object.entries(object).filter(([, v]) => v != null))

/**
 * A colour the renderer can take, or the fallback — and said out loud either way.
 *
 * A mistyped colour is precisely the failure this engine refuses to allow: the
 * level goes dark, the log stays empty, and the author reads their own file
 * three times looking for the missing hash.
 */
function colour(value, fallback, what, say) {
  if (value == null) return fallback
  if (typeof value === 'number') return value
  const text = String(value).trim()
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)) return text
  if (COLOUR_NAMES.has(text.toLowerCase())) return text
  say(`[World Look] "${text}" is not a colour the ${what} can use — it is neither a #hex value nor one of the CSS colour names — falling back to ${fallback}`)
  return fallback
}

/**
 * Every colour name the renderer will actually take.
 *
 * Three's Color accepts a hex value or one of the CSS names, and nothing else.
 * The test here used to be "a word of letters", which let `purpleish` straight
 * through to a renderer that then rejected it — the level goes dark, the log
 * stays empty, and the author reads their own file three times. That is the
 * precise failure this function exists to prevent, so the list is written out.
 */
const COLOUR_NAMES = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond ' +
  'blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan ' +
  'darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange ' +
  'darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet ' +
  'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
  'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush ' +
  'lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey ' +
  'lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime ' +
  'limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
  'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin ' +
  'navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise ' +
  'palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue ' +
  'saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow ' +
  'springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '))

// ------------------------------------------------------------------ the renderer
/**
 * Call one renderer setter, and never take a level load down with it.
 *
 * `context.renderer` is absent headless, which is not an error and is handled
 * by the caller. A renderer that is present but missing the setter *is* one —
 * it means the level said something and nothing happened, so it is reported by
 * name, once, rather than left as a look that quietly did not arrive.
 */
function drive(look, renderer, method, args) {
  const fn = renderer[method]
  if (typeof fn !== 'function') {
    sayOnce(look, `[World Look] this renderer has no ${method}() — that part of the level's world block was not applied`)
    return false
  }
  try {
    fn.apply(renderer, args)
    return true
  } catch (e) {
    sayOnce(look, `[World Look] ${method}(${args.map(a => JSON.stringify(a)).join(', ')}) failed — ${e.message}`)
    return false
  }
}

function sayOnce(look, message) {
  if (look.said.has(message)) return
  look.said.add(message)
  console.error(message)
}

// ------------------------------------------------------------------ reporting
/**
 * "Why is this level dark" has to be answerable from a terminal.
 *
 * So this reports what is set, what the level actually asked for, and what is
 * suspicious about the combination — including the plain fact that nothing is
 * drawing, which is the commonest reason of all for seeing nothing.
 */
function report(context, look) {
  const { fog, ambient, sun } = look.resolved
  return {
    level: context.level(),
    drawing: !!context.renderer,
    fog: fog.density
      ? { ...fog, halfWashedOutAt: round(HALF_WASH / fog.density) }
      : { density: 0, color: fog.color },
    ambient,
    sun,
    declared: look.declared,
    changedThisSession: Object.keys(look.overrides),
    notes: notes(context, look)
  }
}

function notes(context, look) {
  const { fog, ambient, sun } = look.resolved
  const out = []
  // First, because everything under it may be about to change.
  if (look.reading) out.push('the level\'s own "world" block has not finished being read off disk, so everything here is still the default — ask again, or run world.look, which waits')
  if (!context.renderer) out.push('nothing is drawing this world, so the look is worked out but not applied — that is what headless is')
  if (!look.reading && !Object.keys(look.declared).length) out.push('the level declares no "world" block, so these are the defaults')
  if (ambient.intensity + sun.intensity < 0.2) out.push('ambient and sun together are under 0.2 — anything lit will read as black')
  if (fog.density > 0.04) out.push(`fog is thick: half washed out by ${round(HALF_WASH / fog.density)} m, so a long sightline will not read`)
  if (Object.keys(look.overrides).length) out.push('world.set changed this session and nothing was written — the level file still says what it said')
  return out
}

const round = n => Math.round(n * 1000) / 1000
