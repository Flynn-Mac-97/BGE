/**
 * Agent Tools — the inspectable face of the tooling shelf in tools/.
 *
 * tools/ is where agent tooling lives: scripts written once, kept so nobody
 * regenerates them. This plugin lists the shelf and runs a wrapped tool on
 * demand. The generators need node's fs and zlib, so a tool runs headless —
 * in the browser it answers with the terminal command instead.
 *
 * The shelf is a registry, not a fixed list: the builtin ships the generic
 * tools, and a game registers its own in its own plugin's onLoad:
 *
 *   context.tools.register({
 *     name: 'my-textures', file: 'tools/make-my-textures.mjs',
 *     wrapped: false, makes: 'my textures', run: 'node tools/make-my-textures.mjs'
 *   })
 */
const TOOLS = [
  { name: 'sprites', file: 'tools/make-sprites.mjs', wrapped: true, makes: 'the demo sprite art (player, coin, bat, brick, ground, spike)', run: 'node tools/make-sprites.mjs' },
  { name: 'sounds', file: 'tools/make-sounds.mjs', wrapped: true, makes: 'the demo sounds (jump, coin, hurt, land)', run: 'node tools/make-sounds.mjs' }
]

let runVersion = 0

export default {
  name: 'Agent Tools',
  about: 'The tooling shelf in tools/ — scripts written once, kept so nobody regenerates them.',
  inspect: context => [
    { title: 'The shelf', rows: (context.tools?.list?.() || TOOLS).map(t => [t.name, t.makes]) }
  ],

  onLoad(context) {
    const shelf = {
      list: () => TOOLS,
      /**
       * Add one tool to the shelf, from anywhere — most often a project plugin
       * naming its own asset generators.
       */
      register(tool) {
        if (!tool?.name) throw new Error('tools.register needs a tool with a name')
        if (TOOLS.some(t => t.name === tool.name)) return TOOLS
        TOOLS.push(tool)
        return TOOLS
      }
    }
    context.tools = shelf
  },

  commands: [
    {
      id: 'tools.list',
      label: 'List the tooling shelf',
      run: context => context.tools?.list?.() || TOOLS
    },
    {
      id: 'tools.make',
      label: 'Run a tool from the shelf',
      run: async (context, name) => {
        const shelf = context.tools?.list?.() || TOOLS
        const tool = shelf.find(t => t.name === String(name ?? ''))
        if (!tool) return { error: `no tool "${name}". Try tools.list`, tools: shelf.map(t => t.name) }

        // Unwrapped tools are still one-command scripts; the shelf says how.
        if (!tool.wrapped) {
          return { tool: tool.name, run: tool.run, why: 'not wrapped as an engine command yet' }
        }
        // The generators need node (fs and zlib), so a browser page cannot run
        // them — headless can.
        if (typeof process === 'undefined' || !process.versions?.node) {
          return { tool: tool.name, run: tool.run, why: 'generators need node fs and zlib — use --headless or the terminal' }
        }

        const { main } = await import(`../../${tool.file}?make=${++runVersion}`)
        await main()
        return { ok: true, tool: tool.name, makes: tool.makes }
      }
    }
  ]
}
