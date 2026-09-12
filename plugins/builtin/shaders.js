/**
 * Shaders — the sample shelf of node materials, and the worked examples of how
 * one is written.
 *
 * Materials owns the registry and the nine plain surfaces. This owns the ones
 * that are a shader rather than a surface: an edge that catches light, a glow
 * that breathes, a plane that moves. They are registered through the same door
 * a game's own shader goes through — `context.materials.register` — so nothing
 * here is a special case, and reading this file is how an author learns to add
 * a tenth.
 *
 * Every one is TSL. A TSL shader is a JavaScript node graph rather than a
 * string, so it composes, it carries its own types, and it can be built and
 * checked with no GPU at all. That is the whole reason the engine chose it.
 *
 * Described first, built later. The names, the descriptions and the default
 * parameters are true with or without a screen, so `shaders.list` answers
 * properly in a headless run. Three is a renderer library and a world with
 * nothing drawing must never pay to load one.
 */

/**
 * Every shader, what it is for, and the keys it reads.
 *
 * `parameters` are written flat on the `mesh`, beside `texture` and `tint`,
 * which is the form the renderer's material cache is keyed on.
 */
export const SHADERS = {
  fresnel: {
    about: 'light that gathers where a surface turns away from the eye. On a curved mesh it reads as a rim; on a box each face takes one shade, because a box has one normal per face',
    dimension: '3D, and only on geometry that curves',
    parameters: { edge: '#8fd8ff', power: 2.5, strength: 1 }
  },
  aura: {
    about: 'a glow that breathes on the engine clock, added to whatever is behind it. Softest at the middle of each face, so on a box it reads as one glow per face rather than one shell',
    dimension: '3D and 2D',
    parameters: { glow: '#ffb060', speed: 1.2, least: 0.25 }
  },
  waves: {
    about: 'a surface that actually moves: two crossing sine waves displace the mesh and shade its slope',
    dimension: '3D',
    parameters: { shallow: '#2e6f8e', deep: '#0b2f45', height: 0.18, length: 2.4, speed: 0.8 }
  },
  hologram: {
    about: 'scanlines, a rim, and a flicker — a projection rather than an object',
    dimension: '3D and 2D',
    parameters: { glow: '#54f0d0', lines: 90, speed: 2, flicker: 0.12 }
  },
  dissolve: {
    about: 'burns away over a noise field, with a hot edge at the boundary',
    dimension: '3D and 2D',
    parameters: { body: '#c8c8c8', edge: '#ff8c1a', amount: 0.5, scale: 6, border: 0.08 }
  },
  gradient: {
    about: 'two colours across the surface, the plainest worked example of a node graph',
    dimension: '2D',
    parameters: { from: '#3a7bd5', to: '#f5d020', angle: 0 }
  }
}

/** A number a shader can use, or its default. */
const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

/**
 * A colour as three floats, from whatever the level wrote.
 *
 * Returned as plain numbers rather than a Color so the builders below stay
 * pure TSL and can be read without knowing what three's Color is.
 */
function colourOf(THREE, value, fallback) {
  const colour = new THREE.Color(fallback)
  if (value !== null && value !== undefined) {
    try { colour.set(value) } catch { /* keep the fallback */ }
  }
  return [colour.r, colour.g, colour.b]
}

/**
 * The builders, one per shader.
 *
 * Each takes the node toolkit and the declaration and returns a material. They
 * are separated from `SHADERS` above because describing a shader needs no
 * renderer and building one needs the whole library.
 */
function buildersFor(THREE, TSL) {
  const {
    abs, clamp, float, fract, mix, mx_fractal_noise_float, normalLocal, normalView,
    oneMinus, positionLocal, positionViewDirection, sin, smoothstep, step, time, uv, vec3, vec4
  } = TSL

  /** How much an edge faces away from the eye: 0 head-on, 1 at the silhouette. */
  const rim = () => oneMinus(abs(normalView.normalize().dot(positionViewDirection.normalize())))

  return {
    fresnel: ({ mesh, tint }) => {
      const edge = colourOf(THREE, mesh.edge, SHADERS.fresnel.parameters.edge)
      const power = number(mesh.power, 2.5)
      const strength = number(mesh.strength, 1)
      const material = new THREE.MeshLambertNodeMaterial({ color: tint })
      material.emissiveNode = vec3(...edge).mul(rim().pow(power).mul(strength))
      return material
    },

    aura: ({ mesh }) => {
      const glow = colourOf(THREE, mesh.glow, SHADERS.aura.parameters.glow)
      const speed = number(mesh.speed, 1.2)
      const least = number(mesh.least, 0.25)
      const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
      material.blending = THREE.AdditiveBlending
      // Breathing between `least` and 1, on the engine clock rather than a wall
      // clock, so the same second always looks the same.
      const breath = sin(time.mul(speed)).mul(0.5).add(0.5).mul(1 - least).add(least)
      // Soft towards the edge of the surface rather than towards the
      // silhouette. A rim is zero across a face pointed straight at the camera,
      // which is exactly how a flat sprite and an editing view are arranged.
      const middle = oneMinus(clamp(uv().sub(0.5).length().mul(2), 0, 1)).pow(1.6)
      material.colorNode = vec4(vec3(...glow).mul(breath), middle.mul(breath))
      return material
    },

    waves: ({ mesh }) => {
      const shallow = colourOf(THREE, mesh.shallow, SHADERS.waves.parameters.shallow)
      const deep = colourOf(THREE, mesh.deep, SHADERS.waves.parameters.deep)
      const height = number(mesh.height, 0.18)
      const length = Math.max(0.01, number(mesh.length, 2.4))
      const speed = number(mesh.speed, 0.8)
      const material = new THREE.MeshLambertNodeMaterial({ transparent: true })
      // Two crossing waves rather than one, so the surface never reads as a
      // single rolling bar. The same expression drives the shape and the
      // shading, so the colour cannot drift out of step with the geometry.
      const across = positionLocal.x.div(length).add(time.mul(speed))
      const along = positionLocal.z.div(length * 1.3).sub(time.mul(speed * 0.7))
      const wave = sin(across).add(sin(along)).mul(0.5)
      material.positionNode = positionLocal.add(vec3(0, wave.mul(height), 0))
      material.colorNode = vec4(mix(vec3(...deep), vec3(...shallow), wave.mul(0.5).add(0.5)), 0.9)
      return material
    },

    hologram: ({ mesh }) => {
      const glow = colourOf(THREE, mesh.glow, SHADERS.hologram.parameters.glow)
      const lines = number(mesh.lines, 90)
      const speed = number(mesh.speed, 2)
      const flicker = number(mesh.flicker, 0.12)
      const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
      material.blending = THREE.AdditiveBlending
      // Scanlines run up the object itself, not up the screen, so they stay on
      // it as the camera moves.
      const bands = step(0.5, fract(positionLocal.y.mul(lines).sub(time.mul(speed))))
      const wobble = sin(time.mul(11)).mul(flicker).add(1)
      const strength = bands.mul(0.6).add(rim().mul(0.8)).mul(wobble)
      material.colorNode = vec4(vec3(...glow).mul(strength), clamp(strength, 0, 1))
      return material
    },

    dissolve: ({ mesh, tint }) => {
      const body = mesh.body === undefined ? null : colourOf(THREE, mesh.body, SHADERS.dissolve.parameters.body)
      const edge = colourOf(THREE, mesh.edge, SHADERS.dissolve.parameters.edge)
      const amount = Math.min(1, Math.max(0, number(mesh.amount, 0.5)))
      const scale = Math.max(0.01, number(mesh.scale, 6))
      const border = Math.max(0.001, number(mesh.border, 0.08))
      const material = new THREE.MeshLambertNodeMaterial({ transparent: true })
      const noise = mx_fractal_noise_float(positionLocal.mul(scale)).mul(0.5).add(0.5)
      // Anything below the threshold is gone; the band just above it is the
      // hot edge, which is what makes a dissolve read as burning rather than
      // fading.
      material.opacityNode = step(amount, noise)
      material.colorNode = vec4(
        mix(body ? vec3(...body) : vec3(tint.r, tint.g, tint.b), vec3(...edge),
          oneMinus(smoothstep(amount, amount + border, noise))),
        1)
      return material
    },

    gradient: ({ mesh }) => {
      const from = colourOf(THREE, mesh.from, SHADERS.gradient.parameters.from)
      const to = colourOf(THREE, mesh.to, SHADERS.gradient.parameters.to)
      const angle = number(mesh.angle, 0) * Math.PI / 180
      const material = new THREE.MeshBasicNodeMaterial()
      // One coordinate along the chosen direction, so an angle turns the ramp
      // without needing a second gradient.
      const along = uv().x.mul(Math.cos(angle)).add(uv().y.mul(Math.sin(angle)))
      material.colorNode = vec4(mix(vec3(...from), vec3(...to), clamp(along, 0, 1)), 1)
      return material
    }
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
  about: 'Sample node materials — outline, aura, waves, hologram, dissolve, gradient — and the worked examples of writing one.',
  needs: ['Materials'],

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
                ui.field({ k: key, v: String(value) }))
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
    const materials = context.materials
    if (!materials) {
      console.error('[Shaders] Materials did not load, so there is no registry to add to — every sample shader is missing and a mesh naming one draws as lambert.')
      return
    }

    // Described with no builder first: a headless world can answer what every
    // shader is and which keys it reads, and never pays to import a renderer.
    for (const [name, details] of Object.entries(SHADERS)) {
      materials.register(name, null, { ...details, from: 'shaders' })
    }

    if (typeof document === 'undefined') return

    Promise.all([import('three/webgpu'), import('three/tsl')])
      .then(([THREE, TSL]) => {
        const builders = buildersFor(THREE, TSL)
        for (const [name, build] of Object.entries(builders)) {
          materials.register(name, build, { ...SHADERS[name], from: 'shaders' })
        }
      })
      .catch(error => {
        console.error('[Shaders] the node library did not load, so no sample shader can be built —', error?.message || error)
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
        // False in a headless world for every one of them, and that is not a
        // fault: describing a shader needs no renderer.
        buildable: context.materials?.get(name)?.build !== null
      }))
    })
  }]
}
