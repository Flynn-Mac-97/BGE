/**
 * Blender Shaders — rebuild a Blender material's node graph as a live shader.
 *
 * A `.glb` carries fixed values and image textures, so a material driven by
 * noise, a ramp or a fresnel arrives as flat grey. `blender.import` writes the
 * whole node graph beside the model; this plugin reads it and builds the same
 * network in TSL, so a look designed in Blender draws in the engine with no
 * second version written by hand.
 *
 * TSL and not GLSL: GLSL builds on the WebGL backend only, and every game must
 * run on both.
 *
 * A material is swapped only when EVERY node in it can be translated. A graph
 * with one unknown node keeps the material the `.glb` already carried, which is
 * correct for values and image textures — replacing it with a half-built
 * network would lose a texture that was arriving perfectly well.
 */
import { missingImages, unknownTypes } from './blender-shaders/graph.js'
import { TRANSLATABLE_TYPES } from './blender-shaders/nodes.js'

/** Graphs read off disk, by material name, with what each one needs. */
const state = {
  graphs: new Map(),      // material name -> { graph, file, unknown, textures }
  materials: new Map(),   // material name -> built THREE material
  loaded: false,
  error: null,
  swapped: 0,
  toolkit: null           // { THREE, TSL, buildMaterial }, once the renderer exists
}

/**
 * How many frames between looks at the scene.
 *
 * A model loads after the entity that uses it, so the swap cannot happen once
 * at load. Every frame would walk the whole scene for nothing almost always;
 * this is often enough that a new model is right within a fifth of a second.
 */
const EVERY = 10
let sinceLook = 0

/** Look at the scene on one frame in `EVERY`. */
function everyFewFrames(context) {
  if (++sinceLook < EVERY) return
  sinceLook = 0
  applyToScene(context)
}

// -------------------------------------------------------------- reading disk

/** Every `*.shaders.json` in the project. */
async function graphFiles(context) {
  const tree = await context.files.tree()
  return tree.map(item => item.path).filter(file => file.endsWith('.shaders.json')).sort()
}

/**
 * Read every graph file into `state.graphs`.
 *
 * Keyed by material name, which is the same name the `.glb` gives the material
 * it exported — that is what joins a graph to the surface it belongs to.
 */
async function readGraphs(context) {
  state.graphs.clear()
  state.materials.clear()
  state.error = null
  try {
    for (const file of await graphFiles(context)) {
      const document = JSON.parse(await context.files.read(file))
      const textures = document.textures || {}
      const folder = file.slice(0, file.lastIndexOf('/') + 1)
      for (const [name, graph] of Object.entries(document.materials || {})) {
        const unknown = [
          ...unknownTypes(graph, TRANSLATABLE_TYPES),
          ...missingImages(graph, textures).map(image => `image ${image}`)
        ]
        state.graphs.set(name, { graph, file, unknown, textures, folder })
      }
    }
    state.loaded = true
  } catch (error) {
    state.error = String(error?.message || error)
  }
  return state.graphs.size
}

// ------------------------------------------------------------------ building

/** Three and TSL, loaded once, and only where there is something to draw. */
async function loadToolkit() {
  if (state.toolkit) return state.toolkit
  const [THREE, TSL, build] = await Promise.all([
    import('three/webgpu'), import('three/tsl'), import('./blender-shaders/build.js')
  ])
  state.toolkit = { THREE, TSL, buildMaterial: build.buildMaterial }
  return state.toolkit
}

/** Loaded images, by project path, shared by every material that samples one. */
const images = new Map()

/**
 * The texture for one image a graph names, loaded once.
 *
 * Colour images are sRGB and data images — roughness, normals — are linear,
 * which is what Blender's colour space setting on the image says.
 */
function imageFor(found, name) {
  const relative = found.textures[name]
  if (!relative) return null
  const file = found.folder + relative
  if (images.has(file)) return images.get(file)
  const { THREE } = state.toolkit
  const texture = new THREE.TextureLoader().load(`/project/${file}`)
  const node = Object.values(found.graph.nodes).find(one => one.properties?.image === name)
  const space = node?.properties?.colourspace || 'sRGB'
  texture.colorSpace = space === 'sRGB' ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.wrapS = texture.wrapT = node?.properties?.extension === 'EXTEND'
    ? THREE.ClampToEdgeWrapping
    : THREE.RepeatWrapping
  // glTF and three read UVs with V pointing down; Blender's point up.
  texture.flipY = false
  images.set(file, texture)
  return texture
}

/** The built material for one name, or null when it cannot be built. */
function materialFor(name) {
  if (state.materials.has(name)) return state.materials.get(name)
  const found = state.graphs.get(name)
  if (!found || found.unknown.length) return null

  const { THREE, TSL, buildMaterial } = state.toolkit
  let built = null
  try {
    const textureFor = image => imageFor(found, image)
    const result = buildMaterial(THREE, TSL, found.graph, { textureFor })
    built = result.missing.length ? null : result.material
    if (built) built.name = name
  } catch (error) {
    console.error(`[Blender Shaders] ${name} — ${error?.message || error}`)
  }
  // Stored either way: a material that cannot be built must not be retried on
  // every look at the scene.
  state.materials.set(name, built)
  return built
}

/**
 * Put built materials onto any model that is drawing the flat version.
 *
 * Matched by material name. `userData.blenderShader` marks what has been seen,
 * so a mesh is judged once rather than on every look.
 */
function applyToScene(context) {
  const scene = context.renderer?.scene
  // Nothing is marked before the toolkit exists: a surface marked while three
  // and TSL are still loading would never be looked at again.
  if (!scene || !state.graphs.size || !state.toolkit) return 0
  let swapped = 0
  scene.traverse(object => {
    const material = object.material
    if (!material || Array.isArray(material) || object.userData.blenderShader) return
    object.userData.blenderShader = true
    const built = materialFor(material.name)
    if (!built) return
    object.material = built
    swapped++
  })
  if (swapped) {
    state.swapped += swapped
    context.renderer?.invalidate?.()
  }
  return swapped
}

/** Forget every built material and every mark, so the next look rebuilds. */
function forgetBuilt(context) {
  state.materials.clear()
  context.renderer?.scene?.traverse(object => { delete object.userData.blenderShader })
}

// ------------------------------------------------------------------- reading

/** What the panel and the command both report. */
const report = () => ({
  materials: [...state.graphs.entries()].map(([name, found]) => ({
    name,
    file: found.file,
    translated: found.unknown.length === 0,
    needs: found.unknown
  })),
  swapped: state.swapped,
  error: state.error
})

export default {
  name: 'Blender Shaders',
  category: 'visuals',
  about: 'Rebuilds a Blender material graph as TSL.',

  inspect: [{
    title: 'Blender Shaders',
    rows: () => [
      ['graphs read', String(state.graphs.size)],
      ['translated', String([...state.graphs.values()].filter(one => !one.unknown.length).length)],
      ['surfaces swapped', String(state.swapped)],
      ['node types known', String(TRANSLATABLE_TYPES.length)]
    ]
  }],

  onLoad(context) {
    // Three and TSL are loaded only when the project has a graph to build. They
    // are three megabytes of module source, and a world with no `.shaders.json`
    // never draws one — loading them at every boot was the largest single read a
    // headless world made. `loadToolkit` is idempotent, so the first graph that
    // arrives still gets them.
    readGraphs(context).then(found => found ? loadToolkit() : null).catch(error => {
      state.error = String(error?.message || error)
    })

    // A re-import writes a new graph. Without this the editor keeps drawing the
    // shader built from the previous one.
    context.bus.on('hot:applied', change => {
      if (!change?.file?.endsWith('.shaders.json')) return
      readGraphs(context)
        .then(() => state.graphs.size ? loadToolkit() : null)
        .then(() => forgetBuilt(context))
        .catch(error => { state.error = String(error?.message || error) })
    })

    // Two hooks for the same job, because they never both fire: a `frame`
    // system runs only while the loop does, and the editor repaints stopped.
    context.bus.on('frame:painted', () => everyFewFrames(context))
  },

  systems: [{ phase: 'frame', run: (world, seconds, context) => everyFewFrames(context) }],

  commands: [
    {
      id: 'blender.shaders',
      label: 'Blender material graphs',
      run: async context => {
        if (!state.loaded) await readGraphs(context)
        return { ...report(), known: TRANSLATABLE_TYPES }
      }
    },
    {
      id: 'blender.shaders.apply',
      label: 'Rebuild materials',
      run: async context => {
        await readGraphs(context)
        await loadToolkit().catch(() => null)
        forgetBuilt(context)
        return { ...report(), swapped: applyToScene(context) }
      }
    }
  ],

  panels: [{
    id: 'blender-shaders',
    title: 'Blender Shaders',
    dock: 'left',
    collapsed: true,
    order: 41,

    actions: [{ label: 'Rebuild', run: context => context.run('blender.shaders.apply') }],

    render(ui) {
      const rows = [...state.graphs.entries()]
      if (state.error) return ui.stack([ui.text(state.error, { dim: true })])
      if (!rows.length) {
        return ui.stack([ui.text('No material graphs. Run blender.import first.', { dim: true })])
      }
      return ui.stack([
        ui.list({
          items: rows,
          key: ([name]) => name,
          dim: ([, found]) => found.unknown.length > 0,
          row: ([name, found]) => [
            ui.label(name),
            ui.text(found.unknown.length ? `needs ${found.unknown.join(', ')}` : 'translated', { dim: true })
          ]
        }),
        ui.text(`${state.swapped} surfaces swapped`, { dim: true })
      ])
    }
  }]
}
