/**
 * Beam Painter — draws the field the Beams plugin simulates.
 *
 * One ribbon strip per beam in shared buffer geometry, grouped by blend, so a
 * screen of bolts is two draw calls. Each spine point becomes two vertices
 * offset across the beam; the offset is computed in view space in the vertex
 * shader, so the ribbon faces the camera without anything rotated on the CPU
 * and without the CPU needing to know where the camera is.
 *
 * The core and the halo are one pass: the fragment side reads how far across
 * the ribbon it is. Two passes would double the fill cost of the most
 * overdrawn thing on screen.
 *
 * A separate module from the beam field so a headless world never parses a
 * line of drawing: the simulation is the truth either way, this is only the
 * picture. The VFX host imports this only after `shell:ready`.
 */

/**
 * The look of one beam, as a node graph.
 *
 * The ribbon is built in VIEW space: each spine point is pushed across the
 * beam's own screen direction, which is what faces it at the camera without
 * the CPU knowing where the camera is. `side` is both the offset and the
 * across-the-ribbon coordinate the colour is read from.
 */
function beamMaterial(THREE, TSL, blend) {
  const {
    abs, attribute, cameraProjectionMatrix, clamp, max, mix, modelViewMatrix,
    normalize, oneMinus, positionGeometry, smoothstep, step, vec2, vec4
  } = TSL

  const along = attribute('along', 'vec3')
  const side = attribute('side', 'float')
  const width = attribute('beamWidth', 'float')
  const halo = attribute('haloColour', 'vec4')
  const core = attribute('coreColour', 'vec3')

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    // Depth is tested so a beam behind a wall stays behind it, and not written
    // so overlapping beams blend instead of clipping.
    depthWrite: false,
    blending: blend === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending,
    side: THREE.DoubleSide
  })

  const direction = normalize(modelViewMatrix.mul(vec4(along, 0)).xyz)
  const reach = direction.xy.length()
  // A beam pointing at the eye has no screen direction, so it takes a fixed
  // one rather than dividing by nothing.
  const turned = vec2(direction.y.negate(), direction.x).div(max(reach, 1e-4))
  const across = mix(vec2(1, 0), turned, step(1e-4, reach))
  const view = modelViewMatrix.mul(vec4(positionGeometry, 1))
  material.vertexNode = cameraProjectionMatrix.mul(
    vec4(view.xy.add(across.mul(side).mul(width)), view.z, view.w))

  const distance = abs(side)
  const middle = oneMinus(smoothstep(0, 0.34, distance))
  const glow = oneMinus(distance).pow(3)
  const alpha = clamp(middle.add(glow.mul(0.5)), 0, 1).mul(halo.a)
  material.colorNode = vec4(mix(halo.rgb, core, middle), alpha)
  // What the GLSL discarded: below this a beam only costs blending.
  material.alphaTest = 0.01
  return material
}


export function makePainter(THREE, TSL, scene) {
  const groups = new Map()   // blend -> { geometry, mesh, capacity }

  /** A strip of `capacity` quads, grown by doubling rather than per beam. */
  function groupFor(blend, quads) {
    let group = groups.get(blend)
    if (group && group.capacity >= quads) return group
    if (group) { scene.remove(group.mesh); group.geometry.dispose() }

    const size = Math.max(128, 1 << Math.ceil(Math.log2(Math.max(1, quads))))
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(size * 4 * 3), 3))
    geometry.setAttribute('along', new THREE.BufferAttribute(new Float32Array(size * 4 * 3), 3))
    geometry.setAttribute('side', new THREE.BufferAttribute(new Float32Array(size * 4), 1))
    geometry.setAttribute('beamWidth', new THREE.BufferAttribute(new Float32Array(size * 4), 1))
    geometry.setAttribute('haloColour', new THREE.BufferAttribute(new Float32Array(size * 4 * 4), 4))
    geometry.setAttribute('coreColour', new THREE.BufferAttribute(new Float32Array(size * 4 * 3), 3))

    // The index buffer never changes — two triangles for every quad that will
    // ever be drawn in this group.
    const index = new Uint32Array(size * 6)
    for (let quad = 0; quad < size; quad++) {
      const v = quad * 4
      index.set([v, v + 1, v + 2, v, v + 2, v + 3], quad * 6)
    }
    geometry.setIndex(new THREE.BufferAttribute(index, 1))

    const material = beamMaterial(THREE, TSL, blend)

    const mesh = new THREE.Mesh(geometry, material)
    // Vertices move every frame and are offset in view space, so the bounding
    // sphere three would compute is meaningless — cull it and it disappears.
    mesh.frustumCulled = false
    mesh.renderOrder = 3
    scene.add(mesh)

    group = { geometry, mesh, capacity: size }
    groups.set(blend, group)
    return group
  }

  /** One beam's quads written into a group's buffers from `quad` onward. */
  function writeBeam(group, quad, beams, record, time) {
    const spine = beams.points(record, time)
    const count = spine.length / 3
    const position = group.geometry.attributes.position
    const along = group.geometry.attributes.along
    const side = group.geometry.attributes.side
    const width = group.geometry.attributes.beamWidth
    const halo = group.geometry.attributes.haloColour
    const core = group.geometry.attributes.coreColour

    const haloRGB = readColour(record.colour)
    const fade = record.fadeTo ? readColour(record.fadeTo) : null
    const coreRGB = readColour(record.core)

    for (let i = 0; i < count - 1; i++) {
      const at = quad + i
      for (let end = 0; end < 2; end++) {
        const point = i + end
        const distanceAlong = point / (count - 1)
        const shape = beams.shapeAt(record, distanceAlong, time)
        let rgb = haloRGB
        // Colour over life slides towards `fadeTo` in linear light.
        if (fade) {
          const t = Math.min(1, (time - record.born) / record.life)
          rgb = { r: rgb.r + (fade.r - rgb.r) * t, g: rgb.g + (fade.g - rgb.g) * t, b: rgb.b + (fade.b - rgb.b) * t }
        }
        // Direction is read from the segment this vertex belongs to, so a
        // corner in the bolt turns the ribbon rather than shearing it.
        const ax = spine[(i + 1) * 3] - spine[i * 3]
        const ay = spine[(i + 1) * 3 + 1] - spine[i * 3 + 1]
        const az = spine[(i + 1) * 3 + 2] - spine[i * 3 + 2]

        // Corners run near-left, near-right, far-right, far-left so the two
        // triangles of the shared index buffer wind the same way.
        const corner = end === 0 ? [0, 3] : [1, 2]
        for (let c = 0; c < 2; c++) {
          const vertex = at * 4 + corner[c]
          position.setXYZ(vertex, spine[point * 3], spine[point * 3 + 1], spine[point * 3 + 2])
          along.setXYZ(vertex, ax, ay, az)
          side.setX(vertex, c === 0 ? -1 : 1)
          width.setX(vertex, shape.width)
          halo.setXYZW(vertex, rgb.r, rgb.g, rgb.b, shape.alpha)
          core.setXYZ(vertex, coreRGB.r, coreRGB.g, coreRGB.b)
        }
      }
    }
    return count - 1
  }

  return {
    sync(beams, time) {
      const live = beams?.all || []
      const byBlend = new Map()
      for (const record of live) {
        const list = byBlend.get(record.blend)
        if (list) list.push(record)
        else byBlend.set(record.blend, [record])
      }
      // A group that emptied still has a mesh and has to be told so, or the
      // last frame's bolt stays on screen.
      for (const blend of groups.keys()) if (!byBlend.has(blend)) byBlend.set(blend, [])

      for (const [blend, list] of byBlend) {
        let quads = 0
        for (const record of list) quads += record.segments
        const group = groupFor(blend, quads)

        let quad = 0
        for (const record of list) quad += writeBeam(group, quad, beams, record, time)

        for (const name of ['position', 'along', 'side', 'beamWidth', 'haloColour', 'coreColour']) {
          group.geometry.attributes[name].needsUpdate = true
        }
        group.geometry.setDrawRange(0, quad * 6)
      }
    }
  }
}

/**
 * A hex colour as linear floats. Three works in linear light and converts a
 * texture for you, but not a vertex colour — unconverted, every beam comes out
 * visibly too bright.
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
