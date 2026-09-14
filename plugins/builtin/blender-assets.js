/**
 * Blender Assets — a `.blend` in the project is the source of a `.glb`.
 *
 * The engine never reads a `.blend`. Blender does, so an import runs a program,
 * and only a node world can: headless, every command does the work; in the
 * browser, each one answers with the terminal line to type. That is why the
 * panel shows state rather than a button that could not finish.
 *
 * The built `.glb` is a real file beside its source, not a hidden cache, so a
 * type references it the way it always has and a machine with no Blender can
 * still run the game.
 *
 * Editing a `.blend` changes nothing on its own — nothing watches it, because
 * nothing in the browser could act on the event. Run the import; the `.glb` it
 * writes is what hot reload already picks up.
 */
import {
  DEFAULT_SETTINGS, graphFile, importState, modelFile, readSettings, settingsFile, writeSettings, inSeconds
} from './blender-assets/state.js'

/** What the panel last read. Rebuilt by `blender.list`, never by a draw. */
const state = { rows: [], error: null, reading: false, checked: null }

/** The node half, loaded once and only where it can run. */
let importer = null
const nodeHalf = async () => (importer ||= await import('./blender-assets/import.mjs'))

/** The command that does this job at a terminal. Shown wherever one is refused. */
const terminal = (id, args) =>
  `node bin/engine.mjs --headless run ${id}${args ? ` '${JSON.stringify(args)}'` : ''}`

/** Refuse in the browser, naming the command that works. Blender is a program. */
const needsNode = (id, args) => ({
  refused: 'Blender is a program, and only a headless run can start one',
  run: terminal(id, args)
})

// ------------------------------------------------------------ reading state

/**
 * A `.blend`'s settings and its receipt, read through the kernel.
 *
 * Both halves read it the same way, so the panel and the importer never
 * disagree about what was asked for.
 */
async function settingsOf(context, blend) {
  const text = await context.files.read(settingsFile(blend)).catch(() => '')
  return readSettings(text)
}

/**
 * The `.blend` as it is now, asked of the dev server.
 *
 * `Last-Modified` carries whole seconds, which is why the receipt stores
 * seconds — the node half stats the same file and rounds the same way.
 */
async function sourceOverHTTP(blend) {
  const response = await fetch(`/project/${blend}`, { method: 'HEAD' }).catch(() => null)
  if (!response?.ok) return null
  const modified = Date.parse(response.headers.get('last-modified') || '')
  const size = Number(response.headers.get('content-length'))
  return Number.isFinite(modified) && Number.isFinite(size)
    ? { modified: inSeconds(modified), size }
    : null
}

/** Every `.blend` in the project, however this half reaches disk. */
async function blendFiles(context) {
  if (context.host) return (await nodeHalf()).listBlends(context.host)
  const tree = await context.files.tree()
  return tree.map(item => item.path).filter(file => /\.blend$/i.test(file)).sort()
}

/** One row of the panel: the file, its model, and whether the model is current. */
async function rowFor(context, blend) {
  const { settings, built } = await settingsOf(context, blend)
  const model = modelFile(blend)
  const source = context.host
    ? await (await nodeHalf()).sourceFacts(context.host, blend)
    : await sourceOverHTTP(blend)
  const modelExists = context.host
    ? await (await nodeHalf()).onDisk(context.host, model)
    : await fetch(`/project/${model}`, { method: 'HEAD' }).then(r => r.ok, () => false)

  return { file: blend, model, settings, ...importState({ built, settings, source, modelExists }) }
}

// ------------------------------------------------------------------ importing

/** Import one `.blend`, unless its model already matches it. */
async function importOne(context, blend, force = false) {
  const node = await nodeHalf()
  const { settings, built } = await settingsOf(context, blend)
  const model = modelFile(blend)
  const source = await node.sourceFacts(context.host, blend)
  if (!source) throw new Error(`no ${blend} in this project`)

  const modelExists = await node.onDisk(context.host, model)
  const current = importState({ built, settings, source, modelExists })
  if (current.state === 'fresh' && !force) return { file: blend, model, skipped: current.why }

  const blender = await findBlender(context)
  const receipt = await node.runExport(
    context.host, { blender, blend, model, graphs: graphFile(blend), settings })
  // Written through the kernel, so a guard can refuse it and the index is
  // rebuilt — the receipt is project content, unlike the model Blender wrote.
  await context.files.write(settingsFile(blend), writeSettings({ settings, built: receipt }))
  const done = { file: blend, model, built: true, blender: blender.version }
  if (receipt.dropped?.length) done.ignored = receipt.dropped
  if (receipt.baked?.length) done.baked = receipt.baked
  if (receipt.graphs?.length) done.shaders = receipt.graphs
  // Said on every import that leaves one, because the symptom is a model that
  // draws flat grey and names nothing.
  if (receipt.procedural?.length) {
    done.flatGrey = receipt.procedural
    done.fix = 'glTF carries no node graph. The Blender Shaders plugin rebuilds these from the .shaders.json written beside the model — run blender.shaders to see whether it can. Otherwise set "bake": true in the .import.json.'
  }
  return done
}

/** The Blender to use, found once per run rather than once per file. */
async function findBlender(context) {
  if (!state.checked) state.checked = await (await nodeHalf()).findBlender(context.host)
  return state.checked
}

// --------------------------------------------------------------------- panel

const CHIP = { fresh: 'fresh', stale: 'stale', never: 'not imported' }

// ------------------------------------------------------------- drawing alpha

/** Where alpha splits the solid pass from the soft pass. */
const ALPHA_SPLIT = 0.5

/**
 * Draw a mesh whose material Blender draws dithered in two passes.
 *
 * glTF has no dither mode. Blended, hair cards sort wrongly and mostly vanish;
 * cut out, strands are hard and grainy; a per-pixel random cutout needs many
 * frames averaged, and temporal antialiasing rejects that noise as motion.
 *
 * Pass 1 is the mesh itself: alpha above 0.5 drawn solid, writing depth, so
 * strands sort correctly against each other and the head. Pass 2 is a copy of
 * the mesh with a blended material that draws only alpha below 0.5, without
 * writing depth, so the soft edges Blender averages are blended over pass 1.
 * The copy is a child with no transform of its own and shares the geometry and
 * skeleton, so it follows every pose and is removed with the model.
 */
function drawMarkedAlpha(THREE, TSL, mesh) {
  Object.assign(mesh.material, {
    alphaTest: ALPHA_SPLIT, alphaHash: false, transparent: false, depthWrite: true, needsUpdate: true
  })
  mesh.add(softPass(THREE, TSL, mesh))
}

/** The attribute the export bakes occlusion into, as three names it. */
const OCCLUSION = '_occlusion'

/**
 * Dim environment light by the occlusion Blender baked into the mesh.
 *
 * `aoNode` reaches only indirect light, diffuse and reflected, so direct light
 * and shadows are unchanged. Screen-space AO, when on, multiplies on top.
 */
function useBakedOcclusion(TSL, mesh) {
  mesh.material.aoNode = TSL.attribute(OCCLUSION, 'float')
  mesh.material.needsUpdate = true
}

/** Finish every imported mesh not looked at yet: baked occlusion, then alpha. */
async function finishImportedMeshes(context) {
  const found = []
  context.renderer?.scene?.traverse(object => {
    if (!object.isMesh || object.userData.blenderAlphaSeen) return
    object.userData.blenderAlphaSeen = true
    const occluded = !!object.geometry?.attributes?.[OCCLUSION]
    const dithered = object.material?.userData?.blenderAlpha === 'dithered'
    if (occluded || dithered) found.push({ mesh: object, occluded, dithered })
  })
  if (!found.length) return
  const [THREE, TSL] = await Promise.all([import('three/webgpu'), import('three/tsl')])
  // Occlusion first: the soft alpha pass copies the material as it stands.
  for (const { mesh, occluded } of found) if (occluded) useBakedOcclusion(TSL, mesh)
  for (const { mesh, dithered } of found) if (dithered) drawMarkedAlpha(THREE, TSL, mesh)
  context.renderer?.invalidate?.()
}

/** The blended copy of one mesh, drawing only alpha below the split. */
function softPass(THREE, TSL, mesh) {
  const copy = mesh.isSkinnedMesh
    ? new THREE.SkinnedMesh(mesh.geometry, softMaterial(TSL, mesh.material))
    : new THREE.Mesh(mesh.geometry, softMaterial(TSL, mesh.material))
  if (mesh.isSkinnedMesh) copy.bind(mesh.skeleton, mesh.bindMatrix)
  Object.assign(copy, { castShadow: false, receiveShadow: mesh.receiveShadow, renderOrder: 1 })
  copy.userData.blenderAlphaSeen = true
  copy.userData.blenderAlphaSoftPass = true
  // Lights marks every new mesh to cast; the solid pass already casts this shape.
  copy.userData.lightsShadow = true
  return copy
}

/** One soft material per solid material, so meshes that shared one still share one. */
const softMaterials = new WeakMap()
function softMaterial(TSL, solid) {
  if (!softMaterials.has(solid)) {
    const soft = solid.clone()
    // `clone` copies material values, not node inputs.
    Object.assign(soft, { alphaTest: 0, transparent: true, depthWrite: false, aoNode: solid.aoNode })
    const alpha = solid.map ? TSL.texture(solid.map, TSL.uv(solid.map.channel || 0)).a.mul(solid.opacity) : TSL.float(solid.opacity)
    soft.maskNode = alpha.lessThan(ALPHA_SPLIT)
    softMaterials.set(solid, soft)
  }
  return softMaterials.get(solid)
}

/** How many frames pass between looks for newly loaded models. */
const LOOK_EVERY = 15
let sinceLook = 0
const everyFewFrames = context => { if (++sinceLook >= LOOK_EVERY) { sinceLook = 0; finishImportedMeshes(context) } }

function panelRows(ui, context) {
  if (state.error) return [ui.text(state.error, { dim: true })]
  if (!state.rows.length) {
    return [ui.text('No .blend files. Put one in assets/ and press Read.', { dim: true })]
  }
  return [ui.list({
    items: state.rows,
    key: row => row.file,
    dim: row => row.state === 'fresh',
    row: row => [
      ui.label(row.file.replace(/^assets\//, '')),
      ui.text(`${CHIP[row.state]} — ${row.why}`, { dim: true })
    ]
  })]
}

export default {
  name: 'Blender Assets',
  category: 'editor',
  about:
    'A .blend file in the project is the source of the .glb beside it. `blender.import` rebuilds ' +
    'any model whose .blend has changed, and the .glb is what a type references. Blender is a ' +
    'program, so every command here needs a headless run.',

  inspect: [{
    title: 'Blender',
    rows: context => [
      ['found', state.checked ? `${state.checked.version} at ${state.checked.command}` : 'not checked'],
      ['.blend files', String(state.rows.length)],
      ['stale', String(state.rows.filter(row => row.state !== 'fresh').length)],
      ['can import here', context.host ? 'yes' : 'no — headless only']
    ]
  }],

  // A `frame` system runs only while the loop does; the editor repaints stopped.
  onLoad(context) {
    context.bus.on('frame:painted', () => everyFewFrames(context))
  },

  systems: [{ phase: 'frame', run: (world, seconds, context) => everyFewFrames(context) }],

  panels: [{
    id: 'blender-assets',
    title: 'Blender',
    dock: 'left',
    order: 40,

    actions: [{ label: 'Read', run: context => context.run('blender.list') }],

    render(ui, context) {
      return ui.stack([
        ...panelRows(ui, context),
        ui.text(state.reading ? 'reading…' : `${state.rows.length} .blend files`, { dim: true }),
        ui.text(terminal('blender.import', { all: true }), { dim: true })
      ])
    }
  }],

  commands: [
    {
      id: 'blender.check',
      label: 'Find the Blender this machine will use',
      run: async context => {
        if (!context.host) return needsNode('blender.check')
        const blender = await findBlender(context)
        return { blender: blender.command, version: blender.version }
      }
    },
    {
      id: 'blender.list',
      label: 'Every .blend in the project, and whether its model is current',
      run: async context => {
        state.reading = true
        context.redraw?.()
        try {
          const files = await blendFiles(context)
          state.rows = []
          for (const file of files) state.rows.push(await rowFor(context, file))
          state.error = null
        } catch (error) {
          state.error = String(error?.message || error)
        }
        state.reading = false
        context.redraw?.()
        if (state.error) throw new Error(state.error)
        return {
          files: state.rows.map(row => ({ file: row.file, model: row.model, state: row.state, why: row.why })),
          stale: state.rows.filter(row => row.state !== 'fresh').length
        }
      }
    },
    {
      id: 'blender.import',
      label: 'Build the .glb for a .blend that changed',
      // args: {"file":"assets/models/kitten.blend"} | {"all":true} | {"all":true,"force":true}
      run: async (context, args) => {
        const asked = typeof args === 'string' ? { file: args } : (args || {})
        if (!context.host) return needsNode('blender.import', asked)

        const files = asked.file ? [String(asked.file)] : await blendFiles(context)
        if (!files.length) return { imported: [], note: 'no .blend files in this project' }

        const done = []
        for (const file of files) done.push(await importOne(context, file, !!asked.force))
        // The panel would otherwise still show what was true before the build.
        await context.run('blender.list').catch(() => {})
        return { imported: done.filter(one => one.built).length, files: done }
      }
    },
    {
      id: 'blender.settings',
      label: 'Write the import settings for a .blend',
      // args: {"file":"assets/models/kitten.blend","scale":0.01}
      run: async (context, args) => {
        const asked = args || {}
        const file = String(asked.file || '')
        if (!/\.blend$/i.test(file)) throw new Error('name a .blend file')
        const { settings, built } = await settingsOf(context, file)
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
          if (asked[key] !== undefined) settings[key] = asked[key]
        }
        await context.files.write(settingsFile(file), writeSettings({ settings, built }))
        return { file: settingsFile(file), settings }
      }
    }
  ]
}
