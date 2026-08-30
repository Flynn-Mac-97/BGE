/**
 * Lights — a light is an entity, and the level is where you put one.
 *
 * Baking every photon into the textures and shipping no dynamic lights is one
 * good choice for a map that never changes, and it is not a reason for an
 * engine to have no lights. A torch in a dungeon, a muzzle flash lighting the
 * corridor it was fired down, a car headlight, a flashbang — every one of
 * those is a light that moves, and none of them can be baked. So both halves
 * live here: real lights any game can place, and the level-side half of baked
 * lighting for the games that would rather pay offline. A game that wants
 * neither places no lights and declares no lightmaps, and this file then costs
 * one empty Map per frame.
 *
 *   { "type": "light", "at": [4, 3, -2],
 *     "properties": { "kind": "point", "color": "#ffb060", "intensity": 2.4,
 *                     "range": 12, "shadow": true } }
 *
 * A light is an entity because that is this engine's grain. A thing in the world
 * is a placement in a level file: the inspector edits it for nothing, `set` moves
 * it from a terminal, `snapshot` counts it, and a level diff shows somebody
 * deciding where the lamp goes. A parallel registry of lights that only a plugin
 * could see would be a second scene format, and this engine has one.
 *
 * WHY THE TYPE IS REGISTERED HERE AND NOT WRITTEN TO project/types/light.js.
 * Both work; the plugin is the right home because a light is an engine feature
 * rather than a fact about one game, and a type file would have to be copied
 * into every project that ever wanted a lamp. The cost is real and worth stating:
 * `project/.engine/index.json` only indexes files under `project/`, so `light`
 * does not appear in the Project panel and cannot be dragged into the viewport.
 * Everything else works — `run place.at '["light", 4, 3]'` checks `world.types`,
 * which this file fills, and the inspector reads the definition off the entity.
 *
 * The registration is re-asserted on every `level:loaded`, and that is not
 * belt-and-braces. `startWorld` boots plugins, THEN calls `loadTypes()`, which
 * begins with `world.types.clear()` — so a type registered in `onLoad` is wiped
 * before the first level is read. Re-asserting with `world.retype` both puts the
 * definition back and heals every light the level has just spawned onto it, so
 * placements keep their overrides and pick up the defaults for everything else.
 *
 * There are no hooks on the light type on purpose. A system sees the whole world
 * at once, which is the only way to notice a light that went away: `world.clear()`
 * removes entities without ever running `onDestroy`, so a hook-based cleanup
 * would leak a three.js light on every level load.
 *
 *   node bin/engine.mjs run lights.list
 *   node bin/engine.mjs run lights.bake '{"surfaces":true}'
 *   node bin/engine.mjs run lights.flash '{"at":[4,2,-2],"seconds":0.5}'
 */

/**
 * How many lights may cast a shadow at once. One.
 *
 * A shadow map is a second render of the scene from the light's point of view,
 * every frame. A directional or spot light costs one such pass; a point light
 * costs six, because it renders a cube. On a map made of several hundred boxes
 * that one extra pass is already a large slice of a 16 ms budget, and a level
 * author who switches shadows on for eight lamps has silently asked for nine
 * renders of the map per frame — which is how a browser game arrives at fifteen
 * frames a second with nothing in the log to explain it.
 *
 * So: off by default, opted into per light, one supported well. The cap is a
 * constant rather than a setting because a number you can raise is a number
 * somebody raises, and the failure it causes looks like "the engine is slow"
 * rather than like a decision they made.
 */
export const SHADOW_CAP = 1

/** The five kinds, each of which maps onto exactly one three.js light. */
export const KINDS = ['point', 'spot', 'directional', 'area', 'hemisphere']

/** Shadow map resolution. 1024 is the last size that is cheap on a laptop GPU. */
const SHADOW_MAP_SIZE = 1024

/**
 * How far a flash reaches, and how long it lasts, when the caller says neither.
 *
 * A muzzle flash is over in about a seventeenth of a second — long enough for one
 * or two frames to catch it, short enough that the corridor is dark again before
 * the eye settles. Anything longer reads as a flare rather than as a gunshot.
 */
const FLASH = { color: '#ffd9a0', intensity: 6, range: 9, seconds: 0.06, kind: 'point' }

/**
 * The light type: what a light IS, and the inspector schema, in one file.
 *
 * Every kind's keys are declared together rather than per kind, because
 * `properties` doubles as the inspector schema and a key that only appears once
 * somebody types the right `kind` is a key nobody discovers. `angle` means
 * nothing to a point light and is simply not read.
 *
 * The marker mesh is there for the same reason spawn-point has one: a light you
 * cannot see is a light you cannot drag, and placing lamps by feel is exactly the
 * job the viewport is for. It is unlit so it reads as a lamp rather than as a
 * box, and the frame system hides it the moment the clock starts running — which
 * is the one line spawn-point's own comment asks somebody to write one day.
 */
export const LIGHT_TYPE = {
  mesh: { box: [0.24, 0.24, 0.24], tint: '#ffd479', unlit: true },
  properties: {
    // point | spot | directional | area | hemisphere
    kind: 'point',
    color: '#ffffff',
    intensity: 2,
    /** Metres to where a point or spot light has fallen to nothing. 0 never falls off. */
    range: 10,
    /**
     * Three's own default is 2 — inverse square, which is what light really does.
     * This engine defaults to 1 because a level author types `intensity: 2.4` and
     * expects to see 2.4 worth of light in the room; with inverse square the same
     * number is a twentieth as bright four metres out and the level comes back
     * reading as unlit. Set `decay: 2` on a light that wants the real falloff.
     */
    decay: 1,
    /** Which way a spot, a directional or an area light shines, in world space. */
    direction: [0, -1, 0],
    /** Spot only: half the cone, in degrees, and how soft its edge is. */
    angle: 45,
    penumbra: 0.3,
    /** Area only: the rectangle, in metres. */
    width: 2,
    height: 1,
    /** Hemisphere only: the colour coming up off the ground. */
    groundColor: '#3a3f46',
    /** Opt in, one at a time — see SHADOW_CAP. */
    shadow: false,
    /**
     * Seconds to fade out over, after which the entity removes itself. 0 stays.
     * This is what `context.lights.flash` sets, and a level may set it too — a
     * lamp that dies two seconds after the round starts is a placement, not code.
     */
    fade: 0,
    /**
     * Does this light stand still? A static light is one an offline bake can put
     * into a lightmap; a moving one has to be drawn every frame. `lights.bake`
     * lists the static ones and skips the rest.
     */
    static: true
  }
}

/**
 * The live plugin, and the context it was handed.
 *
 * A test file is given `test` and never a context, so without this there is no
 * way for one to call `context.lights.flash` or to read the warnings this file
 * printed. A plugin module is a singleton in node and in the browser alike, so
 * importing this file from `project/tests` reaches the very object the running
 * world uses. Null until the plugin has loaded.
 */
let running = null
export const runningLights = () => running

// ------------------------------------------------------------------ reading
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** A colour three can take, or the fallback — and said out loud either way. */
function readColour(value, fallback, where, say) {
  if (value == null) return fallback
  const text = String(value).trim()
  if (HEX.test(text) || /^[a-z]+$/i.test(text)) return text
  say(`[Lights] ${where}: "${text}" is not a colour — using ${fallback}`)
  return fallback
}

/** A number, or the fallback. A NaN intensity lights nothing and reports nothing. */
function readNumber(value, fallback, where, say, { least = -Infinity } = {}) {
  if (value == null) return fallback
  const amount = Number(value)
  if (!Number.isFinite(amount)) {
    say(`[Lights] ${where}: ${JSON.stringify(value)} is not a number — using ${fallback}`)
    return fallback
  }
  return Math.max(least, amount)
}

/** Three numbers that are not all zero, or the fallback. */
function readDirection(value, fallback, where, say) {
  if (value == null) return fallback
  const given = Array.isArray(value) ? value.map(Number) : []
  if (given.length !== 3 || !given.every(Number.isFinite) || given.every(n => n === 0)) {
    say(`[Lights] ${where}: a direction is three numbers that are not all zero — got ${JSON.stringify(value)}`)
    return fallback
  }
  return given
}

/**
 * What one light entity IS, resolved from its properties with everything checked.
 *
 * Pure, and exported so a test can ask what a placement means without a renderer
 * anywhere near it. This is also the record the whole rest of the file works
 * from, so a property is read and validated in exactly one place.
 */
export function readLight(entity, say = () => {}) {
  const declared = entity.properties || {}
  const defaults = LIGHT_TYPE.properties
  let kind = declared.kind ?? defaults.kind
  if (!KINDS.includes(kind)) {
    say(`[Lights] ${entity.id}: "${kind}" is not a light kind — one of ${KINDS.join(', ')}. Using point.`)
    kind = 'point'
  }
  const where = `${entity.id} (${kind})`
  return {
    id: entity.id,
    kind,
    at: [entity.x, entity.y, entity.z || 0],
    color: readColour(declared.color, defaults.color, where, say),
    groundColor: readColour(declared.groundColor, defaults.groundColor, where, say),
    intensity: readNumber(declared.intensity, defaults.intensity, `${where} intensity`, say, { least: 0 }),
    range: readNumber(declared.range, defaults.range, `${where} range`, say, { least: 0 }),
    decay: readNumber(declared.decay, defaults.decay, `${where} decay`, say, { least: 0 }),
    direction: readDirection(declared.direction, defaults.direction, where, say),
    angle: readNumber(declared.angle, defaults.angle, `${where} angle`, say, { least: 0 }),
    penumbra: readNumber(declared.penumbra, defaults.penumbra, `${where} penumbra`, say, { least: 0 }),
    width: readNumber(declared.width, defaults.width, `${where} width`, say, { least: 0 }),
    height: readNumber(declared.height, defaults.height, `${where} height`, say, { least: 0 }),
    fade: readNumber(declared.fade, defaults.fade, `${where} fade`, say, { least: 0 }),
    wantsShadow: declared.shadow === true,
    static: declared.static !== false
  }
}

/**
 * How bright a fading light is, part way through its life.
 *
 * Squared rather than linear, because a real flash is mostly over long before it
 * is gone: at half its duration this is a quarter as bright, which is what a
 * muzzle flash looks like. Linear reads as a lamp being turned down by hand.
 * Pure and exported, so the curve is checkable without spawning anything.
 */
export function flashIntensity(peak, elapsed, seconds) {
  if (!(seconds > 0)) return 0
  const progress = elapsed / seconds
  if (progress >= 1) return 0
  const left = 1 - progress
  return peak * left * left
}

// ------------------------------------------------------------------ lightmaps
/**
 * Baked lighting: the level-side half.
 *
 * A lightmap is a second texture holding light that was worked out offline and
 * sampled through a second UV set. The renderer reads it off the mesh —
 * `mesh: { lightmap: "maps/x-lightmap.png", lightmapIntensity: 1 }` — and this
 * is where a level says which surface gets which file, in one block instead of
 * on four hundred placements:
 *
 *   "lightmaps": {
 *     "intensity": 1,
 *     "directory": "maps",
 *     "maps": { "brush-12": "brush-12-lightmap.png", "ground-0": "ground-0-lightmap.png" }
 *   }
 *
 * THE BAKE DOES NOT HAPPEN HERE, and it never will. Computing a lightmap means
 * casting millions of rays against the whole map and denoising the result; it is
 * minutes of a real renderer's time, it needs a proper sampler, and a browser tab
 * that tried it would freeze the editor it is running inside. We drive a live
 * Blender instance for it. What this file owes that baker is an exact manifest of
 * what to bake — every static surface and every static light, in metres, in world
 * space — and that is `lights.bake`.
 *
 * AMBIENT OCCLUSION: use the SSAO pass Post Processing already has, and do not
 * add vertex colours. Vertex colours cannot work in this engine and it is worth
 * writing down why: render.js caches BoxGeometry by size, so four hundred walls
 * share one box, and painting corners per wall means giving every one of them
 * its own geometry — megabytes of buffers and a load hitch, which is the exact
 * thing that cache exists to prevent. A box has eight vertices anyway, and eight
 * vertices cannot describe a corner gradient. SSAO needs no geometry at all, it
 * darkens exactly the creases, and `"post": [{ "ssao": ... }]` in a level already
 * turns it on. Leave it off by default like shadows — it is a depth pass and a
 * blur every frame — and turn it off outright on any level that has a lightmap,
 * because the bake already contains that occlusion and doing both darkens every
 * corner twice.
 */
export function resolveLightmaps(block, say = () => {}) {
  const declared = block && typeof block === 'object' ? block : {}
  const intensity = readNumber(declared.intensity, 1, 'lightmaps intensity', say, { least: 0 })
  const directory = typeof declared.directory === 'string' ? declared.directory.replace(/\/+$/, '') : ''
  const maps = declared.maps && typeof declared.maps === 'object' ? declared.maps : {}
  const resolved = {}
  for (const [id, file] of Object.entries(maps)) {
    if (typeof file !== 'string' || !file) {
      say(`[Lights] lightmaps.maps["${id}"] must be the name of one image file — got ${JSON.stringify(file)}`)
      continue
    }
    resolved[id] = directory ? `${directory}/${file}` : file
  }
  return { intensity, directory, maps: resolved }
}

// ------------------------------------------------------------------ the plugin
export default {
  name: 'Lights',

  onLoad(context) {
    /** id -> everything this file knows about one live light. */
    const lights = new Map()
    const said = new Set()
    const say = message => {
      if (said.has(message)) return
      said.add(message)
      console.error(message)
    }

    const state = {
      context,
      lights,
      said,
      say,
      /** The level's "lightmaps" block, exactly as written, and what it resolves to. */
      lightmaps: { declared: {}, resolved: resolveLightmaps({}), applied: 0, missing: [] },
      /** three, imported only when something is actually drawing. */
      three: null,
      loadingThree: false
    }
    running = state

    // ---- the registry follows the world, so nothing has to be looked up ----
    const track = entity => {
      if (entity?.type !== 'light' || lights.has(entity.id)) return
      lights.set(entity.id, {
        entity,
        resolved: readLight(entity, say),
        kind: null,          // the kind the three.js object was built for
        object: null,
        target: null,
        castsShadow: false,
        peak: null,          // the intensity a fade started from
        startedAt: null
      })
    }
    const forget = id => {
      const record = lights.get(id)
      if (!record) return
      detach(state, record)
      lights.delete(id)
    }

    context.bus.on('entity:added', track)
    context.bus.on('entity:removed', entity => forget(entity?.id))
    context.bus.on('world:cleared', () => {
      for (const id of [...lights.keys()]) forget(id)
    })

    context.bus.on('level:loaded', async name => {
      // Synchronous, before the first await: `loadTypes()` cleared this type out
      // from under us at boot, and the level's lights are already spawned with no
      // definition behind them. retype puts both right in one call.
      context.world.retype('light', LIGHT_TYPE)
      // The level was read before any of this ran, so re-scan rather than trust
      // that every entity:added arrived.
      for (const entity of context.world.all('light')) track(entity)

      state.lightmaps = { declared: {}, resolved: resolveLightmaps({}), applied: 0, missing: [] }
      try {
        const raw = JSON.parse(await context.files.read(`levels/${name}.json`))
        state.lightmaps.declared = raw.lightmaps || {}
      } catch (e) {
        console.error(`[Lights] could not read the lightmaps block of levels/${name}.json —`, e.message)
      }
      applyLightmaps(state)
      syncLights(state)
    })

    // The fixed step only runs while the clock is running, and in edit mode it
    // never does — so a lamp dragged in the viewport would not light anything
    // until you pressed play. Anything that changes the world says so on the bus.
    context.bus.on('world:changed', () => syncLights(state))

    /**
     * The one-shot light every shot and every explosion reaches for.
     *
     * It is a real entity, so it is in `snapshot`, it is deterministic, and it
     * dies through `context.destroy` like everything else. It costs exactly
     * nothing when nothing is flashing: no entity, no record, no work.
     *
     * `at` takes either shape — `[x, y, z]` from a level or `{ x, y, z }` from
     * `context.raycast`, which is where an impact comes from.
     */
    const flash = (options = {}) => {
      const at = pointOf(options.at)
      let seconds = readNumber(options.seconds, FLASH.seconds, 'flash seconds', say, { least: 0 })
      if (!(seconds > 0)) {
        // A flash with no duration would never fade and never remove itself, and
        // the symptom is a light nobody can find in the level file.
        say(`[Lights] flash: ${JSON.stringify(options.seconds)} is not a duration — using one fixed step`)
        seconds = 1 / 60
      }
      const entity = context.spawn('light', {
        at,
        properties: {
          kind: KINDS.includes(options.kind) ? options.kind : FLASH.kind,
          color: readColour(options.color, FLASH.color, 'flash', say),
          intensity: readNumber(options.intensity, FLASH.intensity, 'flash intensity', say, { least: 0 }),
          range: readNumber(options.range, FLASH.range, 'flash range', say, { least: 0 }),
          shadow: false,
          fade: seconds,
          // A flash is over before an offline baker could have heard of it.
          static: false
        }
      })
      const record = lights.get(entity.id)
      if (record) {
        // Started now rather than when the fixed step first notices it, so two
        // runs of the same level agree to the step on how bright it was.
        record.startedAt = context.time
        record.peak = record.resolved.intensity
      }
      return entity
    }

    context.lights = {
      flash,
      shadowCap: SHADOW_CAP,
      list: () => [...lights.values()].map(publicRecord),
      report: () => report(state),
      bake: options => bakeManifest(state, options)
    }
  },

  systems: [
    {
      // Fading runs on the fixed clock and reads context.time, so a flash is the
      // same brightness at the same moment on every replay of the same seed.
      phase: 'fixed',
      run(world, seconds, context) {
        const state = running
        if (!state || !state.lights.size) return
        for (const record of [...state.lights.values()]) {
          const fade = record.resolved.fade
          if (!(fade > 0)) continue
          if (record.startedAt === null) {
            record.startedAt = context.time
            record.peak = record.resolved.intensity
          }
          const elapsed = context.time - record.startedAt
          if (elapsed >= fade) {
            context.destroy(record.entity)
            continue
          }
          // Written back onto the entity, not held privately, because the entity
          // is the truth in this engine: the inspector shows the light dimming
          // and a headless test can read the very number the renderer will use.
          record.entity.properties.intensity = flashIntensity(record.peak, elapsed, fade)
        }
      }
    },
    {
      phase: 'frame',
      run() {
        if (running) syncLights(running)
      }
    }
  ],

  commands: [
    {
      id: 'lights.list',
      label: 'Every light in the level, and whether it is lighting anything',
      run: context => context.lights.report()
    },
    {
      id: 'lights.bake',
      label: 'What an offline baker would bake — every static surface and light',
      // args: { surfaces: true } for the full surface list, which is long
      run: (context, options) => context.lights.bake(options)
    },
    {
      id: 'lights.flash',
      label: 'Fire a one-shot light, to find a colour and a duration by eye',
      // args: { at, color, intensity, seconds }
      run: (context, options) => {
        if (!context.loop.running) {
          // A flash fades on the fixed step, and edit mode never takes one. The
          // light would sit there for ever and be written into the level file by
          // the next save, which is a stray entity nobody would know to look for.
          throw new Error('lights.flash needs the clock running — press play, or use `simulate` after it')
        }
        const entity = context.lights.flash(options && typeof options === 'object' ? options : {})
        return { id: entity.id, at: [entity.x, entity.y, entity.z], properties: entity.properties }
      }
    }
  ]
}

/** `[x, y, z]` or `{ x, y, z }`, both of which turn up, reduced to the level's shape. */
function pointOf(at) {
  if (Array.isArray(at)) return [Number(at[0]) || 0, Number(at[1]) || 0, Number(at[2]) || 0]
  if (at && typeof at === 'object') return [Number(at.x) || 0, Number(at.y) || 0, Number(at.z) || 0]
  return [0, 0, 0]
}

const publicRecord = record => ({
  ...record.resolved,
  castsShadow: record.castsShadow,
  drawn: !!record.object,
  fading: record.startedAt !== null && record.resolved.fade > 0
})

// ------------------------------------------------------------------ syncing
/**
 * Push every light entity into the scene, and take away the ones that went.
 *
 * The bookkeeping happens whether or not anything is drawing — that is the one
 * engine rule: a headless world knows exactly the same set of lights, it simply
 * has no scene to hang them in. Only the last few lines need a renderer.
 */
function syncLights(state) {
  const { context, lights } = state
  if (!lights.size) return

  const playing = context.loop.running
  const records = [...lights.values()]
  let shadows = 0

  for (const record of records) {
    record.resolved = readLight(record.entity, state.say)
    // The marker box is an editing aid, not part of the game. Hidden the moment
    // the clock runs, back the moment it stops — the level reloads on stop, so
    // nothing has to remember it was hidden.
    record.entity.hidden = playing
    const granted = record.resolved.wantsShadow && shadows < SHADOW_CAP
    if (record.resolved.wantsShadow) shadows++
    record.castsShadow = granted
  }

  if (shadows > SHADOW_CAP) {
    const refused = records
      .filter(record => record.resolved.wantsShadow && !record.castsShadow)
      .map(record => record.entity.id)
    state.say(`[Lights] ${shadows} lights ask for shadows and this engine draws ${SHADOW_CAP} — ` +
      `${refused.join(', ')} will light the scene but cast nothing. ` +
      'Every extra shadow is another full render of the map per frame (six, for a point light).')
  }

  const renderer = context.renderer
  if (!renderer?.scene) return
  const THREE = threeModule(state)
  if (!THREE) return

  for (const record of records) attach(state, THREE, renderer.scene, record)
  if (shadows) markShadowSurfaces(context, renderer.scene)
}

/**
 * three, loaded once, and only where there is a screen to use it on.
 *
 * A world with nothing drawing must not pay to import a renderer library it will
 * never call — the same reason Skybox imports it inside its sky box builder.
 * The first frame or two after a level loads have no three.js light objects yet,
 * which nobody can see because nothing has been drawn either.
 */
function threeModule(state) {
  if (state.three || state.loadingThree) return state.three
  state.loadingThree = true
  import('three')
    .then(module => { state.three = module })
    .catch(e => {
      state.loadingThree = false
      console.error('[Lights] could not load three, so no light will be drawn —', e?.message || e)
    })
  return null
}

/** Build or refresh one three.js light to match its entity. */
function attach(state, THREE, scene, record) {
  const light = record.resolved
  if (record.kind !== light.kind) {
    detach(state, record)
    record.object = buildLight(state, THREE, light)
    record.kind = light.kind
    if (!record.object) return
    scene.add(record.object)
    if (record.object.target) {
      // A spot or a directional light aims at a target object, and three only
      // reads that target's world matrix if it is in the scene.
      record.target = record.object.target
      scene.add(record.target)
    }
  }
  const object = record.object
  if (!object) return

  object.position.set(light.at[0], light.at[1], light.at[2])
  object.intensity = light.intensity
  object.color.set(light.color)

  if (light.kind === 'point' || light.kind === 'spot') {
    object.distance = light.range
    object.decay = light.decay
  }
  if (light.kind === 'spot') {
    // Three takes the half-angle in radians and clamps it at a right angle.
    object.angle = Math.min(Math.PI / 2, light.angle * Math.PI / 180)
    object.penumbra = light.penumbra
  }
  if (light.kind === 'hemisphere') object.groundColor.set(light.groundColor)
  if (light.kind === 'area') {
    object.width = light.width
    object.height = light.height
    object.lookAt(light.at[0] + light.direction[0], light.at[1] + light.direction[1], light.at[2] + light.direction[2])
  }
  if (record.target) {
    record.target.position.set(
      light.at[0] + light.direction[0], light.at[1] + light.direction[1], light.at[2] + light.direction[2])
  }

  if ('castShadow' in object) object.castShadow = record.castsShadow
  if (record.castsShadow && object.shadow) {
    object.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
    // Acne shows as a striped floor, which reads as a broken texture rather than
    // as a shadow setting — cheaper to bias it than to have somebody find that.
    object.shadow.bias = -0.0005
    if (object.shadow.camera) {
      object.shadow.camera.near = 0.1
      object.shadow.camera.far = light.range > 0 ? light.range : 60
      if (light.kind === 'directional') {
        const half = (light.range > 0 ? light.range : 30) / 2
        Object.assign(object.shadow.camera, { left: -half, right: half, top: half, bottom: -half })
      }
      object.shadow.camera.updateProjectionMatrix()
    }
    // Setting castShadow is only half of a shadow: something has to switch the
    // renderer's shadow map on, and this engine's renderer does not expose the
    // WebGLRenderer it wraps. Say so by name rather than let a level author
    // conclude that shadows are broken — the fix is one line in render.js.
    if (!('shadowMap' in Object(state.context.renderer))) {
      state.say('[Lights] this renderer does not expose shadowMap, so a light that asks to cast one is ready ' +
        'but nothing is drawn. render.js needs `renderer.shadowMap.enabled = true` and to expose it.')
    }
  }
}

function buildLight(state, THREE, light) {
  const colour = new THREE.Color(light.color)
  switch (light.kind) {
    case 'point':
      return new THREE.PointLight(colour, light.intensity, light.range, light.decay)
    case 'spot':
      return new THREE.SpotLight(colour, light.intensity, light.range,
        light.angle * Math.PI / 180, light.penumbra, light.decay)
    case 'directional':
      return new THREE.DirectionalLight(colour, light.intensity)
    case 'hemisphere':
      return new THREE.HemisphereLight(colour, new THREE.Color(light.groundColor), light.intensity)
    case 'area':
      // A RectAreaLight needs a uniforms table loaded before it lights anything,
      // and three only applies it to standard and physical materials. Solid
      // geometry here is MeshLambertMaterial unless a surface asks the Materials
      // plugin for `standard` or `pbr`, so an area light over a plain wall is a
      // light that silently does nothing — which is worth saying out loud once.
      loadAreaLightUniforms(state)
      state.say('[Lights] an area light only reaches standard and physical materials. A surface drawn with ' +
        'the default lambert material will not look any brighter — give it material "standard", or use a spot.')
      return new THREE.RectAreaLight(colour, light.intensity, light.width, light.height)
    default:
      return null
  }
}

/** Optional and dynamic: the addon may not be resolvable, which is not fatal. */
function loadAreaLightUniforms(state) {
  if (state.areaUniforms) return
  state.areaUniforms = true
  import('three/addons/lights/RectAreaLightUniformsLib.js')
    .then(module => module.RectAreaLightUniformsLib?.init())
    .catch(e => state.say(`[Lights] the area light uniforms addon did not load — ${e?.message || e}`))
}

function detach(state, record) {
  const scene = state.context.renderer?.scene
  if (record.object) {
    scene?.remove(record.object)
    record.object.dispose?.()
    record.object.shadow?.dispose?.()
  }
  if (record.target) scene?.remove(record.target)
  record.object = null
  record.target = null
  record.kind = null
}

/**
 * Let the scene take part in a shadow pass.
 *
 * The renderer builds its meshes without saying anything about shadows, which is
 * the right default — a mesh that neither casts nor receives costs a shadow pass
 * nothing. This walks the scene only while a shadow-casting light exists, and
 * only touches an object once, so the cost is one pass over `scene.children` on
 * the frame a shadow first appears and a flag test after that.
 */
function markShadowSurfaces(context, scene) {
  for (const object of scene.children) {
    if (!object.isMesh || object.userData.lightsShadow) continue
    object.userData.lightsShadow = true
    // The sky box surrounds everything and a light's marker box is an editing
    // aid; a 3D gizmo is editor furniture, not a map object. Any of those would
    // cast a shadow across the whole map for nothing.
    const entity = object.userData.entity ? context.world.byId(object.userData.entity) : null
    const excluded = object.userData.skybox === true || object.userData.gizmo === true || entity?.type === 'light'
    // `mesh.shadow: false` casts nothing and still receives. A flat decal lying
    // on the ground — a mown patch, a rut, a scorch mark — is a thin box, and a
    // thin box under a low sun throws a hard offset shadow of its own outline
    // across the surface it is meant to be part of.
    object.castShadow = !excluded && castsShadow(context, entity) !== false
    object.receiveShadow = !excluded
  }
}

/** What the entity, then its type, says about casting. Undefined means yes. */
function castsShadow(context, entity) {
  if (!entity) return undefined
  if (entity.mesh && 'shadow' in entity.mesh) return entity.mesh.shadow
  return context.world.types?.[entity.type]?.mesh?.shadow
}

// ------------------------------------------------------------------ lightmaps
/**
 * Hand each named surface the lightmap the level chose for it.
 *
 * Applied only when something is drawing, for the same reason Skybox does not
 * build a sky box headless: a lightmap is a texture and there is nothing to put
 * it on. `lights.bake` still reports the whole mapping either way, so a headless
 * agent can see exactly what a level asked for.
 *
 * One thing to know before adding a big lightmaps block: `mesh` is a placement
 * key, so a level saved while these are applied writes the lightmap back onto
 * each placement it names. That is the same value the block already holds and the
 * block is re-applied on every load, so it is stable and idempotent rather than
 * wrong — but it is duplication, and the block stays the authority.
 */
function applyLightmaps(state) {
  const { context } = state
  state.lightmaps.resolved = resolveLightmaps(state.lightmaps.declared, state.say)
  const { maps, intensity } = state.lightmaps.resolved
  state.lightmaps.applied = 0
  state.lightmaps.missing = []

  const ids = Object.keys(maps)
  if (!ids.length) return
  if (!context.renderer) return

  for (const id of ids) {
    const entity = context.world.byId(id)
    if (!entity) { state.lightmaps.missing.push(`${id} — no such entity in this level`); continue }
    if (!entity.mesh) { state.lightmaps.missing.push(`${id} — has no mesh to put a lightmap on`); continue }
    if (entity.mesh.lightmap === maps[id] && entity.mesh.lightmapIntensity === intensity) {
      state.lightmaps.applied++
      continue
    }
    // A new object, never a mutation: an entity that did not set its own mesh is
    // holding the very object its type declared, and writing into that would give
    // every wall of that type the same lightmap.
    entity.mesh = { ...entity.mesh, lightmap: maps[id], lightmapIntensity: intensity }
    state.lightmaps.applied++
  }

  if (state.lightmaps.missing.length) {
    state.say(`[Lights] the lightmaps block names ${state.lightmaps.missing.length} surface(s) that cannot take one: ` +
      state.lightmaps.missing.join('; '))
  }
}

// ------------------------------------------------------------------ reporting
/** "Why is this room dark" has to be answerable from a terminal. */
function report(state) {
  const { context } = state
  const list = [...state.lights.values()].map(publicRecord)
  return {
    level: context.level(),
    drawing: !!context.renderer,
    counts: {
      lights: list.length,
      byKind: list.reduce((all, light) => (all[light.kind] = (all[light.kind] || 0) + 1, all), {}),
      fading: list.filter(l => l.fading).length,
      castingShadows: list.filter(l => l.castsShadow).length
    },
    shadowCap: SHADOW_CAP,
    lightmaps: {
      surfaces: Object.keys(state.lightmaps.resolved.maps).length,
      intensity: state.lightmaps.resolved.intensity,
      applied: state.lightmaps.applied,
      missing: state.lightmaps.missing
    },
    lights: list,
    notes: notes(state, list)
  }
}

function notes(state, list) {
  const out = []
  if (!state.context.renderer) {
    out.push('nothing is drawing this world, so the lights are worked out but not attached — that is what headless is')
  }
  const wanting = list.filter(l => l.wantsShadow).length
  if (wanting > SHADOW_CAP) out.push(`${wanting} lights ask for a shadow and ${SHADOW_CAP} is the cap`)
  if (list.some(l => l.kind === 'hemisphere')) {
    out.push('a hemisphere light is a global fill — its position is not read, so placing two only adds their intensities')
  }
  if (list.some(l => l.kind === 'point' && l.decay >= 2 && l.intensity < 4 && l.range > 4)) {
    out.push('a point light with decay 2 falls off as the square of distance — an intensity under 4 will read as black a few metres out')
  }
  if (Object.keys(state.lightmaps.resolved.maps).length && !state.context.renderer) {
    out.push('lightmaps are listed but not applied, because applying one means loading a texture and nothing is drawing')
  }
  return out
}

// ------------------------------------------------------------------ the bake
/**
 * Everything an offline baker needs, and nothing it has to guess.
 *
 * Positions are world space and metres, because that is what the level file and
 * Blender both work in once the scale is set. A surface is any entity that draws
 * solid geometry and does not move; a static light is one that stands still. The
 * moving ones are listed separately rather than dropped, because "why is my
 * torch not in the bake" is a question this ought to answer without a reply.
 */
function bakeManifest(state, options) {
  const { context } = state
  const want = options && typeof options === 'object' ? options : {}
  const surfaces = []
  const moving = []

  for (const entity of context.world.entities) {
    if (entity.type === 'light' || !entity.mesh) continue
    const isStatic = entity.properties?.static !== false && entity.properties?.body !== 'dynamic'
    const record = {
      id: entity.id,
      type: entity.type,
      at: [round(entity.x), round(entity.y), round(entity.z || 0)],
      rotation: round(entity.rotation || 0),
      size: boxOf(entity).map(round),
      texture: entity.mesh.texture || null,
      tiling: entity.mesh.tiling ?? null,
      tint: entity.mesh.tint || null,
      lightmap: state.lightmaps.resolved.maps[entity.id] || null
    }
    if (isStatic) surfaces.push(record)
    else moving.push(entity.id)
  }

  const lights = [...state.lights.values()].map(r => r.resolved)
  const world = context.worldLook?.report?.()

  return {
    level: context.level(),
    unit: 'metre',
    up: 'Y',
    // The bake is not done here and cannot be — see the comment above
    // resolveLightmaps. This is the shopping list, not the meal.
    bakedBy: 'an offline renderer (we drive a live Blender instance); nothing in this browser bakes anything',
    counts: {
      staticSurfaces: surfaces.length,
      movingSurfaces: moving.length,
      staticLights: lights.filter(l => l.static).length,
      movingLights: lights.filter(l => !l.static).length
    },
    ambient: world?.ambient ?? null,
    sun: world?.sun ?? null,
    lightmaps: {
      directory: state.lightmaps.resolved.directory,
      intensity: state.lightmaps.resolved.intensity,
      assigned: Object.keys(state.lightmaps.resolved.maps).length,
      missing: state.lightmaps.missing
    },
    lights: lights.filter(l => l.static),
    movingLights: lights.filter(l => !l.static).map(l => l.id),
    // A big map is several hundred surfaces and printing them every time is the
    // single most wasteful thing this command could do. Asked for by name.
    ...(want.surfaces ? { surfaces, movingSurfaces: moving } : {}),
    notes: [
      ...(want.surfaces ? [] : [`${surfaces.length} static surfaces are not listed — run lights.bake '{"surfaces":true}' for all of them`]),
      'a surface counts as static unless its placement sets properties.static false or properties.body "dynamic"',
      'the baker writes one image per surface and the level names it in its "lightmaps" block'
    ]
  }
}

/**
 * How big an entity's solid geometry is, in metres.
 *
 * The same rule the renderer follows — `box` or `quad` says it outright, and a
 * mesh that says neither takes the collider's box — restated here rather than
 * imported, because render.js imports three at the top of the file and a
 * manifest must be answerable in a world that is not drawing anything.
 */
function boxOf(entity) {
  const mesh = entity.mesh || {}
  const scale = entity.scale ?? 1
  if (Array.isArray(mesh.quad)) return [num(mesh.quad[0]) * scale, num(mesh.quad[1]) * scale, 0]
  const box = Array.isArray(mesh.box) ? mesh.box
    : (Array.isArray(entity.collider?.box) && entity.collider.box.length >= 3 ? entity.collider.box : [])
  return [num(box[0]) * scale, num(box[1]) * scale, num(box[2]) * scale]
}

const num = (value, fallback = 1) => (Number.isFinite(value) ? value : fallback)
const round = n => Math.round(n * 1000) / 1000
