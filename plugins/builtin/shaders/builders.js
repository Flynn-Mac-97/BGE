/**
 * The six sample shaders as node graphs.
 *
 * Split from `shaders.js` because that file owns the shelf — the table, the
 * panel, the command — and this one owns the drawing.
 *
 * Every one reads correctly on a flat quad or a single box face. Nothing here
 * needs a curved surface or a subdivided mesh: an edge comes from the distance
 * to the face border, a wave comes from a height field solved per pixel, and
 * the silhouette is an extra added on top rather than the whole effect.
 *
 * Three is never imported. The toolkit arrives as an argument, so a headless
 * world pays nothing to describe a shader it will not draw.
 */

/** A number a shader can use, or its default. */
const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

/** A number held inside a range, so a level that writes nonsense still draws. */
const held = (value, fallback, least, most) =>
  Math.min(most, Math.max(least, number(value, fallback)))

/**
 * A colour as three floats, from whatever the level wrote.
 *
 * Returned as plain numbers rather than a Color so the builders stay pure TSL
 * and can be read without knowing what three's Color is.
 */
function colourOf(THREE, value, fallback) {
  const colour = new THREE.Color(fallback)
  if (value !== null && value !== undefined) {
    try { colour.set(value) } catch { /* keep the fallback */ }
  }
  return [colour.r, colour.g, colour.b]
}

/** A direction of unit length, worked out once rather than in the graph. */
function unit([x, y, z]) {
  const size = Math.hypot(x, y, z) || 1
  return [x / size, y / size, z / size]
}

/**
 * Five waves crossing at different angles, lengths and speeds.
 *
 * The first three give the shape and the last two the fine detail that tells a
 * surface from a sheet of satin. `size` is how tall each one is relative to the
 * others, and their sum is what a crest is measured against.
 */
const WAVES = [
  { across: 1, along: 0.22, length: 1, speed: 1, size: 0.7 },
  { across: -0.62, along: 1, length: 0.62, speed: 0.83, size: 0.62 },
  { across: 0.38, along: -0.86, length: 0.37, speed: 1.37, size: 0.44 },
  { across: 0.88, along: 0.72, length: 0.19, speed: 1.7, size: 0.24 },
  { across: -0.45, along: -0.95, length: 0.11, speed: 2.2, size: 0.13 }
]
const WAVE_TOTAL = WAVES.reduce((sum, wave) => sum + wave.size, 0)

// Where the water takes its light from, and the halfway direction to the eye.
// Fixed rather than read from the scene: this is a stylised surface, and a sun
// that moves would drag every sparkle across it.
const WATER_LIGHT = unit([-0.35, 0.45, 0.82])
const WATER_HALF = unit([-0.35, 0.45, 1.82])

/**
 * The builders, one per shader.
 *
 * `SHADERS` is the shelf's own table, passed in so every default is written
 * once and both the description and the drawing read the same number.
 */
export function buildersFor(THREE, TSL, SHADERS) {
  const {
    abs, clamp, cos, dot, exp, float, floor, fract, fwidth, max, min, mix,
    mx_fractal_noise_float, mx_noise_float, normalize, normalView, oneMinus,
    positionLocal, positionViewDirection, screenCoordinate, sin, smoothstep,
    step, time, vec2, vec3, vec4
  } = TSL

  /** Distance to the nearest face border: 0 at the border, 0.5 in the middle. */
  const toBorder = point => min(min(point.x, oneMinus(point.x)), min(point.y, oneMinus(point.y)))

  /**
   * A line along the face border, the same width on screen at any distance.
   *
   * `fwidth` is how much the border distance changes across one pixel, so a
   * band measured in those units never thins to nothing far away, never fattens
   * up close, and never aliases.
   */
  const borderLine = (point, width) => {
    const distance = toBorder(point)
    const pixel = fwidth(distance).add(0.0001)
    return oneMinus(smoothstep(float(width).sub(pixel), float(width).add(pixel), distance))
  }

  /** How far a surface turns from the eye: 0 head-on, 1 at the silhouette. */
  const silhouette = () => oneMinus(abs(normalView.normalize().dot(positionViewDirection.normalize())))

  return {
    outline: ({ mesh, tint, uv }) => {
      const defaults = SHADERS.outline.parameters
      const edge = colourOf(THREE, mesh.edge, defaults.edge)
      const width = held(mesh.width, defaults.width, 0.001, 0.45)
      const power = held(mesh.power, defaults.power, 0.1, 16)
      const strength = held(mesh.strength, defaults.strength, 0, 8)
      const material = new THREE.MeshLambertNodeMaterial({ color: tint })
      // Brightest of three terms: the border line, light falling inward from
      // it, and the silhouette. The first two hold up on a flat face, which a
      // view-angle rim on its own cannot.
      const line = borderLine(uv.face(), width)
      const inward = oneMinus(smoothstep(0, width * 3, toBorder(uv.face()))).pow(2.2)
      const glow = max(line, max(inward.mul(0.35), silhouette().pow(power).mul(0.9)))
      material.emissiveNode = vec3(...edge).mul(glow.mul(strength))
      return material
    },

    aura: ({ mesh, uv }) => {
      const defaults = SHADERS.aura.parameters
      const glow = colourOf(THREE, mesh.glow, defaults.glow)
      const speed = held(mesh.speed, defaults.speed, 0, 20)
      const least = held(mesh.least, defaults.least, 0, 1)
      const detail = held(mesh.detail, defaults.detail, 0.1, 32)
      const strength = held(mesh.strength, defaults.strength, 0, 8)
      const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
      material.blending = THREE.AdditiveBlending
      const middle = uv.face().sub(0.5)
      // Soft from the middle of the face outward. A silhouette rim is zero
      // across a face pointed at the camera, which is how a sprite is arranged.
      const body = oneMinus(clamp(middle.length().mul(2), 0, 1)).pow(1.7)
      // Noise drifting on the clock breaks the disc into wisps. A disc with no
      // wisps reads as a lamp.
      const wisps = mx_fractal_noise_float(vec3(middle.mul(detail), time.mul(speed * 0.3))).mul(0.5).add(0.5)
      const breath = sin(time.mul(speed)).mul(0.5).add(0.5).mul(1 - least).add(least)
      const core = body.pow(8)
      const alpha = clamp(body.mul(mix(float(0.45), wisps, 0.75)).add(core).mul(breath), 0, 1)
      // White at the core, the glow colour outward. A hot centre is what makes
      // added light read as energy rather than a coloured smear.
      //
      // Alpha stays at 1. Additive blending already multiplies by it, so an
      // alpha that also carried the shape would square every soft edge and the
      // glow would shrink to a dot.
      material.colorNode = vec4(mix(vec3(...glow), vec3(1, 1, 1), core).mul(alpha.mul(strength)), 1)
      return material
    },

    waves: ({ mesh, uv }) => {
      const defaults = SHADERS.waves.parameters
      const shallow = colourOf(THREE, mesh.shallow, defaults.shallow)
      const deep = colourOf(THREE, mesh.deep, defaults.deep)
      const foam = colourOf(THREE, mesh.foam, defaults.foam)
      const scale = held(mesh.scale, defaults.scale, 0.1, 64)
      const speed = held(mesh.speed, defaults.speed, 0, 20)
      const choppy = held(mesh.choppy, defaults.choppy, 0, 4)
      const sparkle = held(mesh.sparkle, defaults.sparkle, 0, 8)
      const material = new THREE.MeshBasicNodeMaterial()

      // The height and both slopes come out of one sum, so the shading can
      // never drift out of step with the shape it is shading.
      let height = float(0)
      let slopeAcross = float(0)
      let slopeAlong = float(0)
      for (const wave of WAVES) {
        const frequency = (Math.PI * 2 * scale) / wave.length
        const phase = uv.metres().x.mul(wave.across * frequency)
          .add(uv.metres().y.mul(wave.along * frequency))
          .add(time.mul(speed * wave.speed))
        height = height.add(sin(phase).mul(wave.size))
        // The slope leaves the frequency out, so raising `scale` adds waves
        // without also turning every one of them into a cliff.
        const slope = cos(phase).mul(wave.size)
        slopeAcross = slopeAcross.add(slope.mul(wave.across))
        slopeAlong = slopeAlong.add(slope.mul(wave.along))
      }

      const normal = normalize(vec3(slopeAcross.mul(-choppy), slopeAlong.mul(-choppy), 1))
      // Half lambert: the light wraps past the terminator rather than stopping
      // at it, so a trough goes dark instead of black. The power then pulls the
      // midtones down, because water is mostly its deep colour.
      const lit = dot(normal, vec3(...WATER_LIGHT)).mul(0.5).add(0.5).pow(2.6)
      // A tight power on the halfway direction is the specular highlight, and
      // it is what turns a moving colour into a moving surface.
      const gloss = clamp(dot(normal, vec3(...WATER_HALF)), 0, 1).pow(160).mul(sparkle * 1.6)
      // Only the tallest crests foam, in a narrow band, so the foam reads as a
      // line along a wave rather than a wash over the top of it.
      const crest = smoothstep(0.68, 0.96, height.div(WAVE_TOTAL)).pow(1.5)
      const colour = mix(vec3(...deep), vec3(...shallow), lit)
        .add(vec3(...foam).mul(crest.mul(0.55)))
        .add(vec3(1, 1, 1).mul(gloss))
      material.colorNode = vec4(colour, 1)
      return material
    },

    hologram: ({ mesh, uv }) => {
      const defaults = SHADERS.hologram.parameters
      const glow = colourOf(THREE, mesh.glow, defaults.glow)
      const lines = held(mesh.lines, defaults.lines, 1, 400)
      const speed = held(mesh.speed, defaults.speed, 0, 20)
      const flicker = held(mesh.flicker, defaults.flicker, 0, 1)
      const glitch = held(mesh.glitch, defaults.glitch, 0, 0.5)
      const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
      material.blending = THREE.AdditiveBlending

      // Whole rows jump sideways for a moment. The noise is keyed on the row
      // and on the clock, so the same second always tears the same rows.
      const row = floor(uv.face().y.mul(26).add(time.mul(5)))
      const jump = mx_noise_float(vec3(row, floor(time.mul(7)), 0))
      const torn = jump.mul(step(0.62, abs(jump))).mul(glitch)
      const point = vec2(uv.face().x.add(torn), uv.face().y)

      // Soft stripes, not hard ones. A hard step turns to moire the moment the
      // face is further away than its line spacing.
      const stripes = smoothstep(0.25, 0.75, fract(point.y.mul(lines).sub(time.mul(speed))))
      const posts = smoothstep(0.7, 1, fract(point.x.mul(Math.max(1, lines * 0.25))))
      // A bright bar travelling up: what says the thing is being projected.
      const sweep = exp(fract(point.y.sub(time.mul(0.23))).sub(0.5).pow(2).mul(-240))
      const wobble = sin(time.mul(13)).mul(flicker).add(1)

      const strength = stripes.mul(0.36)
        .add(posts.mul(0.07))
        .add(borderLine(point, 0.02).mul(0.9))
        .add(sweep.mul(0.55))
        .add(silhouette().mul(0.5))
        .mul(wobble)
      // Alpha stays at 1 for the same reason the aura's does: additive blending
      // multiplies by it, and a second copy of the shape in there squares it.
      material.colorNode = vec4(
        mix(vec3(...glow), vec3(1, 1, 1), clamp(sweep.mul(0.6), 0, 1)).mul(strength), 1)
      return material
    },

    dissolve: ({ mesh, tint }) => {
      const defaults = SHADERS.dissolve.parameters
      const body = mesh.body === undefined ? null : colourOf(THREE, mesh.body, defaults.body)
      const edge = colourOf(THREE, mesh.edge, defaults.edge)
      const amount = held(mesh.amount, defaults.amount, 0, 1)
      const scale = held(mesh.scale, defaults.scale, 0.01, 64)
      const border = held(mesh.border, defaults.border, 0.001, 0.5)
      const strength = held(mesh.strength, defaults.strength, 0, 8)
      const material = new THREE.MeshLambertNodeMaterial({ transparent: true })
      const noise = mx_fractal_noise_float(positionLocal.mul(scale), 2, 2, 0.4).mul(0.5).add(0.5)
      material.opacityNode = step(amount, noise)
      material.colorNode = body ? vec3(...body) : vec3(tint.r, tint.g, tint.b)
      // Two bands: a wide one in the edge colour and a thin white one at the
      // cut itself. The white band is what reads as burning rather than fading.
      const burn = oneMinus(smoothstep(amount, amount + border, noise))
      const hot = oneMinus(smoothstep(amount, amount + border * 0.3, noise))
      material.emissiveNode = mix(vec3(...edge), vec3(1, 1, 1), hot).mul(burn.mul(strength))
      return material
    },

    gradient: ({ mesh, uv }) => {
      const defaults = SHADERS.gradient.parameters
      const from = colourOf(THREE, mesh.from, defaults.from)
      const to = colourOf(THREE, mesh.to, defaults.to)
      const middle = mesh.mid === undefined ? null : colourOf(THREE, mesh.mid, defaults.from)
      const angle = number(mesh.angle, defaults.angle) * Math.PI / 180
      const material = new THREE.MeshBasicNodeMaterial()

      // One coordinate along the chosen direction, scaled and offset so the
      // ramp spans the whole face at any angle rather than only at right ones.
      const across = Math.cos(angle)
      const along = Math.sin(angle)
      const spread = Math.abs(across) + Math.abs(along) || 1
      const start = (Math.max(0, -across) + Math.max(0, -along)) / spread
      const ramped = clamp(uv.face().x.mul(across / spread).add(uv.face().y.mul(along / spread)).add(start), 0, 1)
      const eased = smoothstep(0, 1, ramped)
      const colour = middle
        ? mix(mix(vec3(...from), vec3(...middle), clamp(eased.mul(2), 0, 1)),
            vec3(...to), clamp(eased.mul(2).sub(1), 0, 1))
        : mix(vec3(...from), vec3(...to), eased)

      // A ramp across a face crosses far fewer than 256 steps of a channel, so
      // it bands. Under half a step of noise per pixel breaks the bands up and
      // is invisible on its own.
      const speckle = fract(sin(dot(screenCoordinate, vec2(12.9898, 78.233))).mul(43758.5453))
      material.colorNode = vec4(colour.add(speckle.sub(0.5).div(255)), 1)
      return material
    }
  }
}
