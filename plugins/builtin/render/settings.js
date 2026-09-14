/**
 * Every Render setting, and how its value is chosen. No three, no DOM.
 *
 * One table is the whole list. The panel, `render.look` and the guide all read
 * it, so a setting an agent can see is a setting that exists, with its options
 * and what it does beside it.
 *
 * A value is chosen from, lowest to highest:
 *
 *   default   the table below, for the level's profile
 *   game      game.json → "render"
 *   level     the level's "world" → "render"
 *   session   render.set with no save, gone on reload
 */

/**
 * The settings.
 *
 * `in2d` and `in3d` are the defaults for each profile. A 2D game draws sprites
 * whose colours are the final colours, so it gets no tone mapping and no
 * environment light. The 3D defaults were chosen by comparing frames of a
 * textured interior: neutral keeps the texture colours, where agx washed them
 * out under the level's own ambient light.
 */
export const SETTINGS = {
  profile: {
    about: 'Which defaults apply. auto is 3d when the level has any mesh, else 2d.',
    options: ['auto', '3d', '2d'],
    in2d: 'auto', in3d: 'auto'
  },
  toneMapping: {
    about: 'How bright light rolls off into white. neutral keeps colours close to the textures. agx is the Blender default and paler. aces has more contrast. none keeps authored colours exactly.',
    options: ['neutral', 'agx', 'aces', 'reinhard', 'none'],
    in2d: 'none', in3d: 'neutral'
  },
  exposure: {
    about: 'Overall brightness before tone mapping. 1 is neutral; each doubling is one stop brighter.',
    range: [0.05, 8],
    in2d: 1, in3d: 0.9
  },
  environment: {
    about: 'Light from all around. room is a neutral studio. A path to a .hdr or .exr in assets/ lights from that photo. none turns it off.',
    options: ['room', 'none', 'a .hdr or .exr path'],
    in2d: 'none', in3d: 'room'
  },
  environmentIntensity: {
    about: 'How strong the environment light is.',
    range: [0, 10],
    in2d: 1, in3d: 0.4
  },
  shadows: {
    about: 'Edge of every shadow. soft is a blurred edge, smooth is wider still, sharp is crisp and cheapest. soft and smooth can let light through very thin objects.',
    options: ['soft', 'smooth', 'sharp'],
    in2d: 'sharp', in3d: 'soft'
  },
  shadowSize: {
    about: 'Shadow map width and height in pixels. Larger is sharper and costs more memory.',
    options: [512, 1024, 2048, 4096],
    in2d: 1024, in3d: 2048
  },
  globalIllumination: {
    about: 'Light bouncing off nearby surfaces. screen works it out from the picture each frame: bounced colour and soft darkening in corners, at a real cost per pixel. off is none.',
    options: ['off', 'screen'],
    in2d: 'off', in3d: 'off'
  },
  globalIlluminationStrength: {
    about: 'How bright the bounced light is. 1 is the SSGI default brightness.',
    range: [0, 4],
    in2d: 1, in3d: 1
  },
  globalIlluminationQuality: {
    about: 'Samples per pixel for bounced light. low is 24, medium 48, high 96; each step roughly doubles the cost.',
    options: ['low', 'medium', 'high'],
    in2d: 'low', in3d: 'low'
  },
  backend: {
    about: 'What draws the frame. webgpu is faster and falls back to webgl where a browser has none. webgl is needed only by a shader written in GLSL alone. Takes effect after a page reload.',
    options: ['webgpu', 'webgl'],
    in2d: 'webgpu', in3d: 'webgpu'
  }
}

/** The order the panel and the report list settings in. */
export const ORDER = Object.keys(SETTINGS)

/** Whether a value is allowed for one setting, and the reason when it is not. */
export function check(key, value) {
  const setting = SETTINGS[key]
  if (!setting) return `no setting called "${key}" — the settings are ${ORDER.join(', ')}`
  if (setting.range) {
    const number = Number(value)
    const [least, most] = setting.range
    if (!Number.isFinite(number) || number < least || number > most) {
      return `${key} is a number from ${least} to ${most}, not ${JSON.stringify(value)}`
    }
    return null
  }
  if (key === 'environment' && typeof value === 'string' && /\.(hdr|exr)$/i.test(value)) return null
  if (!setting.options.includes(value)) {
    return `${key} is one of ${setting.options.map(one => JSON.stringify(one)).join(', ')}, not ${JSON.stringify(value)}`
  }
  return null
}

/** The profile a level draws with. */
export function profileOf(asked, hasMeshes) {
  if (asked === '2d' || asked === '3d') return asked
  return hasMeshes ? '3d' : '2d'
}

/**
 * Every setting's value, and where it came from.
 *
 * A value that fails `check` is reported and skipped, so a typo in game.json
 * draws with the layer below rather than taking the renderer down.
 */
export function resolve({ game = {}, level = {}, session = {}, hasMeshes = false } = {}) {
  const layers = [['game', game], ['level', level], ['session', session]]
  const problems = []

  const pick = (key, fallback) => {
    let chosen = { value: fallback, from: 'default' }
    for (const [from, values] of layers) {
      if (values?.[key] === undefined) continue
      const why = check(key, values[key])
      if (why) problems.push(`${from}: ${why}`)
      else chosen = { value: values[key], from }
    }
    return chosen
  }

  const asked = pick('profile', 'auto')
  const profile = profileOf(asked.value, hasMeshes)
  const values = { profile: { ...asked, profile } }
  for (const key of ORDER) {
    if (key !== 'profile') values[key] = pick(key, SETTINGS[key][profile === '2d' ? 'in2d' : 'in3d'])
  }
  for (const [from, given] of layers) {
    for (const key of Object.keys(given || {})) {
      if (!SETTINGS[key]) problems.push(`${from}: ${check(key)}`)
    }
  }
  return { profile, values, problems: [...new Set(problems)] }
}

/** Just the values, for the code that applies them. */
export const valuesOf = resolved =>
  Object.fromEntries(ORDER.map(key => [key, resolved.values[key].value]))
