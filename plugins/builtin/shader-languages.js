/**
 * Shader Languages — which language a shader is written in, and which of them
 * the live backend can actually build.
 *
 * Before this, a shader and its language were one thing: `shaders.js` held
 * seven TSL node graphs, the particle painter held a TSL program, and a game
 * that wanted the same surface in another language had nowhere to put it. The
 * name and the language are separated here. A shader is a NAME with one
 * implementation per language, and this registry picks the implementation to
 * use from the project's preference and what the backend supports.
 *
 *   context.shaderLanguages.register('glsl', { about, supported })
 *   context.shaderLanguages.describe('hologram', { kind: 'material', parameters })
 *   context.shaderLanguages.implement('hologram', 'glsl', build)
 *   context.shaderLanguages.prefer('glsl')      // the hot swap
 *
 * Two kinds of shader go through it, because two different halves of the engine
 * need one:
 *
 * - `kind: 'material'` is named on a `mesh`. The chosen implementation is
 *   published into the Materials registry under the shader's name, so the
 *   renderer reaches it the way it reaches every other material.
 * - `kind: 'program'` is asked for by the plugin that draws it — the particle
 *   painter asks for `particle-colour`. Nothing publishes it; the painter calls
 *   `build(name, request)` when it needs the node.
 *
 * Choosing is per shader, not per project. A shader with no implementation in
 * the preferred language keeps drawing in the language it does have, so
 * preferring GLSL while only three of seven are written in it costs nothing.
 *
 * The choosing itself is in `shader-languages/registry.js`; this file owns the
 * plugin, the panel and the stored preference.
 *
 * Three is never imported here. Describing a shader, listing the languages and
 * choosing between them are facts with no GPU in them, so a headless world
 * answers every command and pays nothing.
 */

import { DEFAULT_LANGUAGE, makeShaderLanguages } from './shader-languages/registry.js'

/** Where the project's preferred language is stored between sessions. */
const PREFERENCE_KEY = 'engine.shaderLanguage'

/**
 * The language this project writes its shaders in.
 *
 * GLSL, by decision: it is lower level and far better documented, so an agent
 * writes it more reliably than TSL. Measured at 64 screen-covering layers the
 * two cost the same, so nothing is paid for the choice.
 *
 * This is the PREFERENCE, not a requirement. `DEFAULT_LANGUAGE` stays the
 * fallback, because TSL is the renderer's own language and a shader with no
 * GLSL implementation has to keep drawing.
 */
const PREFERRED_LANGUAGE = 'glsl'

/** The stored preference, or this project's chosen language. */
function storedPreference() {
  if (typeof localStorage === 'undefined') return PREFERRED_LANGUAGE
  try { return localStorage.getItem(PREFERENCE_KEY) || PREFERRED_LANGUAGE }
  catch { return PREFERRED_LANGUAGE }
}

/** Remember the preference, so a swap survives the page reload a plugin edit causes. */
function rememberPreference(language) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(PREFERENCE_KEY, language) } catch { /* storage may be blocked */ }
}

export default {
  name: 'Shader Languages',
  category: 'visuals',
  about: 'Which language each shader is written in, which the live backend can build, and the switch that swaps between them.',
  needs: ['Materials'],

  onLoad(context) {
    const materials = context.materials
    if (!materials) {
      console.error('[Shader Languages] Materials did not load, so a material shader has nowhere to be published — every shader name draws as lambert.')
      return
    }

    const registry = makeShaderLanguages({
      report: message => console.warn(message),
      backend: () => context.renderer?.backend || null,
      preferred: storedPreference(),
      publish: (name, build, details) => materials.register(name, build, details),
      swapped: moved => context.bus.emit('shader:swapped', { moved })
    })

    // TSL is registered here rather than by a plugin of its own because it is
    // the renderer's own language: render.js, the post-processing chain and the
    // id buffer all write it directly, so no backend can fail to build it.
    registry.register('tsl', {
      about: 'Three Shading Language — a JavaScript node graph. The renderer\'s own language: it composes, it carries its own types, and both backends build it.',
      supported: () => true
    })

    context.shaderLanguages = registry

    // What a language supports is a question about the backend, and the
    // backend is only chosen when the renderer initialises.
    context.bus.on('shell:ready', () => registry.republish())
  },

  commands: [
    {
      id: 'shader.languages',
      label: 'Every shader language, and whether the live backend can build it',
      run: context => ({
        preferred: context.shaderLanguages?.preferred || null,
        backend: context.renderer?.backend?.name || 'none — headless',
        languages: context.shaderLanguages?.languages() || []
      })
    },
    {
      id: 'shader.list',
      label: 'Every shader, the languages it is written in, and the one it is built from',
      run: context => ({ shaders: context.shaderLanguages?.list() || [] })
    },
    {
      id: 'shader.prefer',
      label: 'Prefer a shader language, and rebuild every shader that moved',
      run: (context, language) => {
        const registry = context.shaderLanguages
        if (!registry) return { error: 'Shader Languages did not load' }
        const wanted = Array.isArray(language) ? language[0] : language
        const result = registry.prefer(wanted)
        rememberPreference(result.preferred)
        return result
      }
    }
  ],

  panels: [{
    id: 'shader-languages',
    title: 'Shader Language',
    dock: 'right',
    order: 43,

    render(ui, context) {
      const registry = context.shaderLanguages
      if (!registry) return ui.empty('Shader Languages did not load')

      const languages = registry.languages()
      const shaders = registry.list()

      return ui.stack([
        ui.pick({
          options: languages.map(language => ({
            value: language.name,
            label: language.supported ? language.name : `${language.name} (cannot build)`
          })),
          value: registry.preferred,
          onChange: name => {
            const result = registry.prefer(name)
            rememberPreference(result.preferred)
            context.redraw()
          }
        }),

        ...languages.map(language => ui.fold(language.name, [
          ui.text(language.about, { dim: true }),
          language.supported ? null : ui.text(language.because, { dim: true }),
          ui.field({ k: 'shaders written in it', v: String(language.shaders) })
        ].filter(Boolean), { meta: language.supported ? 'builds' : 'cannot build' })),

        shaders.length
          ? ui.fold('shaders', shaders.map(shader => ui.field({
              k: shader.name,
              v: shader.building || 'nothing can build it'
            })), { open: true, meta: `${shaders.length}` })
          : ui.text('no shader has been registered yet', { dim: true })
      ])
    }
  }],

  inspect: [{
    title: 'Languages',
    rows: context => (context.shaderLanguages?.languages() || []).map(language => ({
      k: language.name,
      v: language.supported ? 'builds' : language.because
    }))
  }]
}
