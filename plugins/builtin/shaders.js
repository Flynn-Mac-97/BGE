/**
 * Shaders — the sample shelf, and the worked example of how one is written.
 *
 * Materials owns the registry and the nine plain surfaces. This owns the ones
 * that are a shader rather than a surface: an edge that catches light, a glow
 * that breathes, a surface that moves.
 *
 * The shelf is a table of NAMES, not of node graphs. The table below is the one
 * place every default is written, and it is language-neutral: this file
 * describes each shader to Shader Languages and registers the TSL
 * implementation of it. A second language plugin implements the same names in
 * its own language, and `shader.prefer` swaps which one draws. Nothing here is
 * a special case — a game's own shader goes through the same two calls.
 *
 * Described here, drawn in `shaders/builders.js`. The names, descriptions and
 * defaults are true with or without a screen, so `shaders.list` answers in a
 * headless run and a world with nothing drawing never loads a renderer.
 */

import { buildersFor } from './shaders/builders.js'

/**
 * Every shader, what it is for, and the keys it reads.
 *
 * `parameters` are written flat on the `mesh`, beside `texture` and `tint`,
 * which is the form the renderer's material cache is keyed on. The builders
 * read their defaults from here, so a default is written once.
 */
export const SHADERS = {
  edges: {
    about: 'a bright line around every face, light falling inward from it, and a rim at the silhouette. A lit panel, not a selection outline — the Outline plugin draws those',
    dimension: '3D and 2D',
    parameters: { edge: '#7fe4ff', width: 0.03, power: 3, strength: 2 }
  },
  grass: {
    about: 'a tuft of blades on one quad: turns about Y to face the camera, bends in two gusts of wind, and tapers to a point. Each blade takes its own height, tilt and shade',
    dimension: '3D, on a quad',
    parameters: { root: '#2f5a24', tip: '#8fc44a', blades: 7, wind: 0.7, speed: 1.1, lean: 0.5 }
  },
  aura: {
    about: 'a glow that breathes on the engine clock, with drifting noise wisps and a white-hot core, added to whatever is behind it',
    dimension: '3D and 2D',
    parameters: { glow: '#ffb060', speed: 1.2, least: 0.35, detail: 9, strength: 3 }
  },
  waves: {
    about: 'five crossing waves solved per pixel: a lit surface with a specular sparkle and foam on the crests. `scale` is waves per metre, so a pool and a puddle get the same size wave. Nothing moves the mesh, so a plain quad is enough. Named waves, not water, because Materials already owns a texture-scrolling water',
    dimension: '3D and 2D',
    parameters: { shallow: '#46b6e0', deep: '#061e30', foam: '#eaf7ff', scale: 0.35, speed: 0.9, choppy: 1, sparkle: 1.2 }
  },
  hologram: {
    about: 'scrolling scanlines, a travelling bright bar, rows that tear sideways, and an edge glow — a projection rather than an object',
    dimension: '3D and 2D',
    parameters: { glow: '#54f0d0', lines: 26, speed: 2, flicker: 0.12, glitch: 0.05 }
  },
  dissolve: {
    about: 'burns away over fractal noise, with a wide edge band and a white-hot line at the cut',
    dimension: '3D and 2D',
    parameters: { body: '#b7c1cc', edge: '#ff7a18', amount: 0.45, scale: 1.1, border: 0.14, strength: 1.3 }
  },
  gradient: {
    about: 'a ramp across the face at any angle, eased at both ends and dithered so it does not band. The plainest worked example of a node graph',
    dimension: '2D',
    parameters: { from: '#3a7bd5', to: '#f5d020', mid: null, angle: 0 }
  }
}

/** Which shader the panel is showing. Module-level, so it survives a redraw. */
const panel = { chosen: null }

/** Name a shader on every selected mesh and write the level. */
function applyShader(context, entities, name) {
  for (const entity of entities) entity.mesh = { ...entity.mesh, material: name }
  context.bus.emit('world:changed')
  context.save()
  context.redraw()
}

export default {
  name: 'Shaders',
  category: 'visuals',
  about: 'The sample shader shelf — edges, grass, aura, waves, hologram, dissolve, gradient — described once and implemented in TSL.',
  needs: ['Materials', 'Shader Languages'],

  panels: [{
    id: 'shaders',
    title: 'Shaders',
    dock: 'right',
    order: 42,

    render(ui, context) {
      const names = Object.keys(SHADERS)
      const chosen = SHADERS[panel.chosen]
      const meshes = context.selection.filter(entity => entity.mesh)

      return ui.stack([
        ui.pick({
          options: names.map(name => ({ value: name, label: name })),
          value: panel.chosen,
          onChange: name => { panel.chosen = name === panel.chosen ? null : name }
        }),

        chosen
          ? ui.fold(panel.chosen, [
              ui.text(chosen.about, { dim: true }),
              ...Object.entries(chosen.parameters).map(([key, value]) =>
                ui.field({ k: key, v: value === null ? 'off' : String(value) }))
            ], { open: true, meta: chosen.dimension })
          : ui.text('pick a shader to see its keys', { dim: true }),

        chosen && meshes.length
          ? ui.row([ui.button(
              `Apply to ${meshes.length === 1 ? meshes[0].id : `${meshes.length} meshes`}`,
              () => applyShader(context, meshes, panel.chosen),
              { primary: true })], { pad: true })
          : null
      ].filter(Boolean))
    }
  }],

  onLoad(context) {
    const languages = context.shaderLanguages
    if (!languages) {
      console.error('[Shaders] Shader Languages did not load, so no sample shader has anywhere to be registered — a mesh naming one draws as lambert.')
      return
    }

    // Described with no implementation first: a headless world can answer what
    // every shader is and which keys it reads, and never pays for a renderer.
    for (const [name, details] of Object.entries(SHADERS)) {
      languages.describe(name, { ...details, kind: 'material', from: 'shaders' })
    }

    if (typeof document === 'undefined') return

    Promise.all([import('three/webgpu'), import('three/tsl')])
      .then(([THREE, TSL]) => {
        const builders = buildersFor(THREE, TSL, SHADERS)
        for (const [name, build] of Object.entries(builders)) {
          languages.implement(name, 'tsl', build)
        }
      })
      .catch(error => {
        console.error('[Shaders] the node library did not load, so no sample shader can be built in TSL —', error?.message || error)
      })
  },

  commands: [{
    id: 'shaders.list',
    label: 'Every sample shader, what it is for, and the keys it reads',
    run: context => ({
      shaders: Object.entries(SHADERS).map(([name, details]) => ({
        name,
        about: details.about,
        dimension: details.dimension,
        parameters: details.parameters,
        // Which language it will be built from. Null in a headless world for
        // every one of them, and that is not a fault: describing a shader
        // needs no renderer. `shader.list` says the same for every shader,
        // including a game's own.
        building: context.shaderLanguages?.chosen(name)?.language || null,
        written: context.shaderLanguages?.get(name)?.written
          ? [...context.shaderLanguages.get(name).written] : []
      }))
    })
  }]
}
