/**
 * The shader language registry: names in, one implementation per language out,
 * and one place that decides which of them draws.
 *
 * Split from `shader-languages.js` because that file owns the plugin — the
 * panel, the commands, the preference — and this one owns the choosing. A plain
 * factory rather than plugin state, so a test can make one, put a language and
 * two implementations in it and ask which one it chose, with no world, no
 * renderer and no browser.
 */

/** The language the renderer itself speaks. Every backend builds it. */
export const DEFAULT_LANGUAGE = 'tsl'

/**
 * The registry.
 *
 * A plain factory rather than plugin state, so a test can make one, put a
 * language and two implementations in it and ask which one it chose, with no
 * world, no renderer and no browser.
 *
 * `backend` is a function rather than a value because the renderer does not
 * exist until the shell is ready, and what a language supports is a question
 * about the backend that ended up drawing.
 */
export function makeShaderLanguages({
  report = () => {},
  backend = () => null,
  publish = () => {},
  swapped = () => {},
  preferred = DEFAULT_LANGUAGE
} = {}) {
  const languages = new Map()
  const shaders = new Map()
  const problems = []

  /** Report a problem once. A relist must not repeat what it already said. */
  const say = message => {
    if (problems.includes(message)) return message
    problems.push(message)
    report(message)
    return message
  }

  const named = value => String(value ?? '').trim()

  /** The record for a shader, made on first mention so order never matters. */
  const recordFor = name => {
    const existing = shaders.get(name)
    if (existing) return existing
    const record = {
      name,
      kind: 'material',
      about: '',
      dimension: '',
      parameters: {},
      from: 'shader-languages',
      // Which languages it is written in. Wider than `implementations`: a
      // language plugin declares its shaders in a headless run, where it can
      // never build one, and an agent still has to be able to read that the
      // shader exists in that language.
      written: new Set(),
      implementations: new Map()
    }
    shaders.set(name, record)
    return record
  }

  const registry = {
    problems,
    say,

    /** Which language is preferred where a shader is written in several. */
    get preferred() { return preferred },

    /**
     * Add a language.
     *
     * `supported(backend)` returns true, or the reason it cannot build — the
     * reason is what the panel and `shader.languages` show, because "GLSL does
     * nothing" is a question nobody can answer from a blank surface.
     */
    register(name, { about = '', supported = () => true } = {}) {
      const key = named(name)
      if (!key) {
        say('[Shader Languages] register() needs a language name — nothing was registered')
        return null
      }
      const language = { name: key, about, supported }
      languages.set(key, language)
      // A language that arrives after its shaders — the usual order, since a
      // language plugin loads its modules asynchronously — changes what every
      // shader can be built in.
      registry.republish()
      return language
    },

    /**
     * Name a shader and its keys without implementing it.
     *
     * Separate from implementing one because describing needs no language and
     * no GPU: this is what lets `shader.list` answer in a headless run, and
     * what lets the sample shelf own its own table of defaults while two
     * language plugins own the drawing.
     */
    describe(name, details = {}) {
      const key = named(name)
      if (!key) {
        say('[Shader Languages] describe() needs a shader name — nothing was described')
        return null
      }
      const record = recordFor(key)
      if (details.kind && details.kind !== 'material' && details.kind !== 'program') {
        say(`[Shader Languages] "${key}" declared kind "${details.kind}" — only "material" and "program" exist, so it is treated as a material`)
      } else if (details.kind) {
        record.kind = details.kind
      }
      record.about = details.about ?? record.about
      record.dimension = details.dimension ?? record.dimension
      record.parameters = details.parameters ?? record.parameters
      record.from = details.from ?? record.from
      if (details.language) record.written.add(named(details.language))
      registry.publish(key)
      return record
    },

    /**
     * One shader, written in one language.
     *
     * `build` takes what the renderer hands a material builder —
     * `{ mesh, texture, tint, view, uv, parameters }` — or, for a program,
     * whatever its painter passes. The signature is the caller's business; this
     * registry only decides which of them is called.
     */
    implement(name, language, build, details = {}) {
      const key = named(name)
      const inLanguage = named(language)
      if (!key || !inLanguage) {
        say('[Shader Languages] implement() needs a shader name and a language — nothing was registered')
        return null
      }
      if (typeof build !== 'function') {
        say(`[Shader Languages] the ${inLanguage} implementation of "${key}" is not a function — it is ignored and the shader draws in whatever language it does have`)
        return null
      }
      const record = recordFor(key)
      registry.describe(key, { ...details, language: inLanguage })
      record.implementations.set(inLanguage, build)
      registry.publish(key)
      return record
    },

    /** Whether a language can build right now, or the reason it cannot. */
    supports(language) {
      const found = languages.get(named(language))
      if (!found) return `no language named "${named(language)}" is registered`
      try {
        const answer = found.supported(backend())
        return answer === true ? true : (answer || 'the language did not say why')
      } catch (error) {
        return `asking ${found.name} whether it can build failed — ${error?.message || error}`
      }
    },

    /**
     * Which implementation a shader will be built from.
     *
     * The preferred language first, then the renderer's own, then any other
     * that the backend supports. Falling back per shader rather than per
     * project is what lets a language be adopted one shader at a time.
     */
    chosen(name) {
      const record = shaders.get(named(name))
      if (!record || !record.implementations.size) return null
      const order = [preferred, DEFAULT_LANGUAGE, ...record.implementations.keys()]
      for (const language of order) {
        if (!record.implementations.has(language)) continue
        if (registry.supports(language) !== true) continue
        return { language, build: record.implementations.get(language) }
      }
      return null
    },

    /**
     * Build one named shader now. Null when nothing can build it.
     *
     * Null is the answer in every headless run and whenever a language's
     * modules have not arrived yet, and it is the caller's cue to draw
     * whatever it drew before this registry existed.
     */
    build(name, request = {}) {
      const chosen = registry.chosen(name)
      if (!chosen) return null
      const record = shaders.get(named(name))
      try {
        return chosen.build({ parameters: record.parameters, ...request })
      } catch (error) {
        say(`[Shader Languages] building "${named(name)}" in ${chosen.language} failed — ${error?.message || error}`)
        return null
      }
    },

    /**
     * Put a material shader's chosen implementation into the Materials
     * registry, under the shader's own name.
     *
     * A program is not published: the plugin that draws it asks for it by name
     * when it needs it, and there is no mesh key to name it on.
     *
     * Publishing a shader nothing can build passes null, which describes the
     * name without drawing it. The renderer has no way to give a builder back,
     * so a name that once had one keeps drawing in the language it had; every
     * swap this registry can make replaces a builder rather than removing one.
     */
    publish(name) {
      const record = shaders.get(named(name))
      if (!record || record.kind !== 'material') return
      const chosen = registry.chosen(record.name)
      publish(record.name, chosen?.build || null, {
        about: record.about,
        parameters: record.parameters,
        dimension: record.dimension,
        from: record.from,
        language: chosen?.language || null
      })
    },

    /** Publish every material shader again, after anything that changes choice. */
    republish() {
      for (const name of shaders.keys()) registry.publish(name)
    },

    /**
     * Prefer a language, and rebuild everything that moved.
     *
     * Returns the shaders whose language changed, so a command can say what
     * the swap actually did rather than only that it happened.
     */
    prefer(language) {
      const wanted = named(language) || DEFAULT_LANGUAGE
      if (!languages.has(wanted)) {
        say(`[Shader Languages] no language named "${wanted}" — registered: ${[...languages.keys()].join(', ') || 'none'}`)
        return { preferred, moved: [] }
      }
      const before = new Map([...shaders.keys()].map(name => [name, registry.chosen(name)?.language || null]))
      preferred = wanted
      const moved = []
      for (const [name, was] of before) {
        const now = registry.chosen(name)?.language || null
        if (now !== was) moved.push({ shader: name, was, now })
      }
      registry.republish()
      // A material cached by whatever built it is not rebuilt by publishing:
      // the particle painter holds its groups for the life of the page. Say
      // what moved so every such holder can drop what it cached.
      if (moved.length) swapped(moved)
      return { preferred, moved }
    },

    /** Every language, and whether it can build right now. */
    languages() {
      return [...languages.values()].map(language => {
        const support = registry.supports(language.name)
        return {
          name: language.name,
          about: language.about,
          supported: support === true,
          because: support === true ? '' : support,
          shaders: [...shaders.values()].filter(record => record.written.has(language.name)).length
        }
      }).sort((first, second) => first.name.localeCompare(second.name))
    },

    /** Every shader, what it is written in, and what it will be built from. */
    list() {
      return [...shaders.values()].map(record => ({
        name: record.name,
        kind: record.kind,
        about: record.about,
        dimension: record.dimension,
        parameters: record.parameters,
        written: [...record.written],
        buildable: [...record.implementations.keys()],
        // Null headless and until a language's modules arrive. Not a fault.
        building: registry.chosen(record.name)?.language || null
      })).sort((first, second) => first.name.localeCompare(second.name))
    },

    get: name => shaders.get(named(name)) || null,
    has: name => shaders.has(named(name))
  }

  return registry
}

