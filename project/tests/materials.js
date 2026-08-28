/**
 * The material registry, the declaration it is driven by, and the one animated
 * material's clock.
 *
 * Imported rather than reached through `context.materials`, because a test is
 * handed `test` and never the context. These are the same functions the plugin
 * itself calls — the plugin's `onLoad` does nothing to the registry that this
 * file does not do here — so what is checked is what a mesh will get.
 *
 * WHAT THIS CANNOT CHECK, and it is worth being plain about it: there is no
 * renderer in a headless run, so no material is ever *built*. Every builder in
 * the library returns a three object, and whether a MeshToonMaterial actually
 * bands its light in three steps, whether the water's normal map scrolls, and
 * whether the raw-GLSL `pulse` shader compiles on a real card can only be seen
 * in a browser. What is checked here is the part with logic in it: which name a
 * mesh declaration resolves to, what happens when that name is wrong, which
 * parameters reach the builder, and that the animated material's offset is a
 * pure function of the clock.
 */
import {
  makeMaterials,
  describeStandardLibrary,
  readMaterial,
  waterFlow,
  DEFAULT_MATERIAL,
  STANDARD_MATERIALS
} from '../../plugins/builtin/materials.js'

export default {
  name: 'a material is found by name, an unknown one falls back and says so, its parameters come off the mesh, and the water is a pure function of the clock',

  run(test) {
    // The registry the plugin builds, built the same way, with the reports
    // collected instead of printed so they can be asserted on.
    const reported = []
    const materials = describeStandardLibrary(
      makeMaterials({ report: message => reported.push(message) })
    )

    // ------------------------------------------------------------ the library
    for (const name of ['basic', 'lambert', 'standard', 'phong', 'toon', 'matcap', 'water', 'additive', 'pulse']) {
      test.ok(materials.has(name), `the library ships "${name}"`)
    }
    test.is(materials.list().length, Object.keys(STANDARD_MATERIALS).length,
      'and list() reports every one of them, with nothing drawing')
    test.ok(materials.list().every(entry => !entry.drawable),
      'none of them is drawable here, because there is no renderer to build one — that is what headless is, not a fault')

    // ------------------------------------------------------ registering one
    // Exactly the call a game makes: a name and a builder, no privilege of any
    // kind, and nothing under engine/ touched to do it.
    materials.register('hologram', request => ({ built: 'hologram', request }), {
      about: 'a game\'s own surface'
    })
    test.ok(materials.has('hologram'), 'registering a material makes it available by name')
    test.ok(materials.list().some(entry => entry.name === 'hologram' && entry.from === 'game'),
      'and list() shows it, credited to the game rather than to the library')
    test.is(materials.resolve({ material: 'hologram' }).name, 'hologram',
      'a mesh naming it resolves to it')

    // --------------------------------------------- an unknown name falls back
    const before = reported.length
    const unknown = materials.resolve({ box: [1, 1, 1], material: 'chrome-plated-marble' })
    test.is(unknown.name, DEFAULT_MATERIAL, 'an unknown material falls back to the default')
    test.is(unknown.asked, 'chrome-plated-marble', 'while still reporting what was asked for')
    test.ok(!!unknown.record, 'and it comes back with the fallback record, so nothing draws as nothing')
    test.ok(reported.slice(before).some(message => message.includes('chrome-plated-marble')),
      'the fallback said so out loud, naming the word that was wrong')
    test.ok(reported.slice(before).some(message => message.startsWith('[Materials]')),
      'and it said it under the plugin\'s own name')

    const afterFirst = reported.length
    materials.resolve({ material: 'chrome-plated-marble' })
    test.is(reported.length, afterFirst,
      'the same problem is reported once, not once per entity per level load')

    // ------------------------------------------ parameters reach the builder
    // A builder is handed what render.js hands one: the whole mesh declaration,
    // the texture the renderer already resolved, and a tint that is already a
    // colour. The parameters ride along so the builder does not read the same
    // declaration twice.
    materials.register('recorder', request => ({ got: request }))
    const built = materials.build({
      mesh: {
        box: [2, 3, 0.4],
        material: { name: 'recorder', steps: 5 },
        texture: 'wall.png',
        tiling: 2
      },
      texture: 'the map the renderer resolved',
      tint: 'the colour the renderer worked out'
    })
    test.is(built.got.parameters.steps, 5, 'a parameter inside the material object reaches the built material')
    test.is(built.got.parameters.texture, 'wall.png', 'and so does one written flat on the mesh')
    test.is(built.got.parameters.tiling, 2, 'including the ones every material shares')
    test.is(built.got.parameters.box, undefined,
      'the shape is not a parameter — box, quad and model describe the mesh, not the surface')
    test.is(built.got.texture, 'the map the renderer resolved',
      'the renderer\'s resolved texture is passed through untouched, so there is one texture cache in this engine and not two')
    test.is(built.got.tint, 'the colour the renderer worked out', 'and so is the colour it decided on')

    // The same builder called with a bare declaration — which is how anything
    // holding a mesh and no renderer calls one — reads the same keys.
    test.is(materials.build({ material: 'recorder', steps: 7 }).got.parameters.steps, 7,
      'a builder called with the declaration alone reads the same parameters')

    // A key written both ways: the detailed object is the more specific of the
    // two, so it wins. Nobody writes both on purpose, but the rule has to exist.
    test.is(readMaterial({ steps: 2, material: { name: 'toon', steps: 5 } }).parameters.steps, 5,
      'the material object wins over the same key written flat on the mesh')

    // -------------------------------------------------- reading a declaration
    test.is(readMaterial({ material: 'toon' }).name, 'toon', 'a bare name is the simple form')
    test.is(readMaterial({ material: { name: 'toon', steps: 3 } }).name, 'toon', 'and { name, … } is the detailed one')
    test.is(readMaterial({ box: [1, 1, 1] }).name, DEFAULT_MATERIAL, 'a mesh that names none gets the default')
    test.is(readMaterial(undefined).name, DEFAULT_MATERIAL, 'and so does a sprite, which has no mesh at all')
    test.is(readMaterial({ box: [1, 1, 1], unlit: true }).name, 'basic',
      'the unlit flag that predates this plugin still means basic, so every sky face and lamp draws as it did')
    test.is(readMaterial({ material: 'toon', unlit: true }).name, 'toon',
      'and a named material wins over it, because it is the more specific thing to have written')

    const misdeclared = []
    test.is(readMaterial({ material: 42 }, message => misdeclared.push(message)).name, DEFAULT_MATERIAL,
      'a material that is neither a name nor an object falls back')
    test.is(misdeclared.length, 1, 'and says so rather than drawing something nobody asked for')

    // ------------------------------------------------------------- the water
    // The animated material's offset is a pure function of context.time. Same
    // moment, same picture — which is the whole reason it is a function of the
    // clock rather than something accumulated a frame at a time.
    test.is(waterFlow(2.5), waterFlow(2.5), 'the water gives the same offset twice for the same time')
    test.is(waterFlow(0), { u: 0, v: 0 }, 'and starts where the level starts')
    test.ok(waterFlow(3.5).u !== waterFlow(2.5).u, 'a second later it has moved')
    test.is(waterFlow(4, { speed: 0.5, direction: [1, 0] }), { u: 2, v: 0 },
      'speed is metres of scroll per second along a normalised direction')
    test.is(waterFlow(4, { speed: 0.5, direction: [3, 0] }), { u: 2, v: 0 },
      'so a longer direction vector aims it without secretly speeding it up')
    test.is(waterFlow(2.5, { speed: 'fast' }), waterFlow(2.5),
      'and a speed that is not a number falls back to the default rather than to NaN')

    test.note('what a browser still has to check: that each builder returns a working three material, that toon bands in the declared number of steps, that the water normal map scrolls on screen, and that the raw-GLSL pulse shader compiles')
  }
}
