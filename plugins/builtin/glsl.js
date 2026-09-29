/**
 * GLSL — shaders written as GLSL source, and the door a game writes one
 * through.
 *
 * A GLSL shader here is ONE FUNCTION with named arguments. The engine binds
 * each argument to something it already knows — a UV set, the clock, a colour
 * read off the mesh — and the function returns the colour:
 *
 *   context.glsl.register('scanner', {
 *     parameters: { glow: '#54f0d0', speed: 2 },
 *     inputs: { face: 'uv.face', time: 'time', glow: 'colour:glow', speed: 'number:speed' },
 *     source: `
 *       vec4 scanner(vec2 face, float time, vec3 glow, float speed) {
 *         float bar = fract(face.y - time * speed);
 *         return vec4(glow * bar, 1.0);
 *       }`
 *   })
 *
 * Why a function of declared inputs rather than a whole shader stage: the
 * renderer generates the stage, and the vertex half it generates carries
 * skinning, instancing, fog, shadows and both UV sets. A shader that replaced
 * the stage would lose all of that, so GLSL is inserted into it instead. That
 * is `glslFn`, three's own door for native source.
 *
 * ONE LIMIT, AND IT IS HARD. Three inserts the source into the shader it
 * generates, and the WebGPU backend generates WGSL. So raw GLSL compiles on
 * the WebGL backend only. WebGPU is the default; `glsl.backend` says which one
 * is drawing, and `glsl.forceWebGL true` makes the next page load choose WebGL.
 * On WebGPU, Shader Languages draws each shader in whatever other language it
 * is written in, which for the sample shelf is TSL.
 *
 * Three is imported only where something is drawing. A headless world lists
 * every GLSL shader and prints its source with no renderer at all.
 */

import { GLSL_SHADERS } from './glsl/builders.js'

/** Where the backend choice is stored. Read by engine/render.js at init. */
const FORCE_WEBGL_KEY = 'engine.forceWebGL'

/**
 * Whether the next page load will ask for the WebGL backend.
 *
 * Off by default: WebGPU is faster on a heavy scene and is the only backend
 * that times itself for `profile.frames`. `glsl.forceWebGL true` and a reload
 * choose WebGL, which a shader written only in GLSL needs.
 */
export function forcingWebGL() {
  if (typeof localStorage === 'undefined') return false
  try { return localStorage.getItem(FORCE_WEBGL_KEY) === 'true' } catch { return false }
}

/** Choose the backend for the next page load. */
function forceWebGL(on) {
  if (typeof localStorage === 'undefined') return false
  try { localStorage.setItem(FORCE_WEBGL_KEY, on ? 'true' : 'false') } catch { /* storage may be blocked */ }
  return on
}

/**
 * Why GLSL cannot build, or true.
 *
 * The reason is the whole value of this function: a surface that silently
 * draws in another language says nothing about which backend it got.
 */
function supportedOn(backend) {
  if (!backend) return 'there is no renderer, so nothing is drawing in any language'
  if (backend.webgpu) {
    return forcingWebGL()
      ? 'the WebGPU backend is drawing and WebGL was asked for — reload the page'
      : 'the WebGPU backend is drawing, and three inserts GLSL into a shader it generates as WGSL. Run `glsl.forceWebGL true` and reload.'
  }
  return true
}

/**
 * Every GLSL shader this plugin knows, whether or not it can be built.
 *
 * Filled before three arrives so `glsl.list` and `glsl.source` answer in a
 * headless run: the source is a string, and reading it needs no GPU.
 */
const written = new Map()

/**
 * Turn a definition into a record, reporting what it is missing.
 *
 * Both shapes are read and both come out as a list of slots, so nothing
 * downstream has to know which was written:
 *
 *   { source, inputs, output }              one slot, the common case
 *   { outputs: { colour: {...}, ... } }      several, one function each
 */
export function readDefinition(name, definition = {}) {
  const key = String(name ?? '').trim()
  if (!key) {
    console.error('[GLSL] register() needs a name — nothing was registered')
    return null
  }

  const outputs = []
  if (definition.outputs) {
    for (const [slot, output] of Object.entries(definition.outputs)) {
      if (typeof output?.source !== 'string' || !output.source.trim()) {
        console.error(`[GLSL] the "${slot}" slot of "${key}" has no source — a slot is a function, written as a string`)
        continue
      }
      outputs.push({ slot, source: output.source, inputs: output.inputs || {} })
    }
  } else if (typeof definition.source === 'string' && definition.source.trim()) {
    outputs.push({
      slot: definition.output || 'colour',
      source: definition.source,
      inputs: definition.inputs || {}
    })
  }

  if (!outputs.length) {
    console.error(`[GLSL] "${key}" has no source — a GLSL shader is a function, written as a string`)
    return null
  }

  const helpers = Array.isArray(definition.helpers)
    ? definition.helpers
    : (definition.helpers ? [definition.helpers] : [])

  return {
    name: key,
    kind: definition.kind === 'program' ? 'program' : 'material',
    about: definition.about,
    dimension: definition.dimension,
    parameters: definition.parameters || {},
    outputs,
    helpers,
    base: definition.base || 'basic',
    material: definition.material || {}
  }
}

export default {
  name: 'GLSL',
  category: 'visuals',
  about: 'GLSL shaders bound to engine inputs; WebGL.',
  needs: ['Shader Languages'],

  onLoad(context) {
    const languages = context.shaderLanguages
    if (!languages) {
      console.error('[GLSL] Shader Languages did not load, so a GLSL shader has nowhere to be registered — nothing is drawn in GLSL.')
      return
    }

    languages.register('glsl', {
      about: 'GLSL source, one function per shader, its arguments bound to engine inputs. Builds on the WebGL backend only.',
      supported: supportedOn
    })

    /** Turns a record into a builder. Null until three has arrived. */
    let bind = null

    /** The door. A game registers its own GLSL shader through this. */
    context.glsl = {
      get forcingWebGL() { return forcingWebGL() },
      backend: () => supportedOn(context.renderer?.backend || null),
      written: () => [...written.values()].map(record => ({
        name: record.name,
        kind: record.kind,
        parameters: record.parameters,
        base: record.base,
        slots: record.outputs.map(output => ({ slot: output.slot, inputs: output.inputs }))
      })),
      source: name => {
        const record = written.get(String(name ?? '').trim())
        if (!record) return null
        // Helpers first, then every slot, in the order the card sees them.
        return [...record.helpers, ...record.outputs.map(output => output.source)].join('\n')
      },

      register(name, definition) {
        const record = readDefinition(name, definition)
        if (!record) return null
        written.set(record.name, record)
        // Described even where it cannot be built, so a headless run reports
        // the shader exists and says which language it is written in.
        const details = { kind: record.kind, language: 'glsl' }
        if (record.about !== undefined) details.about = record.about
        if (record.dimension !== undefined) details.dimension = record.dimension
        if (Object.keys(record.parameters).length) details.parameters = record.parameters
        languages.describe(record.name, details)
        if (bind) languages.implement(record.name, 'glsl', bind(record))
        return record
      }
    }

    if (typeof document === 'undefined') {
      for (const [name, definition] of Object.entries(GLSL_SHADERS)) context.glsl.register(name, definition)
      return
    }

    Promise.all([import('three/webgpu'), import('three/tsl')])
      .then(async ([THREE, TSL]) => {
        const { binderFor } = await import('./glsl/bind.js')
        bind = binderFor(THREE, TSL)
        // Anything a game registered before three arrived still has to reach
        // the registry, or a GLSL shader would work only if it happened to be
        // written after the modules loaded.
        for (const record of written.values()) languages.implement(record.name, 'glsl', bind(record))
        for (const [name, definition] of Object.entries(GLSL_SHADERS)) context.glsl.register(name, definition)
      })
      .catch(error => {
        console.error('[GLSL] the node library did not load, so no GLSL shader can be built —', error?.message || error)
        for (const [name, definition] of Object.entries(GLSL_SHADERS)) context.glsl.register(name, definition)
      })
  },

  commands: [
    {
      id: 'glsl.backend',
      label: 'GLSL availability',
      run: context => {
        const answer = supportedOn(context.renderer?.backend || null)
        return {
          buildable: answer === true,
          because: answer === true ? '' : answer,
          backend: context.renderer?.backend?.name || 'none — headless',
          forceWebGL: forcingWebGL()
        }
      }
    },
    {
      id: 'glsl.forceWebGL',
      label: 'Force WebGL',
      run: (context, on) => {
        const wanted = Array.isArray(on) ? on[0] : on
        const chosen = forceWebGL(wanted !== false && wanted !== 'false')
        return {
          forceWebGL: chosen,
          reload: 'the backend is chosen once, when the renderer initialises — reload the page'
        }
      }
    },
    {
      id: 'glsl.list',
      label: 'GLSL shaders',
      run: context => ({ shaders: context.glsl?.written() || [] })
    },
    {
      id: 'glsl.source',
      label: 'GLSL source',
      run: (context, name) => {
        const wanted = Array.isArray(name) ? name[0] : name
        const source = context.glsl?.source(wanted)
        return source ? { name: wanted, source } : { error: `no GLSL shader named "${wanted}"` }
      }
    }
  ],

  panels: [{
    id: 'glsl',
    title: 'GLSL',
    dock: 'right',
    collapsed: true,
    order: 44,

    render(ui, context) {
      const answer = supportedOn(context.renderer?.backend || null)
      const shaders = context.glsl?.written() || []

      return ui.stack([
        answer === true
          ? ui.text('GLSL builds on this backend', { dim: true })
          : ui.text(answer, { dim: true }),

        ui.row([ui.button(
          forcingWebGL() ? 'Stop forcing WebGL' : 'Force WebGL and reload',
          () => {
            forceWebGL(!forcingWebGL())
            location.reload()
          })], { pad: true }),

        shaders.length
          ? ui.fold('shaders', shaders.map(shader => ui.field({
              k: shader.name,
              v: shader.slots.map(one => one.slot).join(', ')
            })), { open: true, meta: `${shaders.length}` })
          : ui.text('no GLSL shader is registered', { dim: true })
      ])
    }
  }],

  inspect: [{
    title: 'GLSL',
    rows: context => {
      const answer = supportedOn(context.renderer?.backend || null)
      return [
        { k: 'buildable', v: answer === true ? 'yes' : answer },
        { k: 'forceWebGL', v: forcingWebGL() ? 'yes' : 'no' },
        { k: 'shaders', v: String(written.size) }
      ]
    }
  }]
}
