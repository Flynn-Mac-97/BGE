/**
 * Post Processing — what happens to the picture after the scene is drawn.
 *
 * Declared in the level, beside the sky and the fog, because how a place is
 * graded is a fact about the place:
 *
 *   "world": {
 *     "post": [ { "smaa": true },
 *               { "bloom": { "strength": 0.35, "threshold": 0.9 } },
 *               { "ssao": { "radius": 0.4 } },
 *               { "grade": { "contrast": 1.05, "saturation": 0.9, "tint": "#ffe8c0" } },
 *               { "vignette": 0.25 } ]
 *   }
 *
 * A bare value is the one number that effect is usually about — `"vignette": 0.25`
 * is how much, `"bloom": 0.4` is how strong — and `true` means "on, with the
 * defaults". A whole chain can also be named:
 *
 *   "post": "clean"        smaa, a whisper of bloom, a slightly warm grade
 *   "post": "cinematic"    the heavy modern one: ssao, bloom, grade, vignette
 *   "post": "retro"        no antialiasing at all, punchy contrast, hard vignette
 *   "post": "none"         nothing, and nothing built
 *
 * Those presets are the visible difference between what this engine *can* do and
 * what one game *wants*. The first game built on it wants almost none of this —
 * edges cleaned up, a hint of warmth, and a whisper of bloom so a muzzle flash
 * blooms; that is `clean`, and it is one preset among several rather than the
 * only way the engine knows how to look.
 *
 * Tunable from a terminal, so finding the numbers is a round trip rather than an
 * edit and a reload:
 *
 *   node bin/engine.mjs run post.chain
 *   node bin/engine.mjs run post.chain cinematic
 *   node bin/engine.mjs run post.chain '[{"bloom":{"strength":0.5}},{"vignette":0.4}]'
 *
 * NO NEW DEPENDENCY. EffectComposer and every pass used here already ship inside
 * the installed `three` package, under `three/examples/jsm/postprocessing/` and
 * `three/examples/jsm/shaders/`. The next agent to read this will assume a
 * postprocessing library was added; none was, and none should be.
 *
 * WHAT AN EMPTY CHAIN COSTS: nothing, and that is enforced three ways.
 *   1. This plugin contributes no systems. There is no per-frame work to skip,
 *      because there is none to begin with — it is `onLoad`, one bus listener
 *      and one command.
 *   2. Every pass module, and three itself, sit behind a dynamic `import()`
 *      inside the build path. A game with no chain never downloads them.
 *   3. `renderer.passes.set` is only called when there is something to set, or
 *      something previously set to tear down. A renderer that has never been
 *      handed a pass never makes a composer and never allocates a render target,
 *      so the frame time is exactly what it was before this file existed.
 * A post-processing plugin that taxes every game that does not use it is a bad
 * plugin, and "it only costs one branch per frame" is how that starts.
 *
 * WHERE THE COMPOSER LIVES: not here. `renderer.passes.set(list)` takes an
 * ordered list and has, in its own words, no opinion whatever about what the
 * passes do. The renderer owns the GL context, the render targets, the resize
 * and the RenderPass at the front — it has to, because this engine switches
 * between an orthographic and a perspective camera and only the renderer knows
 * which is drawing. Everything after that first pass is this plugin's: the
 * effects the level asked for, in the order it wrote them, and an OutputPass to
 * close the chain. That last one is not optional and is not the renderer's job:
 * a composer works in linear light, and without a final tone-map-and-encode step
 * the picture reaches the canvas unencoded and every colour comes out wrong.
 */

/** Where a whole look can be named instead of spelled out. */
const PRESETS = {
  none: [],

  /**
   * Almost nothing, which is the right answer far more often than it looks.
   *
   * Edges cleaned up, a warm cast of about two percent, and bloom set so high
   * that only something genuinely emissive — a flash, a lamp, the sun on a
   * window — ever crosses the threshold. Everything else passes through
   * untouched, which is what keeps a flat lightmapped scene reading as flat.
   */
  clean: [
    { smaa: true },
    { bloom: { strength: 0.12, radius: 0.3, threshold: 0.95 } },
    { grade: { contrast: 1.02, tint: '#ffe8c0' } }
  ],

  /** The heavy modern one — contact shadows, real bloom, a graded and vignetted frame. */
  cinematic: [
    { smaa: true },
    { ssao: { radius: 0.4 } },
    { bloom: { strength: 0.35, radius: 0.5, threshold: 0.85 } },
    { grade: { contrast: 1.06, saturation: 0.95, tint: '#ffe8c0' } },
    { vignette: 0.3 }
  ],

  /** The flat one. No antialiasing on purpose: hard pixels are the look. */
  retro: [
    { grade: { contrast: 1.12, saturation: 0.85 } },
    { vignette: 0.45 }
  ]
}

/**
 * Every effect, what it is for, and which number a bare value means.
 *
 * `bare` is the whole reason `{ "vignette": 0.25 }` works: one effect is usually
 * about one number, and a syntax that makes you name it every time is a syntax
 * nobody tunes.
 */
const EFFECTS = {
  smaa: {
    about: 'subpixel antialiasing — cleans edges without softening the whole picture',
    bare: null,
    defaults: {}
  },
  bloom: {
    about: 'light bleeding out of the brightest parts of the frame',
    bare: 'strength',
    defaults: { strength: 0.35, radius: 0.4, threshold: 0.9 }
  },
  ssao: {
    // Its strength is its radius — there is no separate amount to turn up, which
    // is why `radius` is the bare number and the other two are rarely touched.
    about: 'contact shadow in the creases, worked out from depth; radius is how far it reaches, in metres',
    bare: 'radius',
    defaults: { radius: 0.4, bias: 0.005, range: 0.1 }
  },
  grade: {
    about: 'contrast, saturation, brightness and a colour cast over the whole frame',
    bare: 'contrast',
    defaults: { contrast: 1, saturation: 1, brightness: 0, tint: '#ffffff' }
  },
  vignette: {
    about: 'darkening towards the corners',
    bare: 'amount',
    defaults: { amount: 0.25, offset: 1 }
  }
}

export default {
  name: 'Post Processing',

  onLoad(context) {
    const post = {
      declared: null,       // the level's "post", exactly as it was written
      chosen: null,         // what post.set picked this session — never written to disk
      resolved: [],         // the effects, read and defaulted
      built: 0,             // how many passes the renderer is actually holding
      status: 'off',
      request: 0,           // which build is the current one
      said: new Set(),      // problems already reported, so a reload does not repeat them

      /**
       * Change the chain for this session. Takes the same shapes the level
       * file does — an array, or the name of a preset. `null` hands the chain
       * back to whatever the level said, so a session of tuning is undoable
       * without reloading the level.
       */
      set(chain) {
        post.chosen = chain === null || chain === undefined ? null : chain
        return apply(context, post)
      },

      report: () => report(context, post)
    }
    context.post = post

    // The level's world block is the rule; re-read it whenever a level loads,
    // and drop whatever post.set chose — the file has just had the last word.
    context.bus.on('level:loaded', async name => {
      try {
        const raw = JSON.parse(await context.files.read(`levels/${name}.json`))
        post.declared = raw.world?.post ?? null
      } catch (error) {
        post.declared = null
        console.error(`[Post Processing] could not read the world block of levels/${name}.json —`, error.message)
      }
      post.chosen = null
      await apply(context, post)
    })
  },

  commands: [{
    id: 'post.chain',
    label: 'What the picture is being put through, and what else it could be',
    // args: nothing to read it, a preset name or a chain to set it, `null` to
    // hand it back to the level.
    run: (context, args) => {
      const post = context.post
      if (args === undefined) return post.report()
      return post.set(args)
    }
  }]
}

// ------------------------------------------------------------------ resolving
/**
 * The chain the level or the session asked for, read into a flat list.
 *
 * Every unreadable thing here is reported and skipped rather than dropped: a
 * misspelt effect name is exactly the silent failure this engine refuses — the
 * picture draws, it draws without the effect, and nothing says which word was
 * wrong.
 */
export function resolveChain(value, say) {
  if (value === null || value === undefined || value === false) return []

  if (typeof value === 'string') {
    const name = value.trim()
    const preset = PRESETS[name]
    if (!preset) {
      say(`[Post Processing] no preset named "${name}" — one of ${Object.keys(PRESETS).join(', ')}. Nothing is being applied`)
      return []
    }
    return resolveChain(preset, say)
  }

  if (!Array.isArray(value)) {
    say(`[Post Processing] "post" must be a list of effects or the name of a preset — got ${JSON.stringify(value)}`)
    return []
  }

  const out = []
  for (const item of value) {
    if (item === null || item === undefined || item === false) continue

    // A bare name: `"post": ["smaa", "vignette"]`.
    if (typeof item === 'string') {
      const effect = readEffect(item.trim(), true, say)
      if (effect) out.push(effect)
      continue
    }
    if (typeof item !== 'object' || Array.isArray(item)) {
      say(`[Post Processing] an effect must be a name or { name: options } — got ${JSON.stringify(item)}`)
      continue
    }
    // One key per object is how the example reads, but an object with several is
    // unambiguous and reads fine too, so both work and order is written order.
    for (const [name, options] of Object.entries(item)) {
      const effect = readEffect(name, options, say)
      if (effect) out.push(effect)
    }
  }
  return out
}

/** One effect: a known name, and its options widened from whatever was written. */
function readEffect(name, options, say) {
  const known = EFFECTS[name]
  if (!known) {
    say(`[Post Processing] no effect named "${name}" — one of ${Object.keys(EFFECTS).join(', ')}`)
    return null
  }
  // `false` turns an effect off, which is how a preset is trimmed rather than
  // retyped: `["cinematic"]` cannot be edited, but a chain with `{ ssao: false }`
  // in it can.
  if (options === false || options === null || options === undefined) return null

  const given = {}
  if (options === true) {
    // Nothing to read; the defaults are the whole answer.
  } else if (typeof options === 'number' || typeof options === 'string') {
    if (!known.bare) {
      say(`[Post Processing] "${name}" has no single number to set — write it as { "${name}": { … } } or true`)
    } else {
      given[known.bare] = options
    }
  } else if (typeof options === 'object' && !Array.isArray(options)) {
    for (const [key, value] of Object.entries(options)) {
      if (!(key in known.defaults)) {
        say(`[Post Processing] "${name}" has no option "${key}" — one of ${Object.keys(known.defaults).join(', ') || 'none'}`)
        continue
      }
      given[key] = value
    }
  } else {
    say(`[Post Processing] the options for "${name}" must be a number, true, or an object — got ${JSON.stringify(options)}`)
  }

  return { effect: name, options: { ...known.defaults, ...given } }
}

// ------------------------------------------------------------------ applying
/**
 * Work out the chain and hand it to the renderer.
 *
 * The early returns are the cost guarantee: with nothing declared this function
 * touches no module, allocates no target and, unless it is tearing something
 * down, does not even call the renderer.
 */
async function apply(context, post) {
  post.resolved = resolveChain(post.chosen ?? post.declared, message => sayOnce(post, message))
  // Which build this is. A level can load while the pass modules are still in
  // flight, and the chain that arrives second must be the one that wins.
  const request = ++post.request

  const renderer = context.renderer
  if (!renderer) {
    // Headless. The level's choice is still resolved and still reported, so
    // `post.chain` answers with the chain it would have built.
    post.built = 0
    post.status = 'nothing is drawing'
    return post.report()
  }

  const passes = renderer.passes
  if (!passes || typeof passes.set !== 'function') {
    post.built = 0
    post.status = 'this renderer has no pass registry'
    if (post.resolved.length) {
      sayOnce(post, '[Post Processing] this renderer has no passes registry, so the level\'s "post" chain was read and then thrown away — nothing is being applied to the picture')
    }
    return post.report()
  }

  if (!post.resolved.length) {
    // Nothing asked for. Only say so if something was there before, or a game
    // with no chain would be handed an empty list on every level load for no
    // reason at all.
    if (post.built) {
      passes.set([])
      post.built = 0
    }
    post.status = 'off'
    return post.report()
  }

  let built = []
  try {
    built = await buildPasses(context, post)
  } catch (error) {
    post.status = 'failed'
    sayOnce(post, `[Post Processing] the chain could not be built, so the picture is unprocessed — ${error?.message || error}`)
    return post.report()
  }

  if (request !== post.request) {
    // A newer chain has already been asked for; this one is stale.
    for (const pass of built) pass.dispose?.()
    return post.report()
  }

  passes.set(built)
  post.built = built.length
  post.status = built.length ? 'on' : 'off'
  return post.report()
}

/**
 * The passes themselves.
 *
 * Imported here rather than at the top of the file: this is the only path that
 * needs them, and a level with no chain — or a world with no screen — must not
 * pay to load a renderer library it will never call. All of it comes out of the
 * installed `three` package; nothing was added to package.json for this.
 */
async function buildPasses(context, post) {
  const [THREE, { ShaderPass }] = await Promise.all([
    import('three'),
    import('three/examples/jsm/postprocessing/ShaderPass.js')
  ])

  const size = context.renderer?.size || { w: 1280, h: 720 }
  const width = Math.max(1, Math.round(size.w))
  const height = Math.max(1, Math.round(size.h))

  const built = []
  for (const { effect, options } of post.resolved) {
    built.push(await buildOne(effect, options, {
      THREE, ShaderPass, width, height, context, post
    }))
  }

  const passes = built.filter(Boolean)
  if (!passes.length) return passes

  // Closing the chain. A composer works in linear light and the canvas expects
  // it encoded, so without this the whole picture arrives washed out — the exact
  // failure that reads as "post-processing broke the colours" and sends somebody
  // looking at the grade. It is added here rather than in the renderer because
  // the renderer only draws through a composer when this plugin gives it one.
  const { OutputPass } = await import('three/examples/jsm/postprocessing/OutputPass.js')
  passes.push(new OutputPass())
  return passes
}

async function buildOne(effect, options, tools) {
  const { THREE, ShaderPass, width, height, context } = tools
  const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

  if (effect === 'smaa') {
    const { SMAAPass } = await import('three/examples/jsm/postprocessing/SMAAPass.js')
    return new SMAAPass(width, height)
  }

  if (effect === 'bloom') {
    const { UnrealBloomPass } = await import('three/examples/jsm/postprocessing/UnrealBloomPass.js')
    return new UnrealBloomPass(
      new THREE.Vector2(width, height),
      number(options.strength, 0.35),
      number(options.radius, 0.4),
      number(options.threshold, 0.9)
    )
  }

  if (effect === 'ssao') {
    const { SSAOPass } = await import('three/examples/jsm/postprocessing/SSAOPass.js')
    const renderer = context.renderer
    const pass = new SSAOPass(renderer.scene, renderer.camera, width, height)
    pass.kernelRadius = number(options.radius, 0.4)
    // Below the bias, two surfaces are treated as the same surface; above the
    // range, they are treated as unrelated. Both are in metres, like everything
    // else in this engine.
    pass.minDistance = number(options.bias, 0.005)
    pass.maxDistance = Math.max(pass.minDistance + 0.001, number(options.range, 0.1))
    // `renderer.camera` is a getter: this engine draws a level through an
    // orthographic camera while editing and a perspective one while playing, and
    // a pass that captured whichever existed at build time would sample the
    // wrong depth the moment play was pressed. Reading it live costs nothing and
    // is the only way one pass survives the switch.
    Object.defineProperty(pass, 'camera', {
      get: () => renderer.camera,
      // Nothing sets it, but a silently-swallowed assignment beats a throw from
      // inside a pass three might one day change.
      set: () => {},
      configurable: true
    })
    return pass
  }

  if (effect === 'grade') {
    // Three ships a brightness/contrast shader, a hue/saturation shader and a
    // colorify shader — three passes and three full-screen reads to say one
    // thing. One shader that does all of it is cheaper and is still no new
    // dependency: it is a plain uniforms/vertex/fragment object handed to three's
    // own ShaderPass.
    const pass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        contrast: { value: number(options.contrast, 1) },
        saturation: { value: number(options.saturation, 1) },
        brightness: { value: number(options.brightness, 0) },
        tint: { value: readColour(THREE, options.tint, '#ffffff', 'grade.tint', tools.post) }
      },
      vertexShader: SCREEN_VERTEX,
      fragmentShader: GRADE_FRAGMENT
    })
    return pass
  }

  if (effect === 'vignette') {
    const { VignetteShader } = await import('three/examples/jsm/shaders/VignetteShader.js')
    const pass = new ShaderPass(VignetteShader)
    pass.uniforms.darkness.value = number(options.amount, 0.25) * 4
    pass.uniforms.offset.value = number(options.offset, 1)
    return pass
  }

  return null
}

/** A colour three will take, or the fallback — reported either way. */
function readColour(THREE, value, fallback, where, post) {
  if (value === null || value === undefined) return new THREE.Color(fallback)
  if (typeof value === 'number') return new THREE.Color(value)
  const text = String(value).trim().toLowerCase()
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text) || text in THREE.Color.NAMES) return new THREE.Color(text)
  if (post) sayOnce(post, `[Post Processing] "${value}" is not a colour ${where} can use — using ${fallback}`)
  return new THREE.Color(fallback)
}

// ------------------------------------------------------------------ the shaders
const SCREEN_VERTEX = `
  varying vec2 vScreen;
  void main() {
    vScreen = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/**
 * Brightness, then contrast about mid grey, then saturation about luminance,
 * then the cast. That order matters: grading after a contrast curve is what a
 * warm tint is supposed to be, and doing it the other way round tints the
 * shadows as hard as the highlights.
 */
const GRADE_FRAGMENT = `
  uniform sampler2D tDiffuse;
  uniform float contrast;
  uniform float saturation;
  uniform float brightness;
  uniform vec3 tint;
  varying vec2 vScreen;
  void main() {
    vec4 texel = texture2D(tDiffuse, vScreen);
    vec3 graded = texel.rgb + brightness;
    graded = (graded - 0.5) * contrast + 0.5;
    float luminance = dot(graded, vec3(0.2126, 0.7152, 0.0722));
    graded = mix(vec3(luminance), graded, saturation);
    graded *= tint;
    gl_FragColor = vec4(clamp(graded, 0.0, 1.0), texel.a);
  }
`

// ------------------------------------------------------------------ reporting
function sayOnce(post, message) {
  if (post.said.has(message)) return
  post.said.add(message)
  console.error(message)
}

/**
 * "Why does this level look like that" has to be answerable from a terminal.
 *
 * So this reports what is running, what the level actually asked for, what else
 * it could have asked for, and the plain fact that nothing is drawing — which is
 * the commonest reason of all for a chain having no visible effect.
 */
function report(context, post) {
  return {
    level: context.level(),
    drawing: !!context.renderer,
    status: post.status,
    passes: post.built,
    chain: post.resolved.map(({ effect, options }) => ({ effect, ...options })),
    declared: post.declared,
    chosenThisSession: post.chosen,
    presets: Object.keys(PRESETS),
    effects: Object.fromEntries(Object.entries(EFFECTS).map(([name, e]) => [name, e.about])),
    notes: notes(context, post)
  }
}

function notes(context, post) {
  const out = []
  if (!context.renderer) {
    out.push('nothing is drawing this world, so the chain is worked out but not built — that is what headless is')
  }
  if (!post.resolved.length) {
    out.push('no chain, so no composer, no extra render target and no per-frame work — an empty chain costs nothing')
  }
  if (post.declared === null || post.declared === undefined) {
    out.push('the level declares no "post" in its world block, so this is off unless post.chain sets it')
  }
  if (post.chosen !== null && post.chosen !== undefined) {
    out.push('post.chain changed this session and nothing was written — the level file still says what it said')
  }
  if (post.built > post.resolved.length) {
    out.push('one more pass than effect, because the chain is closed with an OutputPass — a composer works in linear light and the canvas expects it encoded')
  }
  if (post.resolved.some(e => e.effect === 'ssao') && post.resolved.some(e => e.effect === 'smaa')) {
    out.push('ssao before smaa is the right order: antialiasing the ambient occlusion is cheaper than occluding the antialiased edges')
  }
  return out
}
