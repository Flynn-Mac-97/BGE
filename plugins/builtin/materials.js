/**
 * Materials — the library of surfaces, and the door a game adds its own through.
 *
 * A material is declared where everything else in this engine is declared: as
 * data on the type file, one flat key, a string when simple and an object when
 * detailed.
 *
 *   mesh: { box: [2, 3, 0.4], material: 'lambert', texture: 'wall.png' }
 *   mesh: { box: [2, 3, 0.4], material: 'toon', steps: 3, outline: 0.4 }
 *   mesh: { quad: [4, 4], material: 'water', normal: 'water-normal.png', speed: 0.08 }
 *   mesh: { box: [1, 1, 1], material: { name: 'toon', steps: 3 } }
 *
 * Every key that is not structural — not `box`, `quad`, `model`, `material` or
 * `unlit` — is a parameter, and so are the keys inside the detailed object, which
 * win where they overlap. That is what makes `texture`, `tint` and `roughness`
 * all reachable without inventing a second place to write them.
 *
 * PREFER THE FLAT FORM. Both are read here, but the renderer's shared-material
 * cache is keyed on the flat keys: `materialLook` in engine/render.js walks
 * every key of the mesh that is not structural. A parameter written inside
 * `material: { … }` is not one of those, so two toons that differ only in a step
 * count written that way share one material and the second draws with the
 * first's settings.
 *
 * A builder is handed exactly what render.js hands it:
 *
 *   build({ mesh, texture, tint, view }) => a three material
 *
 * `mesh` is the whole declaration, `texture` is the resolved and already-tiled
 * map or null, `tint` is always a colour and is what `color` should be, and
 * `view` is the session's camera state. A builder called with a bare mesh
 * declaration instead — which is how a test calls one — reads the same keys and
 * simply has no texture to start from.
 *
 * The library that ships here is deliberately a *library* and not a house style.
 * `lambert` is the default because a flat, baked, lightmapped look is what the
 * first game on this engine wanted, but `standard`, `toon`, `matcap`, `water`
 * and `additive` are equally first-class, and `pulse` is a whole material
 * written from raw GLSL to prove that path is not an escape hatch. A game adds
 * its own with one call and never touches a file under engine/:
 *
 *   context.materials.register('hologram', ({ mesh, texture, tint }) => …)
 *   context.materials.list()
 *   node bin/engine.mjs run materials.list
 *
 * Two things about where this file sits.
 *
 * The renderer owns the GL context, so it owns the built material; this plugin
 * owns *what to build*. It hands its builders to `renderer.materials.register`
 * and, until that registry exists, says so by name rather than leaving a type
 * file's `material:` key quietly doing nothing.
 *
 * Three is loaded only where something is drawing. A headless world never calls
 * a builder — there is no renderer to call it — so it must not pay to import a
 * renderer library, and the whole registry, the declaration reading and the
 * water's animation are pure functions that work with no screen at all. That is
 * the part with logic in it, and it is the part `project/tests/materials.js`
 * checks.
 */

/**
 * The material a mesh gets when it names none.
 *
 * Lambert rather than Standard: a diffuse-only response is what a lightmapped
 * scene made of several hundred boxes wants, and it is a fraction of the cost of
 * a physically-based one. A game that wants the other look says so per mesh, or
 * registers its own material over this name.
 */
export const DEFAULT_MATERIAL = 'lambert'

/** Keys on `mesh` that describe the shape, not the surface. */
const STRUCTURAL_KEYS = new Set(['box', 'quad', 'model', 'material', 'unlit'])

// ------------------------------------------------------------------ declaring
/**
 * What a mesh declaration asks for: a name, and the parameters that go with it.
 *
 * Read in the loosest form that stays unambiguous, because a surface is tuned by
 * typing one word and a syntax that demands five is a syntax nobody edits.
 * Anything it cannot read is reported and falls back — never dropped silently.
 */
export function readMaterial(mesh, say) {
  const declared = mesh && typeof mesh === 'object' && !Array.isArray(mesh) ? mesh : {}

  // Everything that is not structural is a parameter. A material that does not
  // understand a key simply ignores it, which is what lets one mesh carry the
  // keys for the material it has and the one it is about to be changed to.
  const flat = {}
  for (const [key, value] of Object.entries(declared)) {
    if (!STRUCTURAL_KEYS.has(key)) flat[key] = value
  }

  // `unlit: true` predates this plugin and means exactly `material: 'basic'`.
  // Honouring it keeps every sky face and lamp in the project drawing the way it
  // did, rather than making a working level the price of a new feature.
  const implied = declared.unlit ? 'basic' : DEFAULT_MATERIAL
  const chosen = declared.material

  if (chosen === null || chosen === undefined) {
    return { name: implied, parameters: flat, declared: false }
  }
  if (typeof chosen === 'string') {
    const name = chosen.trim()
    if (name) return { name, parameters: flat, declared: true }
    say?.('[Materials] mesh.material is an empty name — falling back to the default')
    return { name: implied, parameters: flat, declared: false }
  }
  if (typeof chosen === 'object' && !Array.isArray(chosen)) {
    const { name, ...rest } = chosen
    const asked = typeof name === 'string' ? name.trim() : ''
    if (!asked) {
      say?.(`[Materials] mesh.material is an object with no "name" — falling back to "${implied}" and keeping its other keys as parameters`)
    }
    return { name: asked || implied, parameters: { ...flat, ...rest }, declared: !!asked }
  }

  say?.(`[Materials] mesh.material must be a name or { name, … } — got ${JSON.stringify(chosen)}`)
  return { name: implied, parameters: flat, declared: false }
}

// ------------------------------------------------------------------ the water
/**
 * How far the water has scrolled by a given moment, as a UV offset.
 *
 * A pure function of `context.time`, which is the whole reason it is pulled out
 * here: it is the animated part of an animated material, so it is the part that
 * has to be provably repeatable. Same time in, same offset out, on any machine
 * and in any run — and a headless test can check that without a GL context.
 *
 *   speed      metres of scroll per second, along `direction`
 *   direction  [u, v] on the surface; normalised here so speed means speed
 */
export function waterFlow(time, parameters = {}) {
  const speed = Number.isFinite(Number(parameters.speed)) ? Number(parameters.speed) : 0.06
  const given = Array.isArray(parameters.direction) ? parameters.direction.map(Number) : []
  const direction = given.length === 2 && given.every(Number.isFinite) && given.some(n => n !== 0)
    ? given
    : [1, 0.35]
  const length = Math.hypot(direction[0], direction[1]) || 1
  const distance = (Number(time) || 0) * speed
  return {
    u: (direction[0] / length) * distance,
    v: (direction[1] / length) * distance
  }
}

// ------------------------------------------------------------------ the library
/**
 * What ships, what each one is for, and what it will read off a mesh.
 *
 * Names and defaults live here rather than beside the builders because they are
 * the half a world with no screen can still answer: `materials.list` names every
 * surface and its knobs in a headless run, where no builder can ever be called.
 */
export const STANDARD_MATERIALS = {
  basic: {
    about: 'unlit — takes no light at all, for anything that supplies its own: a sky face, a lamp, a screen',
    parameters: { texture: null, tint: null, opacity: 1 }
  },
  lambert: {
    about: 'the default — diffuse only, cheap and flat, which is what a lightmapped scene wants',
    parameters: { texture: null, tint: null, opacity: 1, emissive: null }
  },
  standard: {
    about: 'physically based — metalness, roughness, and normal and ambient-occlusion maps',
    parameters: {
      texture: null, tint: null, metalness: 0, roughness: 0.8,
      normal: null, normalStrength: 1, ambientOcclusion: null, ambientOcclusionStrength: 1,
      emissive: null, emissiveStrength: 1, opacity: 1
    }
  },
  phong: {
    about: 'a specular highlight without the cost of a physically-based response',
    parameters: { texture: null, tint: null, shininess: 30, specular: '#111111', normal: null, opacity: 1 }
  },
  toon: {
    about: 'banded light in an adjustable number of steps, with an optional rim shade. A line of constant screen width is mesh.keyline, not this',
    parameters: { texture: null, tint: null, steps: 3, outline: 0, outlineColour: '#000000', opacity: 1 }
  },
  matcap: {
    about: 'the whole lighting model baked into one sphere image — no lights read at all',
    parameters: { matcap: null, texture: null, tint: null, opacity: 1 }
  },
  water: {
    about: 'scrolling normals on context.time, so the same second always looks the same',
    parameters: {
      texture: null, normal: null, tint: '#2e6f8e', opacity: 0.85,
      roughness: 0.15, metalness: 0.1, normalStrength: 0.6,
      speed: 0.06, direction: [1, 0.35]
    }
  },
  additive: {
    about: 'adds its light to whatever is behind it — flames, muzzle flashes, holograms',
    parameters: { texture: null, tint: '#ffffff', opacity: 1 }
  },
  pulse: {
    about: 'raw GLSL, animated by a context.time uniform — the worked example of a custom shader',
    parameters: { tint: '#39e6ff', speed: 0.6, bands: 1 }
  }
}

/**
 * Put the standard library's names, descriptions and defaults into a registry.
 *
 * Separate from building any of them, because describing a material needs no
 * renderer at all: this is what makes `materials.list` answer properly in a
 * headless run, and what lets a test check the library without a GL context.
 */
export function describeStandardLibrary(materials) {
  for (const [name, details] of Object.entries(STANDARD_MATERIALS)) {
    materials.register(name, null, { ...details, from: 'library' })
  }
  return materials
}

// ------------------------------------------------------------------ the registry
/**
 * The registry itself: names in, builders out, and one place that decides what
 * an unknown name means.
 *
 * It is a plain factory rather than plugin state so a test can make one, put a
 * material in it and ask what came back, with no world and no renderer running.
 */
export function makeMaterials({ report = () => {}, fallback = DEFAULT_MATERIAL } = {}) {
  const records = new Map()
  const problems = []

  /** Report a problem once. A level reload must not repeat what it said before. */
  const say = message => {
    if (problems.includes(message)) return message
    problems.push(message)
    report(message)
    return message
  }

  const materials = {
    problems,
    say,
    fallback,

    /** The renderer's own registry, once there is one. Null headless. */
    attached: null,

    /**
     * Add a material, or fill in the builder of one that was only described.
     *
     * `build({ mesh, texture, tint, view })` returns a material the renderer can
     * use — the same signature render.js hands its own two built-ins, because a
     * hook point only one side can use is not a hook point.
     * `details` is optional and is how the standard library carries its `about`
     * and its default parameters; a game that only passes a builder gets a
     * record with an empty description, which is fine — the name is the API.
     */
    register(name, build, details = {}) {
      const key = String(name ?? '').trim()
      if (!key) {
        say('[Materials] register() needs a name — nothing was registered')
        return null
      }
      let builder = build
      if (builder !== null && builder !== undefined && typeof builder !== 'function') {
        say(`[Materials] the builder registered for "${key}" is not a function — the name is reserved but nothing can draw it`)
        builder = null
      }
      const previous = records.get(key)
      const record = {
        name: key,
        // Registering with no builder describes a material without being able to
        // draw one, which is exactly the state a headless world is in.
        build: builder || null,
        about: details.about ?? previous?.about ?? '',
        parameters: details.parameters ?? previous?.parameters ?? {},
        from: details.from ?? previous?.from ?? 'game'
      }
      records.set(key, record)
      // A material registered after the renderer has already taken the library
      // still has to reach it, or a game plugin's own surface would work only if
      // it happened to load before the screen did.
      if (materials.attached && record.build) {
        try {
          materials.attached.register(record.name, record.build)
        } catch (error) {
          say(`[Materials] the renderer refused "${record.name}" — ${error?.message || error}`)
        }
      }
      return record
    },

    get: name => records.get(String(name ?? '').trim()) || null,
    has: name => records.has(String(name ?? '').trim()),
    records: () => [...records.values()],

    list: () => [...records.values()]
      .map(record => ({
        name: record.name,
        about: record.about,
        parameters: record.parameters,
        from: record.from,
        // Whether anything can actually be built from it right now. False in a
        // headless world for every material, and that is not a fault.
        drawable: !!record.build
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),

    /**
     * What a mesh declaration resolves to, and the fallback when it names
     * something nobody registered.
     *
     * A misspelt material used to be the perfect silent failure — the surface
     * draws, it draws wrong, and nothing anywhere says which word was wrong. So
     * the fallback is reported by name, with the list of names that would have
     * worked, and the caller is told both what it asked for and what it got.
     */
    resolve(mesh) {
      const asked = readMaterial(mesh, say)
      const record = records.get(asked.name)
      if (record) {
        return { name: asked.name, asked: asked.name, parameters: asked.parameters, record }
      }
      say(`[Materials] no material named "${asked.name}" — falling back to "${fallback}". Registered: ${[...records.keys()].join(', ') || 'none'}`)
      return {
        name: fallback,
        asked: asked.name,
        parameters: asked.parameters,
        record: records.get(fallback) || null
      }
    },

    /**
     * Resolve and build in one call.
     *
     * `request` is what render.js hands a builder — `{ mesh, texture, tint, view }`
     * — or, for a caller that has nothing resolved yet, the mesh declaration on
     * its own. Returns null when nothing can be built, which is every case in a
     * headless world and is the caller's cue to use whatever it would have used
     * before this plugin existed.
     */
    build(request) {
      const given = request && typeof request === 'object' ? request : {}
      const chosen = materials.resolve(given.mesh ? given.mesh : given)
      if (!chosen.record?.build) return null
      try {
        // The parameters travel with the request so the builder does not read
        // the same declaration a second time.
        return chosen.record.build({ ...given, parameters: chosen.parameters })
      } catch (error) {
        say(`[Materials] building "${chosen.name}" failed — ${error?.message || error}`)
        return null
      }
    }
  }

  return materials
}

// ------------------------------------------------------------------ the plugin
/**
 * Materials that want the clock, and the frame that gives it to them.
 *
 * A builder puts its material in here with the function that advances it; the
 * frame system calls every one of them with `context.time`. Three's materials
 * are event dispatchers, so a material that the renderer disposes takes itself
 * back out — otherwise this set would grow for the life of the page and go on
 * animating surfaces nobody is drawing.
 */
const animated = new Set()

function animate(material, advance) {
  material.userData.advance = advance
  animated.add(material)
  material.addEventListener('dispose', () => animated.delete(material))
}

export default {
  name: 'Materials',

  category: 'visuals',
  onLoad(context) {
    const materials = makeMaterials({ report: message => console.error(message) })
    context.materials = materials

    // Described first, built later. The names, the descriptions and the default
    // parameters are true with or without a screen, so `materials.list` answers
    // properly in a headless run instead of reporting an empty library.
    describeStandardLibrary(materials)

    // Three is a renderer library, and a world with nothing drawing must never
    // pay to load one — ten headless agents each importing it is ten times a
    // cost none of them can use. `document` is the honest test for "is anything
    // going to draw", and it is the same guard world-look.js uses for its sky.
    if (typeof document !== 'undefined') {
      Promise.all([import('three'), import('../../engine/ui.js')])
        .then(([THREE, { assetURL }]) => {
          const builders = buildersFor(THREE, assetURL, materials)
          for (const [name, build] of Object.entries(builders)) {
            materials.register(name, build, { ...STANDARD_MATERIALS[name], from: 'library' })
          }
          handOver(context, materials)
        })
        .catch(error => {
          console.error('[Materials] three did not load, so no material can be built —', error?.message || error)
        })
    }

    // The renderer is attached after every plugin has loaded, so the library
    // cannot be handed over here. Both events fire after it exists, and
    // handing over twice is free.
    context.bus.on('shell:ready', () => handOver(context, materials))
    context.bus.on('level:loaded', () => handOver(context, materials))
  },

  systems: [{
    // Frame, not fixed: this moves a texture offset and changes no game value,
    // so it must not cost the simulation anything. It is still fed by
    // `context.time`, which is the fixed clock, so what it shows at a given
    // moment is the same in every run.
    phase: 'frame',
    run(world, seconds, context) {
      if (!animated.size) return
      const time = context.time
      for (const material of animated) {
        try {
          material.userData.advance(time)
        } catch (error) {
          animated.delete(material)
          console.error('[Materials] an animated material threw and was stopped —', error?.message || error)
        }
      }
    }
  }],

  commands: [{
    id: 'materials.list',
    label: 'Every registered material, and what it reads off a mesh',
    run: context => ({
      default: context.materials.fallback,
      drawing: !!context.renderer,
      handedToTheRenderer: !!context.materials.attached,
      // What the renderer itself will answer to, which is the question behind
      // "my material is registered and it still draws lambert".
      theRendererKnows: context.renderer?.materials?.names ?? null,
      animating: animated.size,
      materials: context.materials.list(),
      problems: context.materials.problems
    })
  }]
}

/**
 * Give the library to the renderer.
 *
 * `renderer.materials` is the kernel's per-name registry. Having no renderer is
 * not a fault — that is what headless is — but having one that cannot take a
 * material is, because it means every `material:` key in the project is being
 * read, resolved, and then thrown away without a word.
 */
function handOver(context, materials) {
  if (materials.attached) return true
  const renderer = context.renderer
  if (!renderer) return false

  const registry = renderer.materials
  if (!registry || typeof registry.register !== 'function') {
    materials.say('[Materials] this renderer has no materials registry, so every mesh draws with the renderer\'s own default and a "material" declared on a type does nothing')
    return false
  }

  materials.attached = registry
  for (const record of materials.records()) {
    if (!record.build) continue
    try {
      registry.register(record.name, record.build)
    } catch (error) {
      materials.say(`[Materials] the renderer refused "${record.name}" — ${error?.message || error}`)
    }
  }
  // `context.materials.build(request)` is the other half of this: it is the only
  // call that knows what an unknown name means, so anything routed through it
  // falls back with a report. render.js reports its own unknown names, which is
  // the same promise kept in the other place.
  return true
}
// ------------------------------------------------------------------ the builders
/**
 * Every standard material, built against a three that is now certainly loaded.
 *
 * A builder is `build({ mesh, texture, tint, view })` — exactly what render.js
 * hands its own two built-ins. Nothing here requires any single key of it: a
 * builder that breaks the first time somebody changes the renderer is a builder
 * that has quietly made this plugin part of the kernel.
 */
function buildersFor(THREE, assetURL, materials) {
  const say = materials.say

  const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

  /**
   * A colour three will take, or the fallback — and said out loud either way.
   *
   * A mistyped colour is precisely the failure this engine refuses to allow:
   * three warns in its own voice, stays white, and the author reads their own
   * file three times looking for the missing hash.
   */
  const colour = (value, fallback, where) => {
    if (value === null || value === undefined) return fallback === null ? null : new THREE.Color(fallback)
    if (typeof value === 'number') return new THREE.Color(value)
    const text = String(value).trim().toLowerCase()
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text) || text in THREE.Color.NAMES) return new THREE.Color(text)
    say(`[Materials] "${value}" is not a colour ${where} can use — using ${fallback ?? 'the default'} instead`)
    return fallback === null ? null : new THREE.Color(fallback)
  }

  /**
   * What a build request actually says, whichever way it arrived.
   *
   * render.js hands `{ mesh, texture, tint, view }`. Anything with no `mesh` key
   * is the declaration itself, which is how a test — or a plugin holding a
   * declaration and no renderer — calls a builder directly and simply starts
   * with no resolved texture.
   */
  const surfaceOf = request => {
    const given = request && typeof request === 'object' ? request : {}
    const fromRenderer = !!(given.mesh && typeof given.mesh === 'object')
    return {
      parameters: given.parameters || readMaterial(fromRenderer ? given.mesh : given, say).parameters,
      // Already resolved, already tiled, already cached and already reported if
      // it 404d. There is exactly one texture cache in this engine and it is not
      // in this file.
      map: fromRenderer ? (given.texture || null) : null,
      tint: fromRenderer ? (given.tint || null) : null,
      view: given.view || null
    }
  }

  /**
   * A second map — a normal, a matcap, an occlusion bake.
   *
   * The renderer resolves one texture per mesh, which is the one the colour
   * comes from, so anything a physically-based or a matcap surface needs beyond
   * it is loaded here. It matches the main map's repeat rather than working the
   * tiling out again, because a normal map that tiles differently from the
   * albedo it belongs to is worse than no normal map at all.
   */
  const extraTextures = new Map()
  const extraTexture = (source, main, { linear = false } = {}) => {
    if (!source) return null
    const name = String(source)
    const key = `${linear ? 'data' : 'colour'}:${name}`
    let texture = extraTextures.get(key)
    if (!texture) {
      const url = assetURL(name)
      texture = new THREE.TextureLoader().load(url, undefined, undefined, () => {
        // A texture that 404s must never be a surface that quietly draws flat.
        console.error(`[Materials] missing texture ${url} (referenced as "${name}")`)
      })
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping
      texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.magFilter = THREE.LinearFilter
      texture.anisotropy = 8
      // A normal, roughness or occlusion map carries numbers rather than colour,
      // and reading one through sRGB is the classic reason a normal map looks
      // almost right and never quite.
      texture.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace
      extraTextures.set(key, texture)
    }
    // One copy per surface, because repeat and offset live on the texture and
    // two surfaces that tile — or scroll — differently must not share one.
    const own = texture.clone()
    own.needsUpdate = true
    if (main) own.repeat.copy(main.repeat)
    return own
  }

  /** The keys every surface shares, applied in one place so they cannot drift. */
  const common = (material, surface) => {
    if (surface.map) material.map = surface.map
    // `tint` is always a colour by the time it gets here, and it is already the
    // declared tint, or white behind a texture, or the stable per-type colour
    // for an untextured mesh — three answers this plugin must not second-guess.
    if (surface.tint) material.color = surface.tint
    const opacity = number(surface.parameters.opacity, 1)
    if (opacity < 1) {
      material.opacity = opacity
      material.transparent = true
    }
    return material
  }

  /**
   * The banding a toon material reads its light through.
   *
   * One pixel per step, sampled with no filtering, which is the whole trick:
   * three looks the light up in this strip, so a three-pixel strip is three
   * bands. Cached by step count because a map of a hundred toon walls is one or
   * two distinct answers.
   */
  const gradients = new Map()
  const toonGradient = steps => {
    const bands = Math.min(16, Math.max(2, Math.round(number(steps, 3))))
    if (gradients.has(bands)) return gradients.get(bands)
    const data = new Uint8Array(bands)
    for (let step = 0; step < bands; step++) data[step] = Math.round((step / (bands - 1)) * 255)
    const gradient = new THREE.DataTexture(data, bands, 1, THREE.RedFormat)
    gradient.minFilter = THREE.NearestFilter
    gradient.magFilter = THREE.NearestFilter
    gradient.needsUpdate = true
    gradients.set(bands, gradient)
    return gradient
  }

  /**
   * A rim shade, patched into the toon shader.
   *
   * It darkens where the surface turns away from the eye. That is a shade on
   * the surface, measured in geometry, so it thins with distance and is under a
   * pixel at play zoom. The line that stays the same width at every distance is
   * `mesh.keyline`, which render.js draws as a second mesh — something a
   * material builder cannot do, since it returns one material.
   */
  const outline = (material, width, outlineColour) => {
    material.onBeforeCompile = shader => {
      shader.uniforms.outlineWidth = { value: Math.min(1, Math.max(0, width)) }
      shader.uniforms.outlineColour = { value: outlineColour }
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float outlineWidth;\nuniform vec3 outlineColour;')
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          float rim = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, outlineColour, smoothstep(1.0 - outlineWidth, 1.0, rim));`)
    }
    // Two materials whose GLSL differs must not share a compiled program.
    material.customProgramCacheKey = () => `toon-outline:${width}:${outlineColour.getHexString()}`
  }

  return {
    basic: request =>
      common(new THREE.MeshBasicMaterial({ depthTest: true, depthWrite: true, side: THREE.FrontSide }), surfaceOf(request)),

    lambert: request => {
      const surface = surfaceOf(request)
      const material = common(new THREE.MeshLambertMaterial({ depthTest: true, depthWrite: true, side: THREE.FrontSide }), surface)
      const emissive = colour(surface.parameters.emissive, null, 'lambert.emissive')
      if (emissive) material.emissive = emissive
      return material
    },

    standard: request => {
      const surface = surfaceOf(request)
      const { parameters } = surface
      const material = common(new THREE.MeshStandardMaterial({ depthTest: true, depthWrite: true, side: THREE.FrontSide }), surface)
      material.metalness = number(parameters.metalness, 0)
      material.roughness = number(parameters.roughness, 0.8)

      const normal = extraTexture(parameters.normal, surface.map, { linear: true })
      if (normal) {
        material.normalMap = normal
        const strength = number(parameters.normalStrength, 1)
        material.normalScale = new THREE.Vector2(strength, strength)
      }
      const occlusion = extraTexture(parameters.ambientOcclusion, surface.map, { linear: true })
      if (occlusion) {
        material.aoMap = occlusion
        material.aoMapIntensity = number(parameters.ambientOcclusionStrength, 1)
      }
      const emissive = colour(parameters.emissive, null, 'standard.emissive')
      if (emissive) {
        material.emissive = emissive
        material.emissiveIntensity = number(parameters.emissiveStrength, 1)
      }
      return material
    },

    phong: request => {
      const surface = surfaceOf(request)
      const { parameters } = surface
      const material = common(new THREE.MeshPhongMaterial({ depthTest: true, depthWrite: true, side: THREE.FrontSide }), surface)
      material.shininess = number(parameters.shininess, 30)
      material.specular = colour(parameters.specular, '#111111', 'phong.specular')
      const normal = extraTexture(parameters.normal, surface.map, { linear: true })
      if (normal) material.normalMap = normal
      return material
    },

    toon: request => {
      const surface = surfaceOf(request)
      const { parameters } = surface
      const material = common(new THREE.MeshToonMaterial({ depthTest: true, depthWrite: true, side: THREE.FrontSide }), surface)
      material.gradientMap = toonGradient(parameters.steps)
      const width = number(parameters.outline, 0)
      if (width > 0) {
        outline(material, width, colour(parameters.outlineColour ?? parameters.outlineColor, '#000000', 'toon.outlineColour'))
      }
      return material
    },

    matcap: request => {
      const surface = surfaceOf(request)
      const material = common(new THREE.MeshMatcapMaterial({ depthTest: true, depthWrite: true, side: THREE.FrontSide }), surface)
      const matcap = extraTexture(surface.parameters.matcap, null)
      if (matcap) material.matcap = matcap
      else say('[Materials] a matcap material with no "matcap" image has no lighting model to read — it will draw as a flat colour')
      return material
    },

    /**
     * Water: two texture layers sliding across each other, driven by the clock.
     *
     * The offset comes from `waterFlow(context.time, parameters)`, a pure
     * function, so the surface at 4.5 seconds is the same in a screenshot, in a
     * replay and in the next run. Nothing here reads a wall clock, and nothing
     * accumulates — an offset built by adding a delta every frame would drift
     * apart between two runs that happened to step differently.
     */
    water: request => {
      const surface = surfaceOf(request)
      const { parameters } = surface
      const material = new THREE.MeshStandardMaterial({ depthTest: true, depthWrite: true, side: THREE.FrontSide })

      // Only a declared tint is honoured, because the renderer's fallback for an
      // untextured mesh is a stable per-type colour — and water that is a
      // different colour in every level that names its water type differently is
      // not water.
      const declaredTint = parameters.tint ?? parameters.color ?? parameters.colour
      material.color = declaredTint != null && surface.tint ? surface.tint : colour(declaredTint, '#2e6f8e', 'water')
      material.roughness = number(parameters.roughness, 0.15)
      material.metalness = number(parameters.metalness, 0.1)
      material.opacity = number(parameters.opacity, 0.85)
      material.transparent = material.opacity < 1

      // The scroll is an offset on the texture, so both layers are this
      // material's own copies and never one shared with a still surface.
      if (surface.map) {
        material.map = surface.map.clone()
        material.map.needsUpdate = true
      }
      const normal = extraTexture(parameters.normal, surface.map, { linear: true })
      if (normal) {
        material.normalMap = normal
        const strength = number(parameters.normalStrength, 0.6)
        material.normalScale = new THREE.Vector2(strength, strength)
      } else {
        say('[Materials] water with no "normal" image has nothing to scroll — it will draw as flat tinted glass')
      }

      animate(material, time => {
        const flow = waterFlow(time, parameters)
        if (material.normalMap) material.normalMap.offset.set(flow.u, flow.v)
        // The second layer runs the other way and slower, which is what stops
        // one scrolling texture from reading as a sliding poster.
        if (material.map) material.map.offset.set(-flow.u * 0.6, -flow.v * 0.6)
      })
      return material
    },

    additive: request => {
      const material = common(new THREE.MeshBasicMaterial({ depthTest: true, side: THREE.FrontSide }), surfaceOf(request))
      material.blending = THREE.AdditiveBlending
      material.transparent = true
      // Adding light to what is behind means never hiding it, so depth is tested
      // but not written — two flashes overlapping must both show.
      material.depthWrite = false
      return material
    },

    /**
     * Written from raw GLSL, on purpose.
     *
     * This is the worked example of the custom-shader path, and it is registered
     * through exactly the call a game would use — `materials.register(name,
     * build)` — with no privilege of any kind. The `time` uniform is fed from
     * `context.time` by the frame system above, which is how a game animates a
     * shader deterministically: never a wall clock, never an accumulator.
     */
    pulse: request => {
      const { parameters } = surfaceOf(request)
      const material = new THREE.ShaderMaterial({
        uniforms: {
          tint: { value: colour(parameters.tint ?? parameters.color, '#39e6ff', 'pulse') },
          time: { value: 0 },
          speed: { value: number(parameters.speed, 0.6) },
          bands: { value: number(parameters.bands, 1) }
        },
        vertexShader: PULSE_VERTEX,
        fragmentShader: PULSE_FRAGMENT,
        side: THREE.FrontSide
      })
      animate(material, time => { material.uniforms.time.value = time })
      return material
    }
  }
}

/**
 * The whole of the example shader, kept as two strings so there is nothing
 * clever between what is written here and what the card compiles.
 */
const PULSE_VERTEX = `
  varying vec2 vSurface;
  void main() {
    vSurface = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const PULSE_FRAGMENT = `
  uniform vec3 tint;
  uniform float time;
  uniform float speed;
  uniform float bands;
  varying vec2 vSurface;
  void main() {
    // uv is measured in metres by this renderer, so a band is a metre wide and
    // the wave travels at speed metres per second whatever the mesh's size.
    float wave = 0.5 + 0.5 * sin((time * speed - vSurface.y * bands) * 6.2831853);
    gl_FragColor = vec4(tint * (0.35 + 0.65 * wave), 1.0);
  }
`
