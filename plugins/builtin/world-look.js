/**
 * World Look — the sky, the fog and the light, declared in the level.
 *
 * The level already says where the camera goes and what the HUD shows, and this
 * is there for the same reason: what a place looks like belongs to the place.
 * The dusty haze over de_dust2 is a fact about de_dust2, not about a plugin and
 * not about any type in it.
 *
 *   "world": {
 *     "sky": "#6d7f96",
 *     "skyTexture": "counter-strike/sky.png",
 *     "fog": [0.014, "#8a94a3"],
 *     "ambient": { "intensity": 0.55, "color": "#93a7c4" },
 *     "sun": { "direction": [-0.4, -1, -0.3], "intensity": 0.9, "color": "#fff2d8" }
 *   }
 *
 * `skyTexture` is mapped over a whole sphere, so the image must be a whole sky:
 * zenith along its top edge, horizon across its vertical middle, ground colour
 * along the bottom. `world.look` reports the mapping and says so when the image
 * does not look like one.
 *
 * Every key is optional. A level with no `world` block at all gets a lit
 * default and a sky of nothing, which is exactly what the 2D path had before
 * this file existed.
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

/** Where the sky colour lands when a level asks for a sky box but not a colour. */
const DEFAULT_SKY = '#6d7f96'

/**
 * Exponential fog, and the one number in this file worth arguing about.
 *
 * Three's FogExp2 washes a surface out by `1 - exp(-(density * metres)^2)`, so
 * at 0.014 a wall 40 m away — about the length of long A on de_dust2 — is a
 * quarter gone, half at 60 m, and nine tenths by 100 m. That is the balance
 * this map wants: a sightline stays readable end to end while the far edge of
 * the world quietly disappears rather than ending in a hard line against the
 * sky. Doubling it hides long A; halving it makes the map look like plastic.
 */
const DEFAULT_FOG_DENSITY = 0.014

/** Distance at which fog of a given density has washed out half of a surface. */
const HALF_WASH = Math.sqrt(Math.LN2)

/**
 * Lit by default, because black is the one answer that tells an author nothing.
 *
 * These are the values a level gets when it declares no light of its own: a
 * cool sky bounce and a warm sun a little over the shoulder, which is the light
 * de_dust2 is remembered in. Unlit materials — every 2D sprite in this engine —
 * ignore both, so applying them costs the 2D path nothing.
 */
const DEFAULT_AMBIENT = { intensity: 0.55, color: '#93a7c4' }
const DEFAULT_SUN = { direction: [-0.4, -1, -0.3], intensity: 0.9, color: '#fff2d8' }

/**
 * How far away the sky box sits, in metres.
 *
 * It rides with the eye and it is drawn first with depth testing off, so it can
 * never occlude anything and the number is not a view distance — it only has to
 * be comfortably inside the camera's far plane, which a small one always is.
 */
const SKY_RADIUS = 100

export default {
  name: 'World Look',

  onLoad(context) {
    const look = {
      declared: {},        // the level's "world" block, exactly as it was written
      overrides: {},       // world.set, this session only — never written to disk
      resolved: resolveLook({}, {}, () => {}),
      skyMesh: null,
      skyFile: null,
      skyStatus: 'none',   // none | loading | shown | failed | nothing is drawing
      skyRequest: 0,       // which sky texture request is the current one
      skySize: null,       // [width, height] of the loaded image, so the mapping can be checked
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
          const { sky, fog, ambient, sun } = look.resolved
          drive(look, renderer, 'setSky', [sky])
          drive(look, renderer, 'setFog', [fog.density, fog.color])
          drive(look, renderer, 'setAmbient', [ambient.intensity, ambient.color])
          drive(look, renderer, 'setSun', [sun.direction, sun.intensity, sun.color])
        }
        syncSkyBox(context, look)
        return look.report()
      },

      /**
       * One key, in the same shapes the level file accepts. `null` drops the
       * change and hands the key back to whatever the level said, so a session
       * of tuning is undoable without reloading the level.
       */
      set(key, value) {
        if (!SETTABLE.includes(key)) {
          throw new Error(`no world key "${key}". One of ${SETTABLE.join(', ')}`)
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
     * the camera's rule read does, or a slow disk decides what the sky looks like.
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
      // the *previous* level's sky as this one's. The sky box itself is left
      // alone until the read lands — tearing it down and rebuilding it on every
      // level load would refetch an image that is very often the same one.
      look.resolved = resolveLook({}, {}, () => {})
      look.declaredRead = readDeclared(name)
    })
  },

  systems: [{
    phase: 'frame',
    run(world, seconds, context) {
      const sky = context.worldLook?.skyMesh
      if (!sky) return
      // Anything that rebuilds the scene takes the sky with it, and a sky that
      // vanished would look exactly like a sky that never loaded. Put it back.
      if (!sky.parent) context.renderer?.scene?.add(sky)
      // The sky box rides with the eye, so it is the same distance away
      // wherever the player walks and nobody can reach its wall. Cheap enough
      // to do unconditionally, and doing it on the frame rather than the fixed
      // step keeps it out of the simulation entirely.
      const view = context.view
      sky.position.set(view.x, view.y, view.z || 0)
    }
  }],

  commands: [
    {
      id: 'world.look',
      label: 'Sky, fog, ambient and sun as they are set now',
      // The level's block is read off disk and this is often the very first
      // thing a headless run asks. Waiting is the difference between reporting
      // what the level said and reporting the defaults as though it said nothing.
      run: async context => {
        await context.worldLook.declaredRead
        return context.worldLook.report()
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
          return look.report()
        }
        // One command takes one argument, so `run world.set fog 0.02` loses the
        // number on the way here. Say so with the syntax that works, rather than
        // quietly setting the key to nothing.
        if (typeof args === 'string') {
          throw new Error(`world.set takes one JSON argument — run world.set '["${args}", <value>]'`)
        }
        const [key, value] = [].concat(args ?? [])
        if (!key) throw new Error(`world.set needs a key: ${SETTABLE.join(', ')}`)
        return look.set(key, value ?? null)
      }
    }
  ]
}

/** The keys a level may declare, and therefore the ones world.set will take. */
const SETTABLE = ['sky', 'skyTexture', 'fog', 'ambient', 'sun']

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

  const skyTexture = typeof stated('skyTexture') === 'string' ? stated('skyTexture') : null
  if (stated('skyTexture') != null && !skyTexture) say('[World Look] skyTexture must be the name of one image file')

  // A sky box still gets a flat colour behind it: it is what shows if the image
  // fails to load, and it is what the fog matches so the two agree at the horizon.
  const sky = has('sky') ? colour(stated('sky'), DEFAULT_SKY, 'sky', say) : (skyTexture ? DEFAULT_SKY : null)

  // Fog matched to the sky is most of what makes distance read as air rather
  // than as a filter over the picture, so the sky colour is its default.
  const fog = has('fog')
    ? { density: DEFAULT_FOG_DENSITY, color: sky ?? DEFAULT_SKY, ...parts('fog', readFog) }
    : { density: 0, color: sky ?? DEFAULT_SKY }

  return {
    sky,
    skyTexture,
    fog: { density: Math.max(0, Number(fog.density) || 0), color: colour(fog.color, DEFAULT_SKY, 'fog', say) },
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
 * level goes black, the log stays empty, and the author reads their own file
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
 * through to a renderer that then rejected it — the level goes black, the log
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

// ------------------------------------------------------------------ the sky box
/**
 * A flat colour behind a skyline is the fastest way to make a map look like a
 * greybox, so a level may name an image instead. Counter-Strike used a six-sided
 * box; one inverted sphere takes any single panorama, has no seams to line up,
 * and is the same idea from the inside.
 *
 * The renderer's four setters cannot express this — `setSky` takes a colour — so
 * the mesh is built here and added to the renderer's own scene rather than by
 * widening a kernel file that four other plugins are reading.
 */
function syncSkyBox(context, look) {
  const wanted = look.resolved.skyTexture
  if (wanted === look.skyFile) return
  look.skyFile = wanted
  look.skySize = null
  removeSkyBox(context, look)
  if (!wanted) { look.skyStatus = 'none'; return }
  if (!context.renderer?.scene) {
    // Headless. The level's choice is still reported, so world.look answers with
    // the sky it would have shown rather than pretending none was asked for.
    look.skyStatus = 'nothing is drawing'
    return
  }

  look.skyStatus = 'loading'
  const request = ++look.skyRequest
  buildSkyBox(wanted).then(mesh => {
    // Another level may have loaded while the image was in flight, in which case
    // this sky is already the wrong one.
    if (request !== look.skyRequest || look.skyFile !== wanted) {
      disposeSkyBox(mesh)
      return
    }
    context.renderer.scene.add(mesh)
    look.skyMesh = mesh
    look.skySize = mesh.userData.skySize
    look.skyStatus = 'shown'
  }).catch(e => {
    if (request !== look.skyRequest) return
    look.skyStatus = 'failed'
    // Let go of the name. `skyFile` is what syncSkyBox compares against, so a
    // failed load that kept it assigned meant this sky could never be asked for
    // again — not by a re-apply, not by world.set, not by dropping the file into
    // place. The next apply() now tries again.
    look.skyFile = null
    // The flat sky colour is still there underneath, so this degrades to a
    // greybox rather than to black — but it must say which it is.
    console.error(`[World Look] the sky texture "${wanted}" did not load, so the flat sky colour is showing —`, e?.message || e)
  })
}

/**
 * Three is imported here rather than at the top of the file because this is the
 * one part of the look that needs a scene graph, and a world with nothing
 * drawing must not pay to load a renderer library it will never call.
 */
async function buildSkyBox(file) {
  const [THREE, { assetURL }] = await Promise.all([import('three'), import('../../engine/ui.js')])

  const texture = await new Promise((resolve, reject) => {
    // A texture load is a real-time concern that no fixed step reads, so the
    // loader's own callbacks are fine here.
    new THREE.TextureLoader().load(assetURL(file), resolve, undefined,
      () => reject(new Error(`404 ${assetURL(file)}`)))
  })
  texture.colorSpace = THREE.SRGBColorSpace
  // Wrapping round is what a panorama wants; clamping top to bottom is what
  // stops the pole sampling the far edge of the image and ringing the zenith.
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping

  const mesh = new THREE.Mesh(
    /**
     * THE SKY IMAGE IS ASSUMED TO BE A FULL GRADIENT, and this is where that
     * assumption lives.
     *
     * A sphere's UV runs the image's top edge to the zenith, its bottom edge to
     * the nadir and its vertical middle to the horizon. So the image must be a
     * whole sky: zenith at the top, horizon across the middle, ground colour at
     * the bottom. Hand it an image authored zenith-to-horizon — half a sky, the
     * way `sky.png` was first drawn — and the horizon band lands at the nadir,
     * which is to say underneath the floor, and the map is roofed in the wrong
     * colour with nothing said about it.
     *
     * `report()` says which mapping is in force and warns when the loaded image
     * is not proportioned like a full-sky panorama, so a redrawn image that
     * breaks the assumption is visible from a terminal rather than only from a
     * screenshot. The sphere is written out in full for the same reason: the
     * arguments are the defaults, and stating them makes the choice reviewable.
     */
    new THREE.SphereGeometry(SKY_RADIUS, 64, 32, 0, Math.PI * 2, 0, Math.PI),
    new THREE.MeshBasicMaterial({
      map: texture,
      // Seen from the inside, unaffected by the fog that is meant to fade the
      // world *towards* it, and never writing depth so it cannot occlude.
      side: THREE.BackSide,
      fog: false,
      depthTest: false,
      depthWrite: false
    })
  )
  // First of everything, and never culled — it is always exactly around the eye.
  mesh.renderOrder = -1000
  mesh.frustumCulled = false
  mesh.userData.worldLook = 'sky'
  // Carried out so report() can check the image against the mapping above.
  mesh.userData.skySize = [texture.image?.width ?? 0, texture.image?.height ?? 0]
  return mesh
}

function removeSkyBox(context, look) {
  if (!look.skyMesh) return
  context.renderer?.scene?.remove(look.skyMesh)
  disposeSkyBox(look.skyMesh)
  look.skyMesh = null
}

function disposeSkyBox(mesh) {
  if (!mesh) return
  mesh.geometry.dispose()
  mesh.material.map?.dispose()
  mesh.material.dispose()
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
  const { sky, skyTexture, fog, ambient, sun } = look.resolved
  return {
    level: context.level(),
    drawing: !!context.renderer,
    sky,
    skyTexture,
    skyBox: look.skyStatus,
    // Stated rather than implied, because an image drawn against the wrong
    // assumption looks plausible in a screenshot and is wrong everywhere.
    skyMapping: skyTexture
      ? 'a full sphere: the image top edge is the zenith, the bottom edge the nadir, the horizon across the vertical middle'
      : null,
    skySize: look.skySize,
    reading: look.reading,
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
  const { fog, ambient, sun, skyTexture } = look.resolved
  const out = []
  // First, because everything under it may be about to change.
  if (look.reading) out.push('the level\'s own "world" block has not finished being read off disk, so everything here is still the default — ask again, or run world.look, which waits')
  if (!context.renderer) out.push('nothing is drawing this world, so the look is worked out but not applied — that is what headless is')
  if (!look.reading && !Object.keys(look.declared).length) out.push('the level declares no "world" block, so these are the defaults')
  if (look.skySize && look.skySize[1] >= look.skySize[0]) {
    out.push(`the sky texture "${skyTexture}" is ${look.skySize[0]}x${look.skySize[1]} — it is mapped as a full gradient over the whole sphere, and a full-sky panorama is wider than it is tall, so this one is probably authored zenith-to-horizon and its horizon band will be sitting below the floor`)
  }
  if (ambient.intensity + sun.intensity < 0.2) out.push('ambient and sun together are under 0.2 — anything lit will read as black')
  if (fog.density > 0.04) out.push(`fog is thick: half washed out by ${round(HALF_WASH / fog.density)} m, so a long sightline will not read`)
  if (look.skyStatus === 'failed') out.push(`the sky texture "${skyTexture}" did not load — the flat sky colour is showing instead`)
  if (Object.keys(look.overrides).length) out.push('world.set changed this session and nothing was written — the level file still says what it said')
  return out
}

const round = n => Math.round(n * 1000) / 1000
