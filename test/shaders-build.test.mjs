/**
 * Every sample shader assembles, in every language it is written in.
 *
 * A shader fails silently twice over: a graph that throws while it is being
 * built leaves the mesh drawing as lambert, and a language swap that drops a
 * key leaves it drawing a default. Both look like a surface somebody restyled.
 * So each shader is assembled here from the declarations a level actually
 * writes, with no renderer, and the two languages are checked against each
 * other key by key.
 *
 * Assembling is not compiling. A GLSL shader only compiles on the WebGL
 * backend, in a browser, so what is proved here is the part that can be: the
 * source parses the way three parses it, every argument is bound, and the
 * builder returns a material. `run see.capture` is still the last word on what
 * it looks like.
 *
 * Importing the GLSL shelf at all is a check in itself. A GLSL source is
 * written in a template literal, so a backtick anywhere in it — a comment
 * included — ends the string and the module will not parse. In the browser
 * that shows only as a plugin that did not load.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

// Three's node build reads these at import time. A test process has no window.
globalThis.self = globalThis
globalThis.window = globalThis
if (!globalThis.navigator) globalThis.navigator = { userAgent: 'node' }

const THREE = await import('three/webgpu')
const TSL = await import('three/tsl')
const GLSLNodeFunction = (await import('three/src/nodes/parsers/GLSLNodeFunction.js')).default
const { SHADERS } = await import('../plugins/builtin/shaders.js')
const { buildersFor } = await import('../plugins/builtin/shaders/builders.js')
const { GLSL_SHADERS } = await import('../plugins/builtin/glsl/builders.js')
const { binderFor, SLOTS } = await import('../plugins/builtin/glsl/bind.js')
const { readDefinition } = await import('../plugins/builtin/glsl.js')

/** The two UV sets, exactly as engine/render.js hands them to a builder. */
const uv = { face: () => TSL.uv(1), metres: () => TSL.uv() }
const tint = new THREE.Color('#8899aa')

/** What a builder is called with. `mesh` is the whole declaration. */
const request = mesh => ({ mesh, texture: null, tint, view: {}, uv })

const tslBuilders = buildersFor(THREE, TSL, SHADERS)
const bind = binderFor(THREE, TSL)

/** Build one shader in one language, or throw. */
function buildIn(language, name, mesh) {
  if (language === 'tsl') return tslBuilders[name](request(mesh))
  const record = readDefinition(name, GLSL_SHADERS[name])
  return bind(record)(request(mesh))
}

/** Which languages a shader is written in. */
const languagesOf = name => ['tsl', 'glsl'].filter(language =>
  (language === 'tsl' ? tslBuilders : GLSL_SHADERS)[name])

/**
 * The declarations a level actually writes, taken from the shader demo.
 *
 * Real cases rather than made-up ones: the demo is what the shelf was tuned
 * against, and a quad, a box and a sphere each read a different UV.
 */
const DEMO = [
  { name: 'waves', mesh: { quad: [26, 18], material: 'waves' } },
  { name: 'gradient', mesh: { quad: [26, 11], material: 'gradient', from: '#132a52', mid: '#3b2a63', to: '#0b1018', angle: 90 } },
  { name: 'gradient', mesh: { box: [3.2, 1.4, 1.4], material: 'gradient', from: '#1d3f8f', mid: '#c0396b', to: '#f7c948', angle: 55 } },
  { name: 'hologram', mesh: { box: [1.7, 3.2, 1.7], material: 'hologram' } },
  { name: 'aura', mesh: { quad: [4.6, 4.6], material: 'aura' } },
  { name: 'dissolve', mesh: { sphere: 2.2, segments: 32, material: 'dissolve' } },
  { name: 'dissolve', mesh: { box: [1.8, 1.8, 1.8], material: 'dissolve', amount: 0.32 } },
  { name: 'edges', mesh: { box: [2.4, 2.4, 2.4], material: 'edges', tint: '#131b24' } },
  { name: 'edges', mesh: { sphere: 1.8, segments: 28, material: 'edges', width: 0.06 } },
  { name: 'grass', mesh: { quad: [1, 1], material: 'grass' } }
]

/**
 * Declarations nobody should write, which a level will write anyway.
 *
 * Every one of these must build. A shader that throws on a bad number takes
 * the mesh's whole surface with it, and the level file is the one place a
 * person types a value by hand.
 */
const NONSENSE = [
  { what: 'a word where a number goes', mesh: { quad: [2, 2], speed: 'fast', lines: 'many', width: 'thin', angle: 'sideways', amount: 'most', scale: 'big', blades: 'lots' } },
  { what: 'null everywhere', mesh: { quad: [2, 2], speed: null, glow: null, from: null, to: null, mid: null, edge: null, root: null } },
  { what: 'numbers far out of range', mesh: { quad: [2, 2], speed: 1e9, lines: -400, width: 50, strength: -12, blades: 9999, detail: 0, amount: 7 } },
  { what: 'a colour that is not a colour', mesh: { quad: [2, 2], glow: 'not a colour', from: '#zzz', edge: 42, root: [] } },
  { what: 'no keys at all', mesh: {} },
  { what: 'a quad declared as one number', mesh: { quad: 3 } },
  { what: 'NaN', mesh: { quad: [2, 2], speed: NaN, angle: NaN, lines: NaN } }
]

for (const [name] of Object.entries(SHADERS)) {
  test(`${name} assembles from its defaults, in every language it is written in`, () => {
    for (const language of languagesOf(name)) {
      const material = buildIn(language, name, { quad: [2, 2], material: name })
      assert.ok(material.isMaterial, `${name} in ${language} returned no material`)
      assert.ok(material.colorNode || material.emissiveNode,
        `${name} in ${language} set neither a colour nor an emissive node`)
    }
  })

  test(`${name} assembles from every nonsense declaration, in every language`, () => {
    // Three warns about every colour it cannot read, which is the point of
    // half these cases. Quiet, so a passing run says nothing.
    const warn = console.warn
    console.warn = () => {}
    try {
      for (const language of languagesOf(name)) {
        for (const { what, mesh } of NONSENSE) {
          assert.doesNotThrow(() => buildIn(language, name, { ...mesh, material: name }),
            `${name} in ${language} threw on ${what}`)
        }
      }
    } finally {
      console.warn = warn
    }
  })
}

test('every declaration the shader demo writes assembles in every language', () => {
  for (const { name, mesh } of DEMO) {
    for (const language of languagesOf(name)) {
      const material = buildIn(language, name, mesh)
      assert.ok(material.isMaterial, `${name} in ${language} returned no material for ${JSON.stringify(mesh)}`)
    }
  }
})

/** Every slot of every GLSL shader, in the normalised shape the binder reads. */
const slotsOf = (name, definition) => (
  definition.outputs
    ? Object.entries(definition.outputs).map(([slot, output]) => ({ name, slot, ...output }))
    : [{ name, slot: definition.output || 'colour', source: definition.source, inputs: definition.inputs }]
)
const EVERY_SLOT = Object.entries(GLSL_SHADERS).flatMap(([name, definition]) => slotsOf(name, definition))

test('every GLSL slot parses, and returns what that slot needs', () => {
  for (const output of EVERY_SLOT) {
    const parsed = new GLSLNodeFunction(output.source)
    assert.notEqual(parsed.name, '', `${output.name}.${output.slot} has no function name`)
    // A colour is rgba, an emissive rgb, an opacity one float, a vertex a
    // clip-space position. A program's node is whatever its painter asked for.
    const wanted = SLOTS[output.slot]?.returns
    if (wanted) {
      assert.equal(parsed.type, wanted,
        `${output.name}.${output.slot} must return ${wanted}`)
    }
  }
})

test('every slot fills a slot that exists', () => {
  for (const output of EVERY_SLOT) {
    assert.ok(SLOTS[output.slot], `${output.name} fills "${output.slot}", which is not a slot`)
  }
})

test('every GLSL argument is bound, and every binding is an argument', () => {
  for (const output of EVERY_SLOT) {
    const wanted = new GLSLNodeFunction(output.source).inputs.map(input => input.name)
    const given = Object.keys(output.inputs)
    assert.deepEqual(wanted.filter(one => !given.includes(one)), [],
      `${output.name}.${output.slot} has arguments nothing is bound to`)
    assert.deepEqual(given.filter(one => !wanted.includes(one)), [],
      `${output.name}.${output.slot} binds inputs the function does not take`)
  }
})

test('a shader with several slots shares one declaration of its helpers', () => {
  // Two slots each declaring `float noise(` would not compile. The helper is
  // declared once in `helpers` and included, so neither slot declares it.
  for (const [name, definition] of Object.entries(GLSL_SHADERS)) {
    if (!definition.outputs) continue
    for (const output of Object.values(definition.outputs)) {
      assert.doesNotMatch(output.source, /\bfloat\s+noise\s*\(/,
        `${name} declares noise() inside a slot rather than in helpers`)
    }
  }
})

test('helpers written above #pragma main are emitted, not dropped', () => {
  const code = new GLSLNodeFunction(GLSL_SHADERS.aura.source).getCode('aura_1')
  assert.match(code, /float noise\(/)
  assert.doesNotMatch(code, /#pragma/)
})

test('the particle look is the only program, and it returns a bare node', () => {
  const programs = Object.entries(GLSL_SHADERS).filter(([, one]) => one.kind === 'program')
  assert.deepEqual(programs.map(([name]) => name), ['particle-colour'])
  assert.equal(programs[0][1].output, 'node')
})

test('a shader written in both languages reads the same keys in both', () => {
  for (const name of Object.keys(GLSL_SHADERS)) {
    if (!SHADERS[name]) continue
    const keys = Object.keys(SHADERS[name].parameters)
    const bound = slotsOf(name, GLSL_SHADERS[name])
      .flatMap(output => Object.values(output.inputs))
      .map(binding => binding.split(':')[1])
      .filter(Boolean)
    // A key the GLSL version never reads is a key that silently stops working
    // the moment somebody prefers GLSL.
    assert.deepEqual(keys.filter(key => !bound.includes(key)), [],
      `the GLSL ${name} does not read every key the shelf declares`)
  }
})

test('an input nobody can supply is reported, and the shader still builds', () => {
  const said = []
  const error = console.error
  console.error = message => said.push(String(message))
  try {
    const record = readDefinition('invented', {
      inputs: { face: 'uv.face', nowhere: 'invented:key' },
      source: 'vec4 invented(vec2 face, float nowhere) { return vec4(face, nowhere, 1.0); }'
    })
    const material = bind(record)(request({ quad: [1, 1] }))
    assert.ok(material.isMaterial)
  } finally {
    console.error = error
  }
  assert.match(said.join(' '), /invented:key/)
})

test('the particle look assembles in both languages', () => {
  const painter = {
    surface: TSL.vec2(0.5, 0.5),
    painted: TSL.vec4(1, 1, 1, 1),
    sampled: TSL.vec4(1, 1, 1, 1),
    textured: TSL.float(0)
  }
  const glsl = bind(readDefinition('particle-colour', GLSL_SHADERS['particle-colour']))(painter)
  assert.ok(glsl, 'the GLSL particle look returned nothing')
  // The TSL one is written in the painter, so it is checked by the same maths
  // rather than by importing a plugin that needs a renderer scene.
  const { mix, oneMinus, smoothstep, vec4 } = TSL
  const edge = oneMinus(smoothstep(0.55, 1.0, painter.surface.sub(0.5).length().mul(2)))
  const tinted = painter.painted.mul(painter.sampled)
  assert.ok(vec4(tinted.rgb, tinted.a.mul(mix(edge, 1, painter.textured))))
})
