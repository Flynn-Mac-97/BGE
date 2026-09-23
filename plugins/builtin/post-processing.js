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
 * NO NEW DEPENDENCY. Every effect used here already ships inside the installed
 * `three` package, under `three/addons/tsl/display/`, and the two written by
 * hand are node graphs of a dozen lines. The next agent to read this will assume
 * a post-processing library was added; none was, and none should be.
 *
 * WHAT AN EMPTY CHAIN COSTS: nothing, and that is enforced three ways.
 *   1. This plugin contributes no systems. There is no per-frame work to skip,
 *      because there is none to begin with — it is `onLoad`, one bus listener
 *      and one command.
 *   2. Every effect module, and three itself, sit behind a dynamic `import()`
 *      inside the build path. A game with no chain never downloads them.
 *   3. The `post` pass is only registered when there is a chain, and dropped when
 *      it empties. A renderer that has never been handed an effect makes no
 *      chain and allocates no render target, so the frame time is exactly what
 *      it was before this file existed.
 * A post-processing plugin that taxes every game that does not use it is a bad
 * plugin, and "it only costs one branch per frame" is how that starts.
 *
 * WHERE THE CHAIN LIVES: here, in `post-processing/chain.js`. It builds one
 * three `RenderPipeline` over the scene and this plugin registers it as a `post`
 * pass through `renderer.graph` — the same door every other pass uses. The
 * renderer owns the context, the scene and the camera; it has to, because this
 * engine switches between an orthographic and a perspective camera and only the
 * renderer knows which is drawing. Everything after that is this plugin's: the
 * effects the level asked for, in the order it wrote them. Nothing closes the
 * chain — three's `PostProcessing` tone-maps and encodes its own output, which
 * is what the old OutputPass was for.
 */

import { makePostChain } from './post-processing/chain.js'

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
    about: 'contact shadow in the creases, worked out from depth; radius is how far it reaches, in metres, and strength how dark it can go',
    bare: 'radius',
    // Half resolution and a denoise pass: full-resolution occlusion with no
    // denoise is grainy and costs four times the pixels. Strength below 1 keeps
    // the deepest crease from reaching black, which ambient light never does.
    defaults: { radius: 0.4, strength: 0.7, scale: 0.5, denoise: true, bias: 0.005, range: 0.1 }
  },
  ssgi: {
    about: 'light bouncing between nearby surfaces, worked out from the screen and added; it darkens nothing, so keep ssao for blocked light',
    bare: 'intensity',
    // Quality is samples per pixel, at full resolution: slices × steps × 2.
    // show: 'bounce' or 'occlusion' draws that part alone, for tuning.
    defaults: { intensity: 1, quality: 'low', radius: 12, denoise: true, show: null }
  },
  traa: {
    about: 'temporal antialiasing — jitters the camera and blends each frame with the last, so edges, dithered hair and grainy screen effects settle smooth; replaces smaa, which is dropped beside it',
    bare: null,
    defaults: {}
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

  category: 'visuals',
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

      /**
       * Effects another plugin needs, by name, drawn before the level's chain.
       *
       * Lighting belongs on the scene before anything grades or sharpens it, so
       * these always run first. `null` removes one. The Render plugin puts
       * screen-space global illumination here.
       */
      lighting: new Map(),
      light(name, options) {
        if (options) post.lighting.set(name, options)
        else post.lighting.delete(name)
        return apply(context, post)
      },

      /**
       * Stop drawing the chain while a capture borrows the frame, and put it
       * back. The pass stays registered; only its draw and the kernel draws it
       * displaces change.
       */
      hold() { holdPostPass(context, post) },
      release() { releasePostPass(context, post) },

      report: () => report(context, post)
    }
    context.post = post

    // The chain and the one `post` pass that draws it. Both are held on `post`
    // so the module functions below can reach them, and neither exists until a
    // chain is wanted: an empty chain registers no pass and costs nothing.
    post.chain = null
    post.postPassAdded = false

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
    label: 'Post chain',
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
/** The order front effects run in, whatever order they were switched on in. */
const FRONT_ORDER = ['ssgi', 'traa']

/**
 * The chain for this renderer, built on first use.
 *
 * Building it is cheap; it is drawing that compiles shaders. It is created only
 * when a chain is wanted, so a game with no effects never makes one.
 */
function chainFor(context, post) {
  if (!post.chain && context.renderer) post.chain = makePostChain(context.renderer)
  return post.chain
}

/** Add the `post` pass and stand the kernel's clear and scene draw down. */
function addPostPass(context, post) {
  if (post.postPassAdded || !chainFor(context, post)) return
  const graph = context.renderer.graph
  graph.add({
    name: 'post', after: ['scene'], before: ['viewmodel'],
    execute: frame => post.chain.draw(frame.camera)
  })
  // The chain renders the scene through three's pipeline, so the kernel draws
  // nothing underneath it.
  graph.disable('scene')
  graph.disable('clear')
  post.postPassAdded = true
}

/** Drop the `post` pass and give the kernel's clear and scene draw back. */
function removePostPass(context, post) {
  if (!post.postPassAdded) return
  const graph = context.renderer.graph
  graph.remove('post')
  graph.enable('scene')
  graph.enable('clear')
  post.postPassAdded = false
}

/** Stop drawing the chain while a capture borrows the frame. */
function holdPostPass(context, post) {
  if (!post.postPassAdded) return
  const graph = context.renderer.graph
  graph.disable('post')
  graph.enable('scene')
  graph.enable('clear')
}

/** Draw the chain again after `holdPostPass`. */
function releasePostPass(context, post) {
  if (!post.postPassAdded) return
  const graph = context.renderer.graph
  graph.enable('post')
  graph.disable('scene')
  graph.disable('clear')
}

async function apply(context, post) {
  const say = message => sayOnce(post, message)
  // Lighting first, then the temporal pass that settles its grain.
  const byOrder = ([a], [b]) => FRONT_ORDER.indexOf(a) - FRONT_ORDER.indexOf(b)
  const front = resolveChain([...post.lighting].sort(byOrder).map(([name, options]) => ({ [name]: options })), say)
  const chain = resolveChain(post.chosen ?? post.declared, say)
    .filter(({ effect }) => !post.lighting.has(effect))
    .filter(({ effect }) => !(effect === 'smaa' && post.lighting.has('traa')))
  post.resolved = [...front, ...chain]
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

  if (!renderer.graph || typeof renderer.graph.add !== 'function') {
    post.built = 0
    post.status = 'this renderer has no pass graph'
    if (post.resolved.length) {
      sayOnce(post, '[Post Processing] this renderer has no pass graph, so the level\'s "post" chain was read and then thrown away — nothing is being applied to the picture')
    }
    return post.report()
  }

  if (!post.resolved.length) {
    // Nothing asked for. Only say so if something was there before, or a game
    // with no chain would be handed an empty chain on every level load for no
    // reason at all.
    if (post.built) {
      removePostPass(context, post)
      chainFor(context, post)?.set([])
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

  chainFor(context, post)?.set(built)
  addPostPass(context, post)
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
  const [THREE, TSL] = await Promise.all([import('three/webgpu'), import('three/tsl')])

  const built = []
  for (const { effect, options } of post.resolved) {
    built.push(await buildOne(effect, options, { THREE, TSL, context, post }))
  }
  // Nothing closes the chain. `PostProcessing` tone-maps and encodes its own
  // output, which is what the old OutputPass was for.
  return built.filter(Boolean)
}

/**
 * One effect as a function from the picture so far to a new picture.
 *
 * `needsNormals` makes the renderer ask the scene pass for a normal buffer,
 * which costs a second render target — so only an effect that reads one says
 * so.
 */
async function buildOne(effect, options, tools) {
  const { THREE, TSL, context, post } = tools
  const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

  if (effect === 'smaa') {
    const { smaa } = await import('three/addons/tsl/display/SMAANode.js')
    return { name: 'smaa', apply: colour => smaa(colour) }
  }

  if (effect === 'bloom') {
    const { bloom } = await import('three/addons/tsl/display/BloomNode.js')
    const { convertToTexture } = TSL
    const strength = number(options.strength, 0.35)
    const radius = number(options.radius, 0.4)
    const threshold = number(options.threshold, 0.9)
    // Bloom is what the bright parts bleed, so it is added to the picture
    // rather than replacing it. Its input is turned into a texture because it
    // samples a chain of smaller copies of the frame, which a plain node has no
    // way to offer.
    return {
      name: 'bloom',
      apply(colour) {
        const source = convertToTexture(colour)
        return source.add(bloom(source, strength, radius, threshold))
      }
    }
  }

  if (effect === 'ssao') {
    const [{ ao }, { denoise }] = await Promise.all([
      import('three/addons/tsl/display/GTAONode.js'),
      import('three/addons/tsl/display/DenoiseNode.js')
    ])
    const { builtinAOContext, convertToTexture, oneMinus, screenUV } = TSL
    const radius = number(options.radius, 0.4)
    const strength = Math.min(1, Math.max(0, number(options.strength, 0.7)))
    const scale = Math.min(1, Math.max(0.25, number(options.scale, 0.5)))
    const smoothed = options.denoise !== false
    return {
      name: 'ssao',
      needsNormals: true,
      apply(colour, parts) {
        if (!parts.normal || !parts.depth) {
          throw new Error('no depth or normal pre-pass, so there is nothing to work the occlusion out from')
        }
        const occlusion = ao(parts.depth, parts.normal, parts.camera)
        // `.value`, not the property. Every knob on the node is a uniform, and
        // replacing one with a plain number takes its node methods with it —
        // the pass then throws while the graph is being built and the whole
        // chain is lost.
        occlusion.radius.value = radius
        occlusion.resolutionScale = scale
        // Blurred along surfaces, not across edges: the denoise reads depth and
        // normals, so a crease stays sharp while its grain goes.
        const source = smoothed
          ? convertToTexture(denoise(occlusion.getTextureNode(), parts.depth, parts.normal, parts.camera))
          : occlusion.getTextureNode()
        const amount = oneMinus(oneMinus(source.sample(screenUV).r).mul(strength))
        // Fed into the scene pass's own lighting rather than multiplied over
        // the finished picture. Occlusion belongs on the ambient light: a
        // multiply at the end darkens things that are lit directly too.
        parts.scene.contextNode = builtinAOContext(amount)
        return colour
      }
    }
  }

  if (effect === 'ssgi') {
    const [{ ssgi }, { denoise }] = await Promise.all([
      import('three/addons/tsl/display/SSGINode.js'),
      import('three/addons/tsl/display/DenoiseNode.js')
    ])
    const { convertToTexture, vec4 } = TSL
    // Slices and steps per preset, from three's own advice for running without
    // temporal filtering. A denoise pass follows, so low is usually enough.
    const QUALITY = { low: [2, 6], medium: [3, 8], high: [4, 12] }
    // giIntensity at strength 1. Measured against Cycles in a white room with a
    // red wall, under the same sun and .exr: 5 matched the bounce on floor, wall
    // and ball best (error 2.8 of 255, against 12.2 with no bounce at all).
    const GI_SCALE = 5
    const [slices, steps] = QUALITY[options.quality] || QUALITY.low
    const intensity = Math.max(0, number(options.intensity, 1))
    const radius = Math.max(1, number(options.radius, 12))
    return {
      name: 'ssgi',
      needsNormals: true,
      apply(colour, parts) {
        if (!parts.normal || !parts.depth) {
          throw new Error('no depth or normal pre-pass, so there is nothing to bounce light from')
        }
        // The bounce is tinted by what it lands on, so the scene pass also
        // writes each surface's own colour.
        const diffuse = parts.sceneOutput('diffuseColor')
        const pass = ssgi(parts.scene.getTextureNode('output'), parts.depth, parts.normal, parts.camera)
        pass.sliceCount.value = slices
        pass.stepCount.value = steps
        pass.radius.value = radius
        pass.giIntensity.value = GI_SCALE * intensity
        // Temporal filtering needs the temporal antialiasing pass to average
        // it; without that pass, denoise stands in.
        pass.useTemporalFiltering = parts.temporal === true
        // Two outputs, read by name: the pass node itself stands for occlusion.
        const smooth = node => options.denoise === false
          ? node
          : convertToTexture(denoise(node, parts.depth, parts.normal, parts.camera))
        const bounce = smooth(pass.getGINode())
        // Bounce light only, added. The frame already carries the environment
        // light with its occlusion (room probe, baked occlusion, ssao), so
        // multiplying by this pass's occlusion darkens it a second time and
        // darkens direct sunlight, which nothing blocks.
        if (options.show === 'bounce') return vec4(diffuse.rgb.mul(bounce.rgb), 1)
        if (options.show === 'occlusion') return vec4(pass.getAONode().r, pass.getAONode().r, pass.getAONode().r, 1)
        return vec4(colour.rgb.add(diffuse.rgb.mul(bounce.rgb)), colour.a)
      }
    }
  }

  if (effect === 'traa') {
    const { traa } = await import('three/addons/tsl/display/TRAANode.js')
    return {
      name: 'traa',
      singleSample: true,
      apply(colour, parts) {
        // Motion per pixel, so last frame's picture is read from where each
        // surface was, not from where the pixel is.
        const motion = parts.sceneOutput('velocity')
        return traa(colour, parts.scene.getTextureNode('depth'), motion, parts.camera)
      }
    }
  }

  if (effect === 'grade') {
    const { dot, max, mix, vec3, vec4 } = TSL
    const contrast = number(options.contrast, 1)
    const saturation = number(options.saturation, 1)
    const brightness = number(options.brightness, 0)
    // Read back in sRGB, not linear. A cast is a ratio an author picks by eye
    // from a hex, and #ffe8c0 is a ninth off blue on a screen but nearly half
    // off in linear light — the same hex would land as a much heavier cast.
    const cast = new THREE.Color()
    readColour(THREE, options.tint, '#ffffff', 'grade.tint', post).getRGB(cast, THREE.SRGBColorSpace)
    const tint = cast
    // Brightness, then contrast about mid grey, then saturation about
    // luminance, then the cast. That order matters: grading after a contrast
    // curve is what a warm tint is supposed to be, and the other way round
    // tints the shadows as hard as the highlights.
    return {
      name: 'grade',
      apply(colour) {
        const lifted = colour.rgb.add(brightness)
        // Contrast as a power about MID GREY, not as a straight line through
        // it. A line takes everything below the pivot negative as soon as the
        // contrast passes 1, which clips the whole shadow end of a dark scene
        // to pure black. A power darkens the toe in proportion and can never
        // reach zero.
        const curved = max(lifted, 0.0001).div(MID_GREY).pow(contrast).mul(MID_GREY)
        const luminance = dot(curved, vec3(0.2126, 0.7152, 0.0722))
        const saturated = mix(vec3(luminance), curved, saturation)
        const cast = saturated.mul(vec3(tint.r, tint.g, tint.b))
        // Floor at zero only. The frame is still linear light before tone
        // mapping, where a lit wall is above 1; a ceiling of 1 flattens every
        // bright colour to grey-white before tone mapping can roll it off.
        return vec4(max(cast, 0), colour.a)
      }
    }
  }

  if (effect === 'vignette') {
    const { float, screenUV, smoothstep, vec4 } = TSL
    const amount = number(options.amount, 0.25)
    const offset = number(options.offset, 1)
    return {
      name: 'vignette',
      apply(colour) {
        // Distance from the middle of the screen, 0 at the centre and 1 in a
        // corner, so the falloff means the same at any aspect.
        const reach = screenUV.sub(0.5).length().mul(1.4142)
        const darkening = smoothstep(offset * 0.5, 1, reach).mul(amount)
        return vec4(colour.rgb.mul(float(1).sub(darkening)), colour.a)
      }
    }
  }

  return null
}



// ------------------------------------------------------------------ reporting
/**
 * Mid grey in linear light: what 0.5 on a screen actually is once decoded.
 *
 * Every effect here runs before the output transform, so a curve that wants to
 * turn about the middle of the picture has to turn about this.
 */
const MID_GREY = 0.2140

/** A colour three will take, or the fallback — reported either way. */
function readColour(THREE, value, fallback, where, post) {
  if (value === null || value === undefined) return new THREE.Color(fallback)
  if (typeof value === 'number') return new THREE.Color(value)
  const text = String(value).trim().toLowerCase()
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text) || text in THREE.Color.NAMES) return new THREE.Color(text)
  if (post) sayOnce(post, `[Post Processing] "${value}" is not a colour ${where} can use — using ${fallback}`)
  return new THREE.Color(fallback)
}

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
    lighting: [...post.lighting.keys()],
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
    out.push('no chain, so no render target and no per-frame work — an empty chain costs nothing')
  }
  if (post.declared === null || post.declared === undefined) {
    out.push('the level declares no "post" in its world block, so this is off unless post.chain sets it')
  }
  if (post.chosen !== null && post.chosen !== undefined) {
    out.push('post.chain changed this session and nothing was written — the level file still says what it said')
  }
  if (post.built > post.resolved.length) {
    out.push('one effect per entry, and nothing closing the chain — PostProcessing tone-maps and encodes its own output')
  }
  if (post.resolved.some(e => e.effect === 'ssao') && post.resolved.some(e => e.effect === 'smaa')) {
    out.push('ssao before smaa is the right order: antialiasing the ambient occlusion is cheaper than occluding the antialiased edges')
  }
  return out
}
