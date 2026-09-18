/**
 * Render — how the frame is rendered: tone mapping, exposure, environment
 * light, shadow quality, backend.
 *
 * Every setting is in one table (`render/settings.js`), with its options and
 * what it does. The panel and `render.look` list all of them with the value in
 * use and where it came from, so finding what to change is one read.
 *
 *   game.json            "render": { "toneMapping": "agx", "exposure": 1.1 }
 *   levels/<name>.json   "world": { "render": { "exposure": 0.8 } }
 *
 * The level wins over the game, and both win over the defaults. A level with a
 * mesh in it gets the 3D defaults; a sprite-only level gets the 2D ones, which
 * change nothing, so a 2D game's colours stay exactly as drawn.
 *
 * Switching the plugin off puts three back the way the engine starts.
 */
import { ORDER, SETTINGS, check, resolve, valuesOf } from './render/settings.js'

const state = {
  game: {},        // game.json → render
  level: {},       // the open level's world → render
  session: {},     // render.set with save: false
  resolved: resolve(),
  environment: 'none',
  problems: [],
  applying: null,
  probeIn: null,   // frames until the room probe is captured, or null
  probe: null      // the last capture, for render.look
}

/** How many frames between checks that every shadow-casting light has the settings. */
const EVERY = 30
let sinceCheck = 0

// ---------------------------------------------------------------- reading

/** Whether the plugin is switched on. */
const enabled = context => context.loader?.plugins?.get('Render')?.enabled !== false

/** Whether the level draws anything in 3D. */
const hasMeshes = context => (context.world?.entities || []).some(entity => entity.mesh)

/** A JSON file from the project, or an empty object. */
async function readJSON(context, file) {
  try { return JSON.parse(await context.files.read(file)) } catch { return {} }
}

/** Read both files the settings are written in. */
async function readLayers(context) {
  state.game = (await readJSON(context, 'game.json')).render || {}
  const level = context.level?.()
  state.level = level && level !== '—'
    ? (await readJSON(context, `levels/${level}.json`)).world?.render || {}
    : {}
}

/** The settings as they stand now. */
function current(context) {
  state.resolved = resolve({
    game: state.game, level: state.level, session: state.session, hasMeshes: hasMeshes(context)
  })
  return state.resolved
}

// --------------------------------------------------------------- applying

/**
 * Put every setting onto the renderer.
 *
 * Runs one at a time: two level loads in a row must not leave the first one's
 * environment on top of the second's.
 */
function applyAll(context) {
  state.applying = (state.applying || Promise.resolve()).then(async () => {
    const values = valuesOf(current(context))
    if (!context.renderer || !enabled(context)) return
    const [THREE, apply] = await Promise.all([import('three/webgpu'), import('./render/apply.js')])
    // The backend is chosen at page load, before plugins run, from storage. A
    // file that names one writes it there, so the next load follows the file.
    if (state.resolved.values.backend.from !== 'default') apply.storeBackend(values)
    apply.applyToneMapping(context, THREE, values)
    apply.applyShadowType(context, THREE, values)
    apply.applyShadowQuality(context, values)
    apply.applyReadability(context, values)
    applyGlobalIllumination(context, values)
    applyAntialiasing(context, values)
    try {
      state.environment = await apply.applyEnvironment(context, THREE, values)
    } catch (error) {
      state.environment = 'none'
      state.resolved.problems.push(`environment "${values.environment}" could not be loaded — ${error?.message || error}`)
    }
    if (values.reflections === 'room') state.probeIn = PROBE_WAIT
    else { state.probeIn = null; state.probe = null; apply.dropProbe(context) }
    context.redraw?.()
  }).catch(error => console.error('[Render]', error))
  return state.applying
}

/** The temporal antialiasing asked for last, so the chain is rebuilt only on a change. */
let temporalOn = null

/** Temporal antialiasing, as a front effect of the Post Processing chain. */
function applyAntialiasing(context, values) {
  const wanted = values.antialiasing === 'temporal'
  if (wanted === temporalOn || !context.post?.light) return
  temporalOn = wanted
  context.post.light('traa', wanted ? {} : null)
}

/** The global illumination asked for last, so the chain is rebuilt only on a change. */
let lightingKey = null

/**
 * Screen-space global illumination, as a lighting effect at the front of the
 * Post Processing chain. That plugin owns every screen pass; this one decides
 * whether bounced light is drawn.
 */
function applyGlobalIllumination(context, values) {
  const wanted = values.globalIllumination === 'screen'
    ? { intensity: values.globalIlluminationStrength, quality: values.globalIlluminationQuality }
    : null
  const key = JSON.stringify(wanted)
  if (key === lightingKey || !context.post?.light) return
  lightingKey = key
  context.post.light('ssgi', wanted)
}

/**
 * Frames to wait before capturing the room probe. Lights, models and surfaces
 * are built by other plugins over the first frames after a level loads, and a
 * probe captured before them holds a dark, empty room.
 */
const PROBE_WAIT = 12

/** Capture the room probe once its wait is over. */
async function tickProbe(context) {
  if (state.probeIn === null || --state.probeIn > 0 || !enabled(context) || !context.renderer) return
  state.probeIn = null
  const [THREE, apply] = await Promise.all([import('three/webgpu'), import('./render/apply.js')])
  try {
    const took = apply.captureProbe(context, THREE)
    state.probe = took === null ? null : { capturedIn: `${took} ms` }
  } catch (error) {
    state.probe = null
    state.problems = [`room reflections could not be captured — ${error?.message || error}`]
  }
  context.redraw?.()
}

/** Keep new shadow-casting lights at the settings, a few times a second. */
async function checkShadows(context) {
  if (++sinceCheck < EVERY || !enabled(context) || !context.renderer) return
  sinceCheck = 0
  const apply = await import('./render/apply.js')
  apply.applyShadowQuality(context, valuesOf(state.resolved))
}

/** Put three back the way the engine starts. */
async function restore(context) {
  if (!context.renderer) return
  const [THREE, apply] = await Promise.all([import('three/webgpu'), import('./render/apply.js')])
  apply.restoreDefaults(context, THREE)
  applyGlobalIllumination(context, { globalIllumination: 'off' })
  applyAntialiasing(context, { antialiasing: 'level' })
  state.environment = 'none'
  context.redraw?.()
}

// ---------------------------------------------------------------- writing

/**
 * Store settings in game.json, in the open level, or for this session only.
 *
 * Every value is checked before anything is written, so a call with one bad
 * value changes nothing.
 */
async function setSettings(context, asked = {}) {
  const { save = 'game', ...values } = asked
  const problems = Object.entries(values).map(([key, value]) => check(key, value)).filter(Boolean)
  if (problems.length) throw new Error(problems.join('; '))

  if (save === 'game') {
    const game = await readJSON(context, 'game.json')
    game.render = { ...(game.render || {}), ...values }
    await context.files.writeJSON('game.json', game)
    state.game = game.render
  } else if (save === 'level') {
    const name = context.level?.()
    if (!name || name === '—') throw new Error('no level is open to save the settings into')
    const level = await readJSON(context, `levels/${name}.json`)
    level.world = { ...(level.world || {}), render: { ...(level.world?.render || {}), ...values } }
    await context.files.writeJSON(`levels/${name}.json`, level)
    state.level = level.world.render
  } else {
    state.session = { ...state.session, ...values }
  }

  state.problems = []
  if ('backend' in values) (await import('./render/apply.js')).storeBackend(values)
  await applyAll(context)
  return { saved: save || 'session', set: values }
}

// -------------------------------------------------------------- reporting

/** Every setting with its value, where it came from, and what it can be. */
async function look(context) {
  const resolved = current(context)
  const apply = await import('./render/apply.js')
  return {
    profile: resolved.profile,
    settings: ORDER.map(key => ({
      key,
      value: resolved.values[key].value,
      from: resolved.values[key].from,
      ...(SETTINGS[key].range ? { range: SETTINGS[key].range } : { options: SETTINGS[key].options }),
      about: SETTINGS[key].about
    })),
    environmentDrawing: state.environment,
    roomProbe: state.probe || (state.probeIn !== null ? 'waiting for the level to build' : 'none'),
    backend: apply.backendReport(context, valuesOf(resolved)),
    enabled: enabled(context),
    problems: resolved.problems,
    writtenIn: {
      game: 'game.json → "render"',
      level: `levels/${context.level?.() || '<level>'}.json → "world" → "render"`
    }
  }
}

// ------------------------------------------------------------------ panel

/** One setting as a control. Changes are written to game.json. */
function control(ui, context, key) {
  const setting = SETTINGS[key]
  const chosen = state.resolved.values[key]
  const write = value => context.run('render.set', { [key]: value }).catch(error => {
    state.problems = [String(error?.message || error)]
    context.redraw?.()
  })

  const heading = ui.text(`${key} — ${chosen.value} (${chosen.from})`)
  const about = ui.text(setting.about, { dim: true })
  if (setting.range) {
    return [heading, ui.field({ k: 'value', v: chosen.value, kind: 'number', onChange: write }), about]
  }
  const options = setting.options.filter(option => typeof option !== 'string' || !option.includes(' '))
  const rows = [heading, ui.pick({ options: options.map(String), value: String(chosen.value), onChange: value => write(isNaN(value) ? value : Number(value)) })]
  if (key === 'environment') {
    rows.push(ui.field({ k: 'file', v: /\.(hdr|exr)$/i.test(chosen.value) ? chosen.value : '', onChange: write }))
  }
  rows.push(about)
  return rows
}

export default {
  name: 'Render',
  category: 'visuals',
  about: 'Tone mapping, exposure, light and shadows.',

  inspect: [{
    title: 'Render',
    rows: context => {
      const values = state.resolved.values
      return [
        ['profile', state.resolved.profile],
        ...ORDER.filter(key => key !== 'profile').map(key => [key, `${values[key].value} (${values[key].from})`]),
        ['environment drawing', state.environment],
        ['switched on', enabled(context) ? 'yes' : 'no']
      ]
    }
  }],

  onLoad(context) {
    readLayers(context).then(() => applyAll(context))

    context.bus.on('level:loaded', async () => {
      state.session = {}
      await readLayers(context)
      applyAll(context)
    })

    // An edit to either file is live, the same as any other project file.
    context.bus.on('hot:applied', change => {
      if (change?.file === 'game.json' || change?.file?.startsWith('levels/')) {
        readLayers(context).then(() => applyAll(context))
      }
    })

    // Contributions go when a plugin is switched off; what it set on three
    // stays. So the plugin undoes its own settings, and puts them back on.
    let wasOn = enabled(context)
    context.bus.on('plugins:changed', () => {
      const on = enabled(context)
      if (on === wasOn) return
      wasOn = on
      on ? applyAll(context) : restore(context)
    })

    context.bus.on('frame:painted', () => { checkShadows(context); tickProbe(context) })
  },

  systems: [{ phase: 'frame', run: (world, seconds, context) => { checkShadows(context); tickProbe(context) } }],

  commands: [
    {
      id: 'render.look',
      label: 'Render settings',
      run: async context => {
        await readLayers(context)
        return look(context)
      }
    },
    {
      id: 'render.set',
      label: 'Set render settings',
      // args: {"toneMapping":"neutral","exposure":1.2}
      //       {"exposure":0.8,"save":"level"}   into the open level
      //       {"exposure":0.8,"save":false}     this session only
      run: (context, args) => setSettings(context, args || {})
    },
    {
      id: 'render.reset',
      label: 'Drop session settings',
      run: async context => {
        state.session = {}
        await readLayers(context)
        await applyAll(context)
        return look(context)
      }
    }
  ],

  panels: [{
    id: 'render',
    title: 'Render',
    dock: 'right',
    order: 30,

    actions: [{ label: 'Reset session', run: context => context.run('render.reset') }],

    render(ui, context) {
      const problems = [...state.resolved.problems, ...state.problems]
      return ui.stack([
        ui.text(`profile ${state.resolved.profile} · environment ${state.environment}`, { dim: true }),
        ...ORDER.flatMap(key => control(ui, context, key)),
        ...problems.map(problem => ui.text(problem, { dim: true })),
        ui.text('Changes are written to game.json → render. A level overrides with world → render.', { dim: true })
      ])
    }
  }]
}
