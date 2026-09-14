/**
 * Binding a GLSL function's arguments to what the engine already knows.
 *
 * A GLSL shader here is a function, so every value it needs arrives as an
 * argument. `inputs` names each argument and says where the value comes from,
 * and this file is the whole list of what can be named. An input nobody can
 * supply is reported by name — a shader that silently receives zero is the
 * failure this avoids.
 *
 * A shader may fill more than one SLOT. Each slot is one function with its own
 * arguments, and each feeds one property of the material: the surface colour,
 * the light it adds, how see-through it is, or where its vertices go. Maths two
 * slots share is computed twice on the card, because they are two functions.
 * Put a shared function in `helpers` and its DECLARATION is shared, which is
 * what stops two slots declaring the same name and failing to compile.
 *
 * Three is never imported. The toolkit arrives as an argument, so a headless
 * world pays nothing to list a GLSL shader it will not draw.
 */

/** A number an input can use, or its default. */
const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

/**
 * Where each slot's answer is assigned, and what it must return.
 *
 * `vertex` is a whole clip-space position, so a shader filling it replaces the
 * projection the renderer would have done and has to do that itself.
 */
export const SLOTS = {
  colour: { property: 'colorNode', returns: 'vec4' },
  emissive: { property: 'emissiveNode', returns: 'vec3' },
  opacity: { property: 'opacityNode', returns: 'float' },
  vertex: { property: 'vertexNode', returns: 'vec4' },
  // A program hands its node back to the painter that asked for it.
  node: { property: null, returns: null }
}

/** Which node material a shader hangs on. Basic unless it wants scene light. */
const BASES = {
  basic: 'MeshBasicNodeMaterial',
  lambert: 'MeshLambertNodeMaterial',
  standard: 'MeshStandardNodeMaterial'
}

/** A quad's declared width and height, whichever form the level wrote. */
function quadSize(mesh) {
  const declared = mesh && mesh.quad
  if (Array.isArray(declared)) return [Number(declared[0]) || 1, Number(declared[1]) || 1]
  const both = Number(declared)
  return Number.isFinite(both) && both > 0 ? [both, both] : [1, 1]
}

/** A colour as three floats, from whatever the level wrote. */
function colourOf(THREE, value, fallback) {
  const colour = new THREE.Color(fallback ?? '#ffffff')
  if (value !== null && value !== undefined) {
    try { colour.set(value) } catch { /* keep the fallback */ }
  }
  return [colour.r, colour.g, colour.b]
}

/**
 * Turn one record into a builder.
 *
 * `binderFor` is called once, when three arrives; the builder it returns is
 * what the material registry and the painters call per material.
 */
export function binderFor(THREE, TSL) {
  const {
    cameraPosition, cameraProjectionMatrix, cameraViewMatrix, glslFn, float,
    modelWorldMatrix, normalView, positionGeometry, positionLocal,
    positionViewDirection, positionWorld, screenCoordinate, texture, time,
    vec2, vec3, vec4
  } = TSL

  /**
   * Every input a shader may name, and the node it becomes.
   *
   * `request` is what the renderer hands a material builder, plus anything a
   * painter added for a program of its own.
   */
  function nodeFor(binding, record, request, say) {
    const { mesh = {}, tint, uv, texture: map } = request
    const defaults = record.parameters || {}
    const [kind, key] = String(binding).split(':')

    switch (kind) {
      // The two UV sets, named by what the number means. Three's own `uv()` is
      // in metres here, so a shader that asks for it by name cannot be wrong
      // about which one it got.
      case 'uv.face': return uv?.face ? uv.face() : vec2(0, 0)
      case 'uv.metres': return uv?.metres ? uv.metres() : vec2(0, 0)
      case 'time': return time
      case 'normal': return normalView
      case 'viewDirection': return positionViewDirection
      case 'position.world': return positionWorld
      case 'position.local': return positionLocal
      case 'position.geometry': return positionGeometry
      case 'cameraPosition': return cameraPosition
      case 'screen': return screenCoordinate
      // Only a `vertex` slot needs these, and only because filling that slot
      // means doing the projection the renderer would have done.
      case 'matrix.projection': return cameraProjectionMatrix
      case 'matrix.view': return cameraViewMatrix
      case 'matrix.model': return modelWorldMatrix
      // The quad's declared size. Structural, so it is not a parameter and
      // cannot be read with `number:`, and a shader that rebuilds where a tuft
      // stands has to know it.
      case 'quad.wide': return float(quadSize(mesh)[0])
      case 'quad.tall': return float(quadSize(mesh)[1])
      case 'tint': return vec3(...colourOf(THREE, tint, '#ffffff'))
      // Already sampled, so GLSL never needs a sampler argument and an
      // untextured mesh gets white rather than a compile error.
      case 'texture':
        return map && uv?.face ? texture(map, uv.face()) : vec4(1, 1, 1, 1)
      case 'colour': return vec3(...colourOf(THREE, mesh[key], defaults[key]))
      case 'number': return float(number(mesh[key], number(defaults[key], 0)))
      // 1 where the level wrote the key, 0 where it did not. A shader cannot
      // branch on a key being absent otherwise, and an optional colour has no
      // value that means "off".
      case 'declared':
        return float(mesh[key] === undefined || mesh[key] === null ? 0 : 1)
      // A program's painter supplies its own nodes — the surface coordinate of
      // a particle, the colour it was painted. Only the painter knows them.
      case 'given': {
        const given = request[key]
        if (given === undefined) {
          say(`[GLSL] "${record.name}" asks for given:${key} and the caller passed none — it receives zero`)
          return float(0)
        }
        return given
      }
      default:
        say(`[GLSL] "${record.name}" asks for the input "${binding}", which does not exist — it receives zero`)
        return float(0)
    }
  }

  /** The material a shader hangs its node on, with the options it declared. */
  function materialFor(record, request, say) {
    const constructor = THREE[BASES[record.base]]
    if (!constructor) {
      say(`[GLSL] "${record.name}" asks for the base material "${record.base}" — only ${Object.keys(BASES).join(', ')} exist, so it draws on basic`)
      return new THREE.MeshBasicNodeMaterial()
    }
    const declared = record.material || {}
    // `alphaTest` is passed to the constructor, not set after it: three builds
    // the alpha-test branch into the shader from the value it was constructed
    // with, so a cutout assigned afterwards never cuts and the quad draws its
    // own background as an opaque block.
    const material = new constructor({
      transparent: !!declared.transparent,
      depthTest: declared.depthTest !== false,
      depthWrite: declared.depthWrite !== false,
      side: declared.side === 'double' ? THREE.DoubleSide : THREE.FrontSide,
      blending: declared.blending === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
      alphaTest: Number.isFinite(Number(declared.alphaTest)) ? Number(declared.alphaTest) : 0,
      color: request.tint || 0xffffff
    })
    // Two things an additive pass must not do, because it ADDS whatever it
    // returns and its transparent parts return zero:
    //
    // - Take fog. Fog is mixed into every fragment, so a level with fog gets
    //   the fog colour added across the quad's whole square and the square is
    //   then visible wherever the effect itself is invisible.
    // - Touch the alpha channel. The canvas is drawn with alpha, and the
    //   default factors saturate it over the whole quad.
    if (declared.blending === 'add') {
      material.fog = false
      material.blendSrcAlpha = THREE.ZeroFactor
      material.blendDstAlpha = THREE.OneFactor
    }
    return material
  }

  return function bind(record) {
    // Compiled once per shader, not once per material: the function nodes are
    // the same graph whatever mesh names them, and only the arguments differ.
    // Helpers are compiled once and included by every slot, so a shared
    // function is declared once — declaring it per slot would not compile.
    const helpers = (record.helpers || []).map(source => glslFn(source))
    const compiled = record.outputs.map(output => ({
      slot: output.slot,
      inputs: output.inputs,
      call: glslFn(output.source, helpers)
    }))

    return function build(request = {}) {
      const say = message => console.error(message)
      const nodeOf = output => {
        const bound = {}
        for (const [argument, binding] of Object.entries(output.inputs)) {
          bound[argument] = nodeFor(binding, record, request, say)
        }
        return output.call(bound)
      }

      // A program hands its node back to the painter that asked for it; only a
      // material needs a material.
      if (compiled.length === 1 && compiled[0].slot === 'node') return nodeOf(compiled[0])

      const material = materialFor(record, request, say)
      for (const output of compiled) {
        const property = SLOTS[output.slot] && SLOTS[output.slot].property
        if (!property) {
          say(`[GLSL] "${record.name}" fills the slot "${output.slot}", which does not exist — nothing is assigned`)
          continue
        }
        material[property] = nodeOf(output)
      }
      return material
    }
  }
}
