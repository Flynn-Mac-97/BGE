/**
 * Skybox — the sky, declared in the level.
 *
 * The level already says where the camera goes and what the HUD shows; what the
 * sky looks like belongs to the place too:
 *
 *   "world": {
 *     "sky": "#6d7f96",
 *     "skyTexture": "skies/dawn.png"
 *   }
 *
 * A flat colour is the fastest way to make a map read as a greybox, so a level
 * may name an image instead. The image is mapped over a whole sphere: zenith
 * along its top edge, horizon across its vertical middle, ground colour along
 * the bottom. `skybox.look` reports the mapping and says so when the image does
 * not look like one.
 *
 * Every key is optional. A level with no sky at all gets the flat default
 * colour, which is exactly what the 2D path had before this file existed.
 *
 * All of it is also drivable from a terminal, so finding the right numbers is a
 * round trip rather than an edit and a reload:
 *
 *   node bin/engine.mjs run skybox.look
 *   node bin/engine.mjs run skybox.set '["skyTexture", "sky.png"]'
 *
 * Nothing here feeds the simulation. It is handed to the renderer, which is
 * absent whenever nothing is drawing, so every call is guarded — and a headless
 * run still answers `skybox.look` with the numbers it would have used.
 */

/** Where the sky colour lands when a level asks for a sky box but not a colour. */
const DEFAULT_SKY = '#6d7f96'

/**
 * How far away the sky box sits, in metres.
 *
 * It rides with the eye and it is drawn first with depth testing off, so it can
 * never occlude anything and the number is not a view distance — it only has to
 * be comfortably inside the camera's far plane, which a small one always is.
 */
const SKY_RADIUS = 100

import { lookColour } from './render/look-colour.js'

export default {
  name: 'Skybox',
  category: 'visuals',
  about: 'The level sky: a flat colour or panorama.',
  inspect: context => {
    const sky = context.skybox?.resolved
    if (!sky) return []
    return [{
      title: 'Sky',
      rows: [
        ['colour', sky.sky ?? '—'],
        ['texture', sky.skyTexture ?? 'none'],
        ['box', context.skybox.skyStatus ?? 'none']
      ]
    }]
  },

  onLoad(context) {
    const sky = {
      declared: {},        // the level's world.sky / world.skyTexture, exactly as written
      overrides: {},       // skybox.set, this session only — never written to disk
      resolved: resolveSky({}, {}, () => {}),
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
       * cannot be the thing that reads the file — a command asking what the sky
       * is a millisecond after boot would be answered with the defaults, and
       * answered confidently. The handler assigns this synchronously and every
       * command waits on it.
       */
      declaredRead: Promise.resolve(),
      reading: false,      // true while that read is in flight

      /** Work out the sky and hand it to the renderer. Safe with no renderer. */
      apply() {
        sky.resolved = resolveSky(sky.declared, sky.overrides, message => sayOnce(sky, message))
        const renderer = context.renderer
        if (renderer) drive(sky, renderer, 'setSky', [sky.resolved.sky])
        syncSkyBox(context, sky)
        return sky.report()
      },

      /**
       * One key, in the same shapes the level file accepts. `null` drops the
       * change and hands the key back to whatever the level said, so a session
       * of tuning is undoable without reloading the level.
       */
      set(key, value) {
        if (!SETTABLE.includes(key)) {
          throw new Error(`no sky key "${key}". One of ${SETTABLE.join(', ')}`)
        }
        if (value === null) delete sky.overrides[key]
        else sky.overrides[key] = value
        return sky.apply()
      },

      report: () => report(context, sky)
    }
    context.skybox = sky

    /**
     * Read one level's sky and apply it.
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
      sky.declared = declared
      sky.reading = false
      if (failure) console.error(`[Skybox] could not read the world block of levels/${name}.json —`, failure.message)
      sky.apply()
    }

    // The level's world block is the rule; re-read it whenever a level loads,
    // and drop whatever skybox.set changed — the file has just had the last word.
    context.bus.on('level:loaded', name => {
      sky.declared = {}
      sky.overrides = {}
      loadedFor = name
      sky.reading = true
      // The resolved values go back to the defaults at once, so nothing reports
      // the *previous* level's sky as this one's. The sky box itself is left
      // alone until the read lands — tearing it down and rebuilding it on every
      // level load would refetch an image that is very often the same one.
      sky.resolved = resolveSky({}, {}, () => {})
      sky.declaredRead = readDeclared(name)
    })
  },

  systems: [{
    phase: 'frame',
    run(world, seconds, context) {
      const sky = context.skybox?.skyMesh
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
      id: 'skybox.look',
      label: 'The sky now',
      // The level's block is read off disk and this is often the very first
      // thing a headless run asks. Waiting is the difference between reporting
      // what the level said and reporting the defaults as though it said nothing.
      run: async context => {
        await context.skybox.declaredRead
        return context.skybox.report()
      }
    },
    {
      id: 'skybox.set',
      label: 'Set the sky',
      // args: ['sky', '#6d7f96'] or ['skyTexture', 'sky.png'] — or a whole
      // block, { sky: '#6d7f96', skyTexture: 'sky.png' }, the same shape the
      // level uses.
      run: async (context, args) => {
        const sky = context.skybox
        // Same reason as skybox.look, and a stronger one: a change applied
        // before the level's own block arrives is a change the read overwrites.
        await sky.declaredRead
        if (args && !Array.isArray(args) && typeof args === 'object') {
          for (const [key, value] of Object.entries(args)) sky.set(key, value)
          return sky.report()
        }
        if (typeof args === 'string') {
          throw new Error(`skybox.set takes one JSON argument — run skybox.set '["${args}", <value>]'`)
        }
        const [key, value] = [].concat(args ?? [])
        if (!key) throw new Error(`skybox.set needs a key: ${SETTABLE.join(', ')}`)
        return sky.set(key, value ?? null)
      }
    }
  ]
}

/** The keys a level may declare, and therefore the ones skybox.set will take. */
const SETTABLE = ['sky', 'skyTexture']

// ------------------------------------------------------------------ resolving
/**
 * The level's block, plus this session's changes, plus the defaults underneath.
 *
 * Both keys are optional and read in the loosest form that is unambiguous — a
 * bare colour, or a full object — because a sky is tuned by typing one value
 * and a syntax that demands the other is a syntax nobody edits.
 */
function resolveSky(declared, overrides, say) {
  const stated = key => (key in overrides ? overrides[key] : declared[key])

  const skyTexture = typeof stated('skyTexture') === 'string' ? stated('skyTexture') : null
  if (stated('skyTexture') != null && !skyTexture) say('[Skybox] skyTexture must be the name of one image file')

  // A sky box still gets a flat colour behind it: it is what shows if the image
  // fails to load, and it is what the fog matches so the two agree at the horizon.
  const sky = stated('sky') != null
    ? lookColour(stated('sky'), DEFAULT_SKY, 'sky', say, 'Skybox')
    : (skyTexture ? DEFAULT_SKY : null)

  return { sky, skyTexture }
}

/**
 * A colour the renderer can take, or the fallback — and said out loud either way.
 *
 * A mistyped colour is precisely the failure this engine refuses to allow: the
 * sky goes wrong, the log stays empty, and the author reads their own file
 * three times looking for the missing hash.
 */
/**
 * Every colour name the renderer will actually take.
 *
 * Three's Color accepts a hex value or one of the CSS names, and nothing else.
 * The test here used to be "a word of letters", which let `purpleish` straight
 * through to a renderer that then rejected it. That is the precise failure this
 * function exists to prevent, so the list is written out.
 */
// ------------------------------------------------------------------ the renderer
/**
 * Call one renderer setter, and never take a level load down with it.
 *
 * `context.renderer` is absent headless, which is not an error and is handled
 * by the caller. A renderer that is present but missing the setter *is* one —
 * it means the level said something and nothing happened, so it is reported by
 * name, once, rather than left as a look that quietly did not arrive.
 */
function drive(sky, renderer, method, args) {
  const fn = renderer[method]
  if (typeof fn !== 'function') {
    sayOnce(sky, `[Skybox] this renderer has no ${method}() — that part of the level's world block was not applied`)
    return false
  }
  try {
    fn.apply(renderer, args)
    return true
  } catch (e) {
    sayOnce(sky, `[Skybox] ${method}(${args.map(a => JSON.stringify(a)).join(', ')}) failed — ${e.message}`)
    return false
  }
}

function sayOnce(sky, message) {
  if (sky.said.has(message)) return
  sky.said.add(message)
  console.error(message)
}

// ------------------------------------------------------------------ the sky box
/**
 * A flat colour behind a skyline is the fastest way to make a map look like a
 * greybox, so a level may name an image instead. A six-sided box has seams to
 * line up; one inverted sphere takes any single panorama and is the same idea
 * from the inside.
 *
 * The renderer's setter cannot express this — `setSky` takes a colour — so
 * the mesh is built here and added to the renderer's own scene rather than by
 * widening a kernel file that other plugins are reading.
 */
function syncSkyBox(context, sky) {
  const wanted = sky.resolved.skyTexture
  if (wanted === sky.skyFile) return
  sky.skyFile = wanted
  sky.skySize = null
  removeSkyBox(context, sky)
  if (!wanted) { sky.skyStatus = 'none'; return }
  if (!context.renderer?.scene) {
    // Headless. The level's choice is still reported, so skybox.look answers
    // with the sky it would have shown rather than pretending none was asked for.
    sky.skyStatus = 'nothing is drawing'
    return
  }

  sky.skyStatus = 'loading'
  const request = ++sky.skyRequest
  buildSkyBox(wanted).then(mesh => {
    // Another level may have loaded while the image was in flight, in which case
    // this sky is already the wrong one.
    if (request !== sky.skyRequest || sky.skyFile !== wanted) {
      disposeSkyBox(mesh)
      return
    }
    context.renderer.scene.add(mesh)
    sky.skyMesh = mesh
    sky.skySize = mesh.userData.skySize
    sky.skyStatus = 'shown'
  }).catch(e => {
    if (request !== sky.skyRequest) return
    sky.skyStatus = 'failed'
    // Let go of the name. `skyFile` is what syncSkyBox compares against, so a
    // failed load that kept it assigned meant this sky could never be asked for
    // again — not by a re-apply, not by skybox.set, not by dropping the file
    // into place. The next apply() now tries again.
    sky.skyFile = null
    // The flat sky colour is still there underneath, so this degrades to a
    // greybox rather than to black — but it must say which it is.
    console.error(`[Skybox] the sky texture "${wanted}" did not load, so the flat sky colour is showing —`, e?.message || e)
  })
}

/**
 * Three is imported here rather than at the top of the file because this is the
 * one part of the sky that needs a scene graph, and a world with nothing
 * drawing must not pay to load a renderer library it will never call.
 */
async function buildSkyBox(file) {
  const [THREE, { assetURL }] = await Promise.all([import('three/webgpu'), import('../../engine/ui.js')])

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
     * the bottom. Hand it an image authored zenith-to-horizon — half a sky —
     * and the horizon band lands at the nadir, which is to say underneath the
     * floor, and the map is roofed in the wrong colour with nothing said about it.
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
  mesh.userData.skybox = true
  // Carried out so report() can check the image against the mapping above.
  mesh.userData.skySize = [texture.image?.width ?? 0, texture.image?.height ?? 0]
  return mesh
}

function removeSkyBox(context, sky) {
  if (!sky.skyMesh) return
  context.renderer?.scene?.remove(sky.skyMesh)
  disposeSkyBox(sky.skyMesh)
  sky.skyMesh = null
}

function disposeSkyBox(mesh) {
  if (!mesh) return
  mesh.geometry.dispose()
  mesh.material.map?.dispose()
  mesh.material.dispose()
}

// ------------------------------------------------------------------ reporting
/**
 * "Why is the sky dark" has to be answerable from a terminal.
 *
 * So this reports what is set, what the level actually asked for, and what is
 * suspicious about the combination — including the plain fact that nothing is
 * drawing, which is the commonest reason of all for seeing nothing.
 */
function report(context, sky) {
  const { sky: colour, skyTexture } = sky.resolved
  return {
    level: context.level(),
    drawing: !!context.renderer,
    sky: colour,
    skyTexture,
    skyBox: sky.skyStatus,
    // Stated rather than implied, because an image drawn against the wrong
    // assumption looks plausible in a screenshot and is wrong everywhere.
    skyMapping: skyTexture
      ? 'a full sphere: the image top edge is the zenith, the bottom edge the nadir, the horizon across the vertical middle'
      : null,
    skySize: sky.skySize,
    reading: sky.reading,
    declared: sky.declared,
    changedThisSession: Object.keys(sky.overrides),
    notes: notes(context, sky)
  }
}

function notes(context, sky) {
  const { skyTexture } = sky.resolved
  const out = []
  // First, because everything under it may be about to change.
  if (sky.reading) out.push('the level\'s own "world" block has not finished being read off disk, so everything here is still the default — ask again, or run skybox.look, which waits')
  if (!context.renderer) out.push('nothing is drawing this world, so the sky is worked out but not applied — that is what headless is')
  if (!sky.reading && !Object.keys(sky.declared).length) out.push('the level declares no "world" block, so these are the defaults')
  if (sky.skySize && sky.skySize[1] >= sky.skySize[0]) {
    out.push(`the sky texture "${skyTexture}" is ${sky.skySize[0]}x${sky.skySize[1]} — it is mapped as a full gradient over the whole sphere, and a full-sky panorama is wider than it is tall, so this one is probably authored zenith-to-horizon and its horizon band will be sitting below the floor`)
  }
  if (sky.skyStatus === 'failed') out.push(`the sky texture "${skyTexture}" did not load — the flat sky colour is showing instead`)
  if (Object.keys(sky.overrides).length) out.push('skybox.set changed this session and nothing was written — the level file still says what it said')
  return out
}
