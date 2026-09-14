/**
 * Blender's shader nodes, as TSL.
 *
 * One entry per Blender node type. Each is handed the values already computed
 * for its inputs and returns one value, so nothing here walks the graph — the
 * translator does that, and this file is only maths.
 *
 * Three and TSL arrive as arguments. A headless world lists what can be
 * translated without loading either.
 *
 * Two kinds of value travel through a graph:
 *
 *   data     a number or a colour, carrying its width: 1 or 3
 *   surface  what a BSDF answers — colour, roughness, metal, alpha, emission
 *            and normal together
 *
 * A surface is a bundle rather than a colour because Mix Shader blends every
 * part of two surfaces at once, and carrying only the colour would silently
 * drop the roughness of whatever it mixed. Blender converts between a number
 * and a colour silently, so every data value says which it is.
 */

/** A number or a colour. `size` is 1 or 3. */
const value = (node, size) => ({ node, size })

/** What a BSDF answers. Any part may be absent, and takes Blender's default. */
const surface = parts => ({ surface: true, ...parts })

/**
 * The toolkit, bound once per build.
 *
 * `textureFor(name)` gives the image a Texture Image node asks for, or null
 * when it was not exported. Returned rather than held in module state so two
 * materials never share a half-built toolkit.
 */
export function toolkit(TSL, { textureFor = () => null } = {}) {
  const {
    float, vec2, vec3, mix, smoothstep, step, clamp, fract, floor, abs, sin, cos, tan,
    asin, acos, atan, sinh, cosh, tanh, radians, degrees, pow, sqrt, min, max, sign, mod,
    exp, log, dot, cross, normalize, length, oneMinus, luminance, saturate, round, ceil,
    trunc, distance, reflect, refract, faceForward, bumpMap, normalMap,
    positionLocal, positionWorld, normalLocal, normalView, positionView, modelPosition,
    cameraPosition, uv: tslUV, attribute, texture: tslTexture,
    mx_fractal_noise_float, mx_worley_noise_float, mx_worley_noise_vec3,
    mx_cell_noise_float, mx_rotate3d, mx_rgbtohsv, mx_hsvtorgb
  } = TSL

  /** As one number. A colour becomes its brightness, the way Blender reads it. */
  const asFloat = item => (item.size === 1 ? item.node : luminance(item.node))

  /** As three numbers. A number is spread across all three, the way Blender does. */
  const asVec3 = item => (item.size === 3 ? item.node : vec3(item.node))

  /** A constant from the dumped graph, which stores colours as four numbers. */
  const constant = raw => {
    if (raw === null || raw === undefined) return value(float(0), 1)
    if (Array.isArray(raw)) {
      return raw.length >= 3 ? value(vec3(raw[0], raw[1], raw[2]), 3) : value(float(raw[0] || 0), 1)
    }
    return value(float(Number(raw) || 0), 1)
  }

  /** Blender's own defaults, for a part of a surface nothing set. */
  const DEFAULTS = {
    colour: () => vec3(0.8, 0.8, 0.8),
    roughness: () => float(0.5),
    metallic: () => float(0),
    alpha: () => float(1),
    emission: () => vec3(0, 0, 0),
    normal: () => null
  }

  /** One part of a surface, or Blender's default for it. */
  const part = (item, name) => item?.[name] ?? DEFAULTS[name]()

  /** Data read as a surface: a colour on its own is a surface of that colour. */
  const asSurface = item => (item?.surface ? item : surface({ colour: asVec3(item) }))

  // ------------------------------------------------------- shared workings

  /** Blender's noise takes a position and a scale, and answers 0 to 1. */
  const noiseAt = (position, scale, detail, roughness, lacunarity) => {
    const octaves = Math.min(8, Math.max(1, Math.round(detail) + 1))
    // MaterialX fractal noise answers -1 to 1; Blender's answers 0 to 1.
    return mx_fractal_noise_float(position.mul(scale), octaves, lacunarity, roughness)
      .mul(0.5).add(0.5)
  }

  /**
   * A colour ramp, as a chain of mixes between neighbouring stops.
   *
   * Built from the stops rather than a texture so it needs no upload and reads
   * the same headless. `CONSTANT` steps at each stop; everything else blends,
   * with `EASE` smoothed.
   */
  const ramp = (factor, stops, interpolation) => {
    const sorted = [...stops].sort((one, two) => one.position - two.position)
    if (!sorted.length) return vec3(0)
    let result = vec3(sorted[0].colour[0], sorted[0].colour[1], sorted[0].colour[2])
    for (let at = 1; at < sorted.length; at++) {
      const from = sorted[at - 1], to = sorted[at]
      const colour = vec3(to.colour[0], to.colour[1], to.colour[2])
      const span = Math.max(1e-6, to.position - from.position)
      const along = clamp(factor.sub(from.position).div(span), 0, 1)
      const blend = interpolation === 'CONSTANT' ? step(1, along)
        : interpolation === 'EASE' ? smoothstep(0, 1, along)
          : along
      result = mix(result, colour, blend)
    }
    return result
  }

  /**
   * A drawn curve, sampled straight between the points it was drawn with.
   *
   * Blender rounds its curve handles more smoothly than this. Points cluster
   * wherever a curve turns, so the difference is small, and a curve is a shape
   * an author judges by eye rather than a formula.
   */
  const curve = (input, points) => {
    if (!points || points.length < 2) return input
    const sorted = [...points].sort((one, two) => one.x - two.x)
    let result = float(sorted[0].y)
    for (let at = 1; at < sorted.length; at++) {
      const from = sorted[at - 1], to = sorted[at]
      const span = Math.max(1e-6, to.x - from.x)
      const along = clamp(input.sub(from.x).div(span), 0, 1)
      result = mix(result, float(to.y), along)
    }
    return result
  }

  // ------------------------------------------------------------------ maths

  /** Blender's Math node, by its operation name. */
  const MATHS = {
    ADD: (a, b) => a.add(b),
    SUBTRACT: (a, b) => a.sub(b),
    MULTIPLY: (a, b) => a.mul(b),
    DIVIDE: (a, b) => a.div(b),
    MULTIPLY_ADD: (a, b, c) => a.mul(b).add(c),
    POWER: (a, b) => pow(max(a, float(0)), b),
    LOGARITHM: a => log(a),
    SQRT: a => sqrt(a),
    INVERSE_SQRT: a => float(1).div(sqrt(a)),
    ABSOLUTE: a => abs(a),
    EXPONENT: a => exp(a),
    MINIMUM: (a, b) => min(a, b),
    MAXIMUM: (a, b) => max(a, b),
    LESS_THAN: (a, b) => oneMinus(step(b, a)),
    GREATER_THAN: (a, b) => step(b, a),
    // 1 when the two are within the third value of each other.
    COMPARE: (a, b, c) => oneMinus(step(c, abs(a.sub(b)))),
    SIGN: a => sign(a),
    ROUND: a => round(a),
    FLOOR: a => floor(a),
    CEIL: a => ceil(a),
    TRUNC: a => trunc(a),
    FRACT: a => fract(a),
    MODULO: (a, b) => mod(a, b),
    FLOORED_MODULO: (a, b) => a.sub(floor(a.div(b)).mul(b)),
    WRAP: (a, b, c) => c.add(mod(a.sub(c), b.sub(c))),
    SNAP: (a, b) => floor(a.div(b)).mul(b),
    // Folds back at each end, so it never leaves 0 to b.
    PINGPONG: (a, b) => abs(fract(a.div(b.mul(2))).mul(2).sub(1)).mul(b),
    SINE: a => sin(a),
    COSINE: a => cos(a),
    TANGENT: a => tan(a),
    ARCSINE: a => asin(a),
    ARCCOSINE: a => acos(a),
    ARCTANGENT: a => atan(a),
    ARCTAN2: (a, b) => atan(a, b),
    SINH: a => sinh(a),
    COSH: a => cosh(a),
    TANH: a => tanh(a),
    RADIANS: a => radians(a),
    DEGREES: a => degrees(a),
    SMOOTH_MIN: (a, b, c) => {
      const blend = saturate(b.sub(a).div(max(c, float(1e-6))).mul(0.5).add(0.5))
      return mix(b, a, blend).sub(c.mul(blend).mul(oneMinus(blend)))
    },
    SMOOTH_MAX: (a, b, c) => {
      const blend = saturate(a.sub(b).div(max(c, float(1e-6))).mul(0.5).add(0.5))
      return mix(b, a, blend).add(c.mul(blend).mul(oneMinus(blend)))
    }
  }

  /** Blender's Mix Color blend modes. */
  const BLENDS = {
    MIX: (a, b) => b,
    ADD: (a, b) => a.add(b),
    SUBTRACT: (a, b) => a.sub(b),
    MULTIPLY: (a, b) => a.mul(b),
    DIVIDE: (a, b) => a.div(b),
    SCREEN: (a, b) => oneMinus(oneMinus(a).mul(oneMinus(b))),
    DIFFERENCE: (a, b) => abs(a.sub(b)),
    DARKEN: (a, b) => min(a, b),
    LIGHTEN: (a, b) => max(a, b),
    OVERLAY: (a, b) => mix(
      a.mul(b).mul(2),
      oneMinus(oneMinus(a).mul(oneMinus(b)).mul(2)),
      step(0.5, a)),
    BURN: (a, b) => oneMinus(oneMinus(a).div(max(b, float(0.001)))),
    DODGE: (a, b) => a.div(max(oneMinus(b), float(0.001))),
    LINEAR_LIGHT: (a, b) => a.add(b.mul(2)).sub(1),
    SOFT_LIGHT: (a, b) => mix(a.mul(b), oneMinus(oneMinus(a).mul(oneMinus(b))), b)
  }

  /** Vector Math. Returns a value, because a few of them answer one number. */
  const VECTOR_MATHS = {
    ADD: (a, b) => value(asVec3(a).add(asVec3(b)), 3),
    SUBTRACT: (a, b) => value(asVec3(a).sub(asVec3(b)), 3),
    MULTIPLY: (a, b) => value(asVec3(a).mul(asVec3(b)), 3),
    DIVIDE: (a, b) => value(asVec3(a).div(asVec3(b)), 3),
    MULTIPLY_ADD: (a, b, c) => value(asVec3(a).mul(asVec3(b)).add(asVec3(c)), 3),
    SCALE: (a, b) => value(asVec3(a).mul(asFloat(b)), 3),
    DOT_PRODUCT: (a, b) => value(dot(asVec3(a), asVec3(b)), 1),
    CROSS_PRODUCT: (a, b) => value(cross(asVec3(a), asVec3(b)), 3),
    PROJECT: (a, b) => {
      const onto = asVec3(b)
      return value(onto.mul(dot(asVec3(a), onto).div(max(dot(onto, onto), float(1e-6)))), 3)
    },
    REFLECT: (a, b) => value(reflect(asVec3(a), normalize(asVec3(b))), 3),
    REFRACT: (a, b, c) => value(refract(asVec3(a), normalize(asVec3(b)), asFloat(c)), 3),
    FACEFORWARD: (a, b, c) => value(faceForward(asVec3(a), asVec3(b), asVec3(c)), 3),
    DISTANCE: (a, b) => value(distance(asVec3(a), asVec3(b)), 1),
    LENGTH: a => value(length(asVec3(a)), 1),
    NORMALIZE: a => value(normalize(asVec3(a)), 3),
    ABSOLUTE: a => value(abs(asVec3(a)), 3),
    MINIMUM: (a, b) => value(min(asVec3(a), asVec3(b)), 3),
    MAXIMUM: (a, b) => value(max(asVec3(a), asVec3(b)), 3),
    FRACTION: a => value(fract(asVec3(a)), 3),
    FLOOR: a => value(floor(asVec3(a)), 3),
    CEIL: a => value(ceil(asVec3(a)), 3),
    MODULO: (a, b) => value(mod(asVec3(a), asVec3(b)), 3),
    SNAP: (a, b) => value(floor(asVec3(a).div(asVec3(b))).mul(asVec3(b)), 3),
    WRAP: (a, b, c) => {
      const low = asVec3(c), high = asVec3(b)
      return value(low.add(mod(asVec3(a).sub(low), high.sub(low))), 3)
    },
    SINE: a => value(sin(asVec3(a)), 3),
    COSINE: a => value(cos(asVec3(a)), 3),
    TANGENT: a => value(tan(asVec3(a)), 3)
  }

  /**
   * Where a texture is sampled when nothing is plugged into its Vector.
   *
   * Blender's default is Generated coordinates, the object's own bounding box.
   * Local position is the nearest a renderer has, and it keeps a procedural
   * texture stuck to the model rather than to the screen.
   */
  const coordinates = (read, linked) =>
    (linked('Vector') ? asVec3(read('Vector')) : positionLocal)

  /**
   * A surface's alpha, or undefined when it is always 1.
   *
   * Undefined keeps the material opaque. A transparent material is sorted and
   * drawn after every opaque one, which costs depth order for nothing.
   */
  const seeThrough = (read, linked) => {
    const alpha = read('Alpha')
    return linked('Alpha') || (alpha.constant ?? 1) < 1 ? asFloat(alpha) : undefined
  }

  /** How much the surface faces the eye. 1 head on, 0 at the silhouette. */
  const facing = () => saturate(dot(normalize(normalView), vec3(0, 0, 1)))

  // -------------------------------------------------------------- the table

  const NODES = {
    // ----------------------------------------------------------- coordinates
    TEX_COORD: (read, properties, socket) => {
      if (socket.name === 'UV') return value(vec3(tslUV(), 0), 3)
      if (socket.name === 'Normal') return value(normalLocal, 3)
      if (socket.name === 'Camera') return value(positionView, 3)
      if (socket.name === 'Window') return value(vec3(tslUV(), 0), 3)
      if (socket.name === 'Reflection') return value(reflect(normalize(positionView), normalView), 3)
      // Object and Generated both mean the model's own space here.
      return value(positionLocal, 3)
    },

    UVMAP: () => value(vec3(tslUV(), 0), 3),

    NEW_GEOMETRY: (read, properties, socket) => {
      if (socket.name === 'Normal' || socket.name === 'True Normal') return value(normalLocal, 3)
      if (socket.name === 'Incoming') return value(normalize(cameraPosition.sub(positionWorld)), 3)
      if (socket.name === 'Backfacing') return value(float(0), 1)
      if (socket.name === 'Pointiness') return value(float(0.5), 1)
      return value(positionLocal, 3)
    },

    OBJECT_INFO: (read, properties, socket) => {
      if (socket.name === 'Location') return value(modelPosition.xyz, 3)
      // One number per object, taken from where it stands: no instance id
      // reaches a shader here, and a constant would make every copy identical.
      if (socket.name === 'Random') return value(fract(mx_cell_noise_float(modelPosition.xyz)), 1)
      if (socket.name === 'Color') return value(vec3(1, 1, 1), 3)
      return value(float(0), 1)
    },

    ATTRIBUTE: (read, properties, socket) => {
      const read3 = attribute(properties.attribute_name || 'color', 'vec3')
      return socket.name === 'Fac' || socket.name === 'Factor'
        ? value(luminance(read3), 1)
        : value(read3, 3)
    },

    VERTEX_COLOR: (read, properties, socket) => {
      const colour = attribute(properties.layer_name || 'color', 'vec4')
      return socket.name === 'Alpha' ? value(colour.w, 1) : value(colour.xyz, 3)
    },

    // Both hold their number on the output socket, which the dump copies here.
    VALUE: (read, properties) => constant(properties.value),
    RGB: (read, properties) => constant(properties.value),

    MAPPING: (read, properties) => {
      const vector = asVec3(read('Vector'))
      const location = asVec3(read('Location'))
      const rotation = asVec3(read('Rotation'))
      const scale = asVec3(read('Scale'))
      const kind = properties.vector_type || 'POINT'

      // Blender applies scale, then rotation, then location.
      let result = kind === 'TEXTURE' ? vector.sub(location) : vector.mul(scale)
      result = mx_rotate3d(result, rotation.x, vec3(1, 0, 0))
      result = mx_rotate3d(result, rotation.y, vec3(0, 1, 0))
      result = mx_rotate3d(result, rotation.z, vec3(0, 0, 1))
      if (kind === 'POINT') result = result.add(location)
      if (kind === 'TEXTURE') result = result.div(scale)
      if (kind === 'NORMAL') result = normalize(result)
      return value(result, 3)
    },

    VECTOR_ROTATE: (read, properties) => {
      const centre = asVec3(read('Center'))
      const about = properties.rotation_type === 'Z_AXIS' ? vec3(0, 0, 1)
        : properties.rotation_type === 'Y_AXIS' ? vec3(0, 1, 0)
          : properties.rotation_type === 'X_AXIS' ? vec3(1, 0, 0)
            : normalize(asVec3(read('Axis')))
      const turned = mx_rotate3d(asVec3(read('Vector')).sub(centre), asFloat(read('Angle')), about)
      return value(turned.add(centre), 3)
    },

    // -------------------------------------------------------------- textures
    TEX_IMAGE: (read, properties, socket, linked) => {
      const image = textureFor(properties.image)
      // A graph naming an image that was not exported is refused before it is
      // built. Kept so a hand-written graph cannot take the build down.
      if (!image) return socket.name === 'Alpha' ? value(float(1), 1) : value(vec3(0.8), 3)
      const where = linked('Vector') ? asVec3(read('Vector')).xy : tslUV()
      const sampled = tslTexture(image, where)
      return socket.name === 'Alpha' ? value(sampled.w, 1) : value(sampled.xyz, 3)
    },

    TEX_NOISE: (read, properties, socket, linked) => {
      const position = coordinates(read, linked)
      const scale = read('Scale').node
      const detail = read('Detail').constant ?? 2
      const roughness = read('Roughness').constant ?? 0.5
      const lacunarity = read('Lacunarity').constant ?? 2
      // A 2D noise ignores depth, which is what Blender's dimension setting does.
      const sampled = properties.noise_dimensions === '2D'
        ? vec3(position.x, position.y, 0)
        : position
      const noise = noiseAt(sampled, scale, detail, roughness, lacunarity)
      // Blender's Color output is three noises offset from one another.
      if (socket.name === 'Color') {
        return value(vec3(
          noise,
          noiseAt(sampled.add(vec3(19.1, 33.4, 47.2)), scale, detail, roughness, lacunarity),
          noiseAt(sampled.add(vec3(73.7, 91.3, 11.5)), scale, detail, roughness, lacunarity)
        ), 3)
      }
      return value(noise, 1)
    },

    TEX_WHITE_NOISE: (read, properties, socket, linked) => {
      const noise = fract(mx_cell_noise_float(coordinates(read, linked)))
      return socket.name === 'Color' ? value(vec3(noise), 3) : value(noise, 1)
    },

    TEX_VORONOI: (read, properties, socket, linked) => {
      const position = coordinates(read, linked).mul(read('Scale').node)
      const jitter = read('Randomness').constant ?? 1
      // MaterialX answers the two closest distances and the edge together.
      const cells = mx_worley_noise_vec3(position, jitter, 1)
      const feature = properties.feature || 'F1'
      const picked = feature === 'F2' ? cells.y
        : feature === 'DISTANCE_TO_EDGE' ? cells.z
          : cells.x
      if (socket.name === 'Color') return value(vec3(mx_worley_noise_float(position, jitter, 2)), 3)
      if (socket.name === 'Position') return value(floor(position), 3)
      return value(picked, 1)
    },

    TEX_CHECKER: (read, properties, socket, linked) => {
      const scaled = coordinates(read, linked).mul(read('Scale').node)
      const squares = mod(floor(scaled.x).add(floor(scaled.y)).add(floor(scaled.z)), 2)
      if (socket.name === 'Fac' || socket.name === 'Factor') return value(squares, 1)
      return value(mix(asVec3(read(1)), asVec3(read(2)), squares), 3)
    },

    TEX_BRICK: (read, properties, socket, linked) => {
      const scaled = coordinates(read, linked).mul(read('Scale').node)
      const mortar = read('Mortar Size').node
      const row = floor(scaled.y)
      // Every other row is shifted along, which is what makes it brick.
      const shift = mod(row, 2).mul(properties.offset ?? 0.5)
      const along = fract(scaled.x.add(shift))
      const up = fract(scaled.y)
      const edge = where => max(oneMinus(step(mortar, where)), step(oneMinus(mortar), where))
      const factor = saturate(max(edge(along), edge(up)))
      if (socket.name === 'Fac' || socket.name === 'Factor') return value(factor, 1)
      // A tone per brick, so neighbours differ.
      const tone = fract(mx_cell_noise_float(vec3(floor(scaled.x.add(shift)), row, 0)))
      const brick = mix(asVec3(read('Color1')), asVec3(read('Color2')), tone)
      return value(mix(brick, asVec3(read('Mortar')), factor), 3)
    },

    TEX_MAGIC: (read, properties, socket, linked) => {
      const position = coordinates(read, linked).mul(read('Scale').node)
      const distortion = read('Distortion').node
      // Blender's magic texture is sines folded through one another.
      const colour = vec3(
        sin(position.x.add(position.y).mul(distortion)),
        cos(position.y.sub(position.z).mul(distortion)),
        sin(position.z.add(position.x).mul(distortion))
      ).mul(0.5).add(0.5)
      return socket.name === 'Color' ? value(colour, 3) : value(luminance(colour), 1)
    },

    TEX_GRADIENT: (read, properties, socket, linked) => {
      const position = coordinates(read, linked)
      const kind = properties.gradient_type || 'LINEAR'
      const along =
        kind === 'QUADRATIC' ? position.x.mul(position.x)
          : kind === 'EASING' ? smoothstep(0, 1, position.x)
            : kind === 'DIAGONAL' ? position.x.add(position.y).mul(0.5)
              : kind === 'SPHERICAL' ? oneMinus(length(position))
                : kind === 'QUADRATIC_SPHERE' ? pow(oneMinus(length(position)), float(2))
                  : kind === 'RADIAL' ? atan(position.y, position.x).div(Math.PI * 2).add(0.5)
                    : position.x
      const held = saturate(along)
      return socket.name === 'Color' ? value(vec3(held), 3) : value(held, 1)
    },

    TEX_WAVE: (read, properties, socket, linked) => {
      const scaled = coordinates(read, linked).mul(read('Scale').node)
      const along = properties.wave_type === 'RINGS'
        ? length(vec2(scaled.x, scaled.y))
        : scaled.x
      const detail = read('Detail').constant ?? 2
      const phase = along.add(
        noiseAt(scaled, float(1), detail, 0.5, 2).sub(0.5).mul(2).mul(read('Distortion').node))
      const profile = properties.wave_profile || 'SIN'
      const wave = profile === 'SAW' ? fract(phase)
        : profile === 'TRI' ? abs(fract(phase).mul(2).sub(1))
          : sin(phase.mul(Math.PI * 2)).mul(0.5).add(0.5)
      return socket.name === 'Color' ? value(vec3(wave), 3) : value(wave, 1)
    },

    // --------------------------------------------------------------- utility
    VALTORGB: (read, properties, socket) => {
      const colour = ramp(asFloat(read('Fac')), properties.stops || [], properties.interpolation)
      return socket.name === 'Alpha' ? value(float(1), 1) : value(colour, 3)
    },

    CURVE_RGB: (read, properties) => {
      const colour = asVec3(read('Color'))
      const curves = properties.curves || []
      // Blender's fourth curve shapes all three channels, after their own.
      const shaped = vec3(
        curve(curve(colour.x, curves[0]), curves[3]),
        curve(curve(colour.y, curves[1]), curves[3]),
        curve(curve(colour.z, curves[2]), curves[3]))
      return value(mix(colour, shaped, asFloat(read('Fac'))), 3)
    },

    CURVE_FLOAT: (read, properties) => {
      const input = asFloat(read('Value'))
      return value(mix(input, curve(input, (properties.curves || [])[0]), asFloat(read('Factor'))), 1)
    },

    CURVE_VEC: (read, properties) => {
      const vector = asVec3(read('Vector'))
      const curves = properties.curves || []
      const shaped = vec3(
        curve(vector.x, curves[0]), curve(vector.y, curves[1]), curve(vector.z, curves[2]))
      return value(mix(vector, shaped, asFloat(read('Fac'))), 3)
    },

    // Read by position: the legacy Mix Color's names are unique, the new Mix
    // node's are not, and Math's three inputs are all called "Value".
    MIX_RGB: (read, properties) => {
      const blend = BLENDS[properties.blend_type] || BLENDS.MIX
      const first = asVec3(read(1))
      const result = mix(first, blend(first, asVec3(read(2))), asFloat(read(0)))
      return value(properties.use_clamp ? saturate(result) : result, 3)
    },

    MIX: (read, properties) => {
      const blend = BLENDS[properties.blend_type] || BLENDS.MIX
      // One socket pair per data type, all named A and B: floats at 2 and 3,
      // vectors at 4 and 5, colours at 6 and 7.
      const kind = properties.data_type || 'RGBA'
      const at = kind === 'FLOAT' ? [2, 3] : kind === 'VECTOR' ? [4, 5] : [6, 7]
      const asNumbers = kind === 'FLOAT'
      const first = asNumbers ? asFloat(read(at[0])) : asVec3(read(at[0]))
      const second = asNumbers ? asFloat(read(at[1])) : asVec3(read(at[1]))
      return value(mix(first, blend(first, second), asFloat(read(0))), asNumbers ? 1 : 3)
    },

    MATH: (read, properties) => {
      const operation = MATHS[properties.operation] || MATHS.ADD
      const result = operation(asFloat(read(0)), asFloat(read(1)), asFloat(read(2)))
      return value(properties.use_clamp ? saturate(result) : result, 1)
    },

    VECT_MATH: (read, properties) => {
      const operation = VECTOR_MATHS[properties.operation] || VECTOR_MATHS.ADD
      // Scale takes its amount from a fourth socket, not from a second vector.
      const second = properties.operation === 'SCALE' ? read(3) : read(1)
      return operation(read(0), second, read(2))
    },

    SEPXYZ: (read, properties, socket) => {
      const vector = asVec3(read('Vector'))
      return value({ X: vector.x, Y: vector.y, Z: vector.z }[socket.name] || vector.x, 1)
    },
    COMBXYZ: read =>
      value(vec3(asFloat(read('X')), asFloat(read('Y')), asFloat(read('Z'))), 3),

    SEPARATE_COLOR: (read, properties, socket) => {
      const colour = asVec3(read('Color'))
      const parts = properties.mode === 'HSV' ? mx_rgbtohsv(colour) : colour
      const named = {
        Red: parts.x, Green: parts.y, Blue: parts.z,
        Hue: parts.x, Saturation: parts.y, Value: parts.z
      }
      return value(named[socket.name] || parts.x, 1)
    },
    COMBINE_COLOR: (read, properties) => {
      const made = vec3(asFloat(read(0)), asFloat(read(1)), asFloat(read(2)))
      return value(properties.mode === 'HSV' ? mx_hsvtorgb(made) : made, 3)
    },

    SEPHSV: (read, properties, socket) => {
      const hsv = mx_rgbtohsv(asVec3(read('Color')))
      return value({ H: hsv.x, S: hsv.y, V: hsv.z }[socket.name] || hsv.x, 1)
    },
    COMBHSV: read =>
      value(mx_hsvtorgb(vec3(asFloat(read('H')), asFloat(read('S')), asFloat(read('V')))), 3),

    CLAMP: read =>
      value(clamp(asFloat(read('Value')), asFloat(read('Min')), asFloat(read('Max'))), 1),

    // Float sockets are 0 to 5; the vector set repeats the same names at 6 to 11.
    MAP_RANGE: (read, properties) => {
      const source = asFloat(read(0))
      const fromLow = asFloat(read(1)), fromHigh = asFloat(read(2))
      const toLow = asFloat(read(3)), toHigh = asFloat(read(4))
      let along = source.sub(fromLow).div(max(fromHigh.sub(fromLow), float(1e-6)))
      if (properties.interpolation_type === 'SMOOTHSTEP') along = smoothstep(0, 1, saturate(along))
      const result = toLow.add(along.mul(toHigh.sub(toLow)))
      return value(properties.clamp ? clamp(result, min(toLow, toHigh), max(toLow, toHigh)) : result, 1)
    },

    INVERT: read => {
      const colour = asVec3(read('Color'))
      return value(mix(colour, oneMinus(colour), asFloat(read('Fac'))), 3)
    },

    GAMMA: read => value(pow(max(asVec3(read('Color')), vec3(0)), vec3(asFloat(read('Gamma')))), 3),

    BRIGHTCONTRAST: read => {
      const colour = asVec3(read('Color'))
      const contrast = asFloat(read('Contrast'))
      return value(colour.sub(0.5).mul(contrast.add(1)).add(0.5).add(asFloat(read('Bright'))), 3)
    },

    HUE_SAT: read => {
      const colour = asVec3(read('Color'))
      const hsv = mx_rgbtohsv(colour)
      const shifted = vec3(
        fract(hsv.x.add(asFloat(read('Hue'))).add(0.5)),
        saturate(hsv.y.mul(asFloat(read('Saturation')))),
        hsv.z.mul(asFloat(read('Value'))))
      return value(mix(colour, mx_hsvtorgb(shifted), asFloat(read('Fac'))), 3)
    },

    RGBTOBW: read => value(luminance(asVec3(read('Color'))), 1),

    BLACKBODY: read => {
      // A straight read of the Planckian curve over the range a material uses:
      // warm below 5000 K, blue above it.
      const kelvin = asFloat(read('Temperature'))
      const warm = saturate(kelvin.sub(1000).div(4000))
      const cool = saturate(kelvin.sub(5000).div(7000))
      return value(mix(mix(vec3(1, 0.35, 0.05), vec3(1, 1, 1), warm), vec3(0.6, 0.75, 1), cool), 3)
    },

    FRESNEL: read => {
      // Schlick against the surface normal, which is what a raster renderer has.
      const ior = asFloat(read('IOR'))
      const straight = ior.sub(1).div(ior.add(1))
      const least = straight.mul(straight)
      return value(saturate(least.add(oneMinus(least).mul(pow(oneMinus(facing()), float(5))))), 1)
    },

    LAYER_WEIGHT: (read, properties, socket) => {
      const blend = clamp(asFloat(read('Blend')), 0, 0.99)
      const bent = pow(oneMinus(facing()), blend.div(oneMinus(blend)))
      return socket.name === 'Facing' ? value(oneMinus(bent), 1) : value(bent, 1)
    },

    // --------------------------------------------------------------- normals
    BUMP: (read, properties) => {
      const strength = asFloat(read('Strength')).mul(asFloat(read('Distance')))
      const height = asFloat(read('Height'))
      return value(bumpMap(height, properties.invert ? strength.negate() : strength), 3)
    },

    NORMAL_MAP: read =>
      value(normalMap(asVec3(read('Color')), asFloat(read('Strength'))), 3),

    NORMAL: (read, properties, socket) => {
      const direction = normalize(asVec3(read('Normal')))
      return socket.name === 'Dot' ? value(dot(direction, normalLocal), 1) : value(direction, 3)
    },

    // -------------------------------------------------------------- surfaces
    BSDF_PRINCIPLED: (read, properties, socket, linked) => surface({
      colour: asVec3(read('Base Color')),
      metallic: asFloat(read('Metallic')),
      roughness: asFloat(read('Roughness')),
      alpha: seeThrough(read, linked),
      emission: asVec3(read('Emission Color')).mul(asFloat(read('Emission Strength'))),
      normal: linked('Normal') ? asVec3(read('Normal')) : null
    }),

    EMISSION: read => surface({
      colour: vec3(0, 0, 0),
      emission: asVec3(read('Color')).mul(asFloat(read('Strength')))
    }),

    BSDF_DIFFUSE: (read, properties, socket, linked) => surface({
      colour: asVec3(read('Color')),
      roughness: float(1),
      metallic: float(0),
      normal: linked('Normal') ? asVec3(read('Normal')) : null
    }),

    BSDF_GLOSSY: (read, properties, socket, linked) => surface({
      colour: asVec3(read('Color')),
      roughness: asFloat(read('Roughness')),
      metallic: float(1),
      normal: linked('Normal') ? asVec3(read('Normal')) : null
    }),

    BSDF_TRANSPARENT: read => surface({
      colour: asVec3(read('Color')),
      alpha: float(0),
      roughness: float(0)
    }),

    // Nothing refracts in a raster pass: glass reads as a smooth, mostly clear
    // surface tinted by its own colour.
    BSDF_GLASS: read => surface({
      colour: asVec3(read('Color')),
      roughness: asFloat(read('Roughness')),
      metallic: float(0),
      alpha: float(0.25)
    }),

    BSDF_TRANSLUCENT: read => surface({ colour: asVec3(read('Color')), roughness: float(1) }),

    BACKGROUND: read => surface({
      colour: vec3(0, 0, 0),
      emission: asVec3(read('Color')).mul(asFloat(read('Strength')))
    }),

    MIX_SHADER: read => {
      const factor = asFloat(read(0))
      const first = asSurface(read(1))
      const second = asSurface(read(2))
      const blend = name => mix(part(first, name), part(second, name), factor)
      return surface({
        colour: blend('colour'),
        roughness: blend('roughness'),
        metallic: blend('metallic'),
        alpha: first.alpha || second.alpha ? blend('alpha') : undefined,
        emission: blend('emission'),
        normal: first.normal || second.normal || null
      })
    },

    ADD_SHADER: read => {
      const first = asSurface(read(0))
      const second = asSurface(read(1))
      return surface({
        colour: part(first, 'colour').add(part(second, 'colour')),
        emission: part(first, 'emission').add(part(second, 'emission')),
        roughness: mix(part(first, 'roughness'), part(second, 'roughness'), 0.5),
        metallic: mix(part(first, 'metallic'), part(second, 'metallic'), 0.5),
        alpha: first.alpha || second.alpha ? max(part(first, 'alpha'), part(second, 'alpha')) : undefined,
        normal: first.normal || second.normal || null
      })
    }
  }

  return { NODES, constant, asFloat, asVec3, asSurface, part, value, surface }
}

/**
 * Every Blender node type that translates.
 *
 * Listed rather than read off the table so a headless run reports it without
 * loading three. A test holds the two lists together.
 */
export const TRANSLATABLE_TYPES = [
  'TEX_COORD', 'UVMAP', 'NEW_GEOMETRY', 'OBJECT_INFO', 'ATTRIBUTE', 'VERTEX_COLOR',
  'VALUE', 'RGB', 'MAPPING', 'VECTOR_ROTATE',
  'TEX_IMAGE', 'TEX_NOISE', 'TEX_WHITE_NOISE', 'TEX_VORONOI', 'TEX_CHECKER',
  'TEX_BRICK', 'TEX_MAGIC', 'TEX_GRADIENT', 'TEX_WAVE',
  'VALTORGB', 'CURVE_RGB', 'CURVE_FLOAT', 'CURVE_VEC',
  'MIX_RGB', 'MIX', 'MATH', 'VECT_MATH',
  'SEPXYZ', 'COMBXYZ', 'SEPARATE_COLOR', 'COMBINE_COLOR', 'SEPHSV', 'COMBHSV',
  'CLAMP', 'MAP_RANGE', 'INVERT', 'GAMMA', 'BRIGHTCONTRAST', 'HUE_SAT',
  'RGBTOBW', 'BLACKBODY', 'FRESNEL', 'LAYER_WEIGHT',
  'BUMP', 'NORMAL_MAP', 'NORMAL',
  'BSDF_PRINCIPLED', 'EMISSION', 'BSDF_DIFFUSE', 'BSDF_GLOSSY', 'BSDF_TRANSPARENT',
  'BSDF_GLASS', 'BSDF_TRANSLUCENT', 'BACKGROUND', 'MIX_SHADER', 'ADD_SHADER'
]
