/**
 * Particle Painter — draws the field the Particles plugin simulates.
 *
 * Camera-facing quads in shared buffer geometry, grouped by texture and
 * blend, so a screen full of smoke, sparks and dust is a few draw calls
 * rather than a thousand meshes. Each particle is four vertices sharing one
 * centre, offset by a corner in view space — which makes it face the camera
 * without anything rotated on the CPU. Points would be fewer vertices, but a
 * point is clipped the moment its centre leaves the frustum, and most of a
 * two-metre puff is still on screen when that happens.
 *
 * A separate plugin from Particles so a headless world never parses a line
 * of drawing: the simulation is the truth either way, this is only the
 * picture of it.
 */
import { assetURL } from '../../engine/asset-path.js'

let painter = null
let field = null

export default {
  name: 'Particle Painter',
  category: 'visuals',
  about: 'Draws the particle field as camera-facing quads on the renderer scene, batched by texture and blend.',
  needs: ['Particles', 'Shader Languages'],

  onLoad(context) {
    field = context.particles
    // The renderer exists only after the shell — and headless it never does,
    // which is not an error: the field still simulates and records.
    context.bus.on('shell:ready', () => {
      if (painter || !context.renderer?.scene) return
      // Loaded on demand, so a world with no renderer never pays to parse a
      // 3D library it will not call.
      Promise.all([import('three/webgpu'), import('three/tsl')])
        .then(([THREE, TSL]) => {
          describeLook(TSL, context.shaderLanguages)
          painter = makePainter(THREE, TSL, context.renderer.scene, context)
          // A group's material is built once and kept, so a language swap
          // reaches nothing until the groups are dropped.
          context.bus.on('shader:swapped', () => painter?.reset())
        })
        .catch(e => console.error(`[particle-painter] could not load three — particles are recorded but not drawn (${e.message})`))
    })
  },

  systems: [
    { phase: 'frame', run() { painter?.sync(field?.all || []) } }
  ]
}

/**
 * The look of one particle, named as a program so a second language can write
 * it.
 *
 * Only the colour goes through the registry. How the quad faces the camera is
 * geometry this painter owns — one centre per particle, pushed out by its
 * corner in view space, so nothing is rotated on the CPU — and a shader
 * language has no say in it.
 */
function describeLook(TSL, languages) {
  if (!languages) {
    console.error('[particle-painter] Shader Languages did not load, so the particle look cannot be swapped — it is drawn in TSL.')
    return
  }
  const { mix, oneMinus, smoothstep, vec4 } = TSL
  languages.describe('particle-colour', {
    kind: 'program',
    about: 'the look of one particle: the colour it was painted, times its texture, cut to a round edge where it has none',
    from: 'particle-painter'
  })
  languages.implement('particle-colour', 'tsl', ({ surface, painted, sampled, textured }) => {
    // A soft round dot, so an untextured particle is a puff rather than a
    // square. A textured one takes its shape from the picture instead, or the
    // fade would eat the edge of the sprite.
    const edge = oneMinus(smoothstep(0.55, 1.0, surface.sub(0.5).length().mul(2)))
    const tinted = painted.mul(sampled)
    return vec4(tinted.rgb, tinted.a.mul(mix(edge, 1, textured)))
  })
}

/**
 * The material one group of particles is drawn with.
 *
 * `corner` is the surface coordinate as well as the vertex offset, so the
 * fragment side reads the same attribute the vertex side moved by.
 */
function particleMaterial(THREE, TSL, map, blend, context) {
  const {
    attribute, cameraProjectionMatrix, float, modelViewMatrix, positionGeometry,
    texture, vec4
  } = TSL

  const corner = attribute('corner', 'vec2')
  const size = attribute('particleSize', 'float')
  const painted = attribute('particleColour', 'vec4')

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    // Depth is tested so smoke behind a wall stays behind it, and not written
    // so a thousand overlapping quads blend instead of clipping.
    depthWrite: false,
    blending: blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide
  })

  const view = modelViewMatrix.mul(vec4(positionGeometry, 1))
  material.vertexNode = cameraProjectionMatrix.mul(
    vec4(view.x.add(corner.x.mul(size)), view.y.add(corner.y.mul(size)), view.z, view.w))

  const surface = corner.add(0.5)
  // Sampled here rather than in the program, so no language needs a sampler
  // argument and an untextured group gets white.
  const sampled = map ? texture(map, surface) : vec4(1, 1, 1, 1)
  material.colorNode = context.shaderLanguages?.build('particle-colour', {
    surface, painted, sampled, textured: float(map ? 1 : 0)
  }) || painted.mul(sampled)
  // What the shader discarded: below this a particle only costs blending.
  material.alphaTest = 0.01
  return material
}


function makePainter(THREE, TSL, scene, context) {
  const loader = new THREE.TextureLoader()
  const textures = new Map()
  const groups = new Map()      // texture|blend -> { geometry, mesh, capacity }

  function textureFor(src) {
    if (textures.has(src)) return textures.get(src)
    const t = loader.load(assetURL(src), undefined, undefined, () => {
      console.error(`[particle-painter] missing texture ${assetURL(src)} (referenced as "${src}")`)
    })
    t.colorSpace = THREE.SRGBColorSpace
    textures.set(src, t)
    return t
  }

  function groupFor(key, texture, blend, capacity) {
    let group = groups.get(key)
    if (group && group.capacity >= capacity) return group
    if (group) { scene.remove(group.mesh); group.geometry.dispose() }

    // Doubling rather than allocating the ceiling up front: most groups hold
    // a handful of sparks and only one ever holds a screen of smoke.
    const size = Math.max(64, 1 << Math.ceil(Math.log2(Math.max(1, capacity))))
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(size * 4 * 3), 3))
    geometry.setAttribute('particleSize', new THREE.BufferAttribute(new Float32Array(size * 4), 1))
    geometry.setAttribute('particleColour', new THREE.BufferAttribute(new Float32Array(size * 4 * 4), 4))

    // The corner and index buffers never change — the same four offsets and
    // two triangles for every particle that will ever live in this group.
    const corner = new Float32Array(size * 4 * 2)
    const index = new Uint32Array(size * 6)
    for (let quad = 0; quad < size; quad++) {
      corner.set([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], quad * 8)
      const v = quad * 4
      index.set([v, v + 1, v + 2, v, v + 2, v + 3], quad * 6)
    }
    geometry.setAttribute('corner', new THREE.BufferAttribute(corner, 2))
    geometry.setIndex(new THREE.BufferAttribute(index, 1))

    const material = particleMaterial(THREE, TSL, texture ? textureFor(texture) : null, blend, context)

    const mesh = new THREE.Mesh(geometry, material)
    // Vertices are built in view space every frame, so the bounding sphere
    // three would compute is meaningless — cull it and it disappears.
    mesh.frustumCulled = false
    mesh.renderOrder = 2
    scene.add(mesh)

    group = { geometry, mesh, capacity: size }
    groups.set(key, group)
    return group
  }

  return {
    /**
     * Drop every group, so the next frame builds its materials again.
     *
     * A group's material is built once and kept for the life of the page, so a
     * shader language swap reaches nothing without this.
     */
    reset() {
      for (const group of groups.values()) {
        scene.remove(group.mesh)
        group.geometry.dispose()
        group.mesh.material.dispose()
      }
      groups.clear()
    },

    sync(live) {
      const byGroup = new Map()
      for (const p of live) {
        const key = `${p.texture}|${p.blend}`
        const list = byGroup.get(key)
        if (list) list.push(p)
        else byGroup.set(key, [p])
      }
      // A group that emptied still has a mesh, and it has to be told so, or
      // the last frame's smoke hangs there forever.
      for (const key of groups.keys()) if (!byGroup.has(key)) byGroup.set(key, [])

      for (const [key, list] of byGroup) {
        const [texture, blend] = key.split('|')
        const group = groupFor(key, texture, blend, list.length)
        const position = group.geometry.attributes.position
        const size = group.geometry.attributes.particleSize
        const colour = group.geometry.attributes.particleColour

        list.forEach((p, i) => {
          let rgb = readColour(p.colour)
          // Colour over life: slide towards `fadeTo` in linear light as it ages.
          if (p.fadeTo) {
            const to = readColour(p.fadeTo)
            const t = Math.min(1, p.age / p.life)
            rgb = { r: rgb.r + (to.r - rgb.r) * t, g: rgb.g + (to.g - rgb.g) * t, b: rgb.b + (to.b - rgb.b) * t }
          }
          const alpha = p.fade ? Math.max(0, 1 - p.age / p.life) : 1
          for (let corner = 0; corner < 4; corner++) {
            const at = i * 4 + corner
            position.setXYZ(at, p.x, p.y, p.z)
            size.setX(at, p.size)
            colour.setXYZW(at, rgb.r, rgb.g, rgb.b, alpha)
          }
        })

        position.needsUpdate = true
        size.needsUpdate = true
        colour.needsUpdate = true
        group.geometry.setDrawRange(0, list.length * 6)
      }
    }
  }
}

/**
 * A hex colour as linear floats. Three works in linear light and converts a
 * texture for you, but not a vertex colour — unconverted, every particle
 * comes out visibly too bright.
 */
const colourCache = new Map()
function readColour(value) {
  const text = String(value || '#ffffff').trim()
  const cached = colourCache.get(text)
  if (cached) return cached
  const hex = /^#([0-9a-f]{3})$/i.test(text)
    ? text[1] + text[1] + text[2] + text[2] + text[3] + text[3]
    : (/^#([0-9a-f]{6})$/i.test(text) ? text.slice(1) : null)
  if (!hex) return { r: 1, g: 1, b: 1 }
  const n = parseInt(hex, 16)
  const colour = {
    r: toLinear(((n >> 16) & 255) / 255),
    g: toLinear(((n >> 8) & 255) / 255),
    b: toLinear((n & 255) / 255)
  }
  colourCache.set(text, colour)
  return colour
}

const toLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
