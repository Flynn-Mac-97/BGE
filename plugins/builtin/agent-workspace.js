/** Agent Workspace — a visible instruction tree and small context packets. */
import { readAgentWorkspace, resolveAgentContext } from '../../engine/agent-workspace.js'

const REGISTRY = '.engine/agents.json'
const state = {
  open: false, workspace: null, runs: [], error: null, selected: null,
  form: { scope: 'project', kind: 'instruction', id: '', title: '', parent: 'project' }
}

const reader = context => (scope, file) => context.files.readAgent(scope, file)
const pluginNodes = context => context.files.agentPlugins()
const packetFor = async (context, request) => resolveAgentContext(
  reader(context), request, await pluginNodes(context), context.editor.projectDirectory,
  (scope, file) => context.files.agentInterface(scope, file))

async function readRegistry(context) {
  try {
    const value = JSON.parse(await context.files.read(REGISTRY))
    return Array.isArray(value.runs) ? value.runs : []
  } catch { return [] }
}

async function refresh(context) {
  try {
    state.workspace = await readAgentWorkspace(reader(context), await pluginNodes(context))
    state.runs = await readRegistry(context)
    state.error = null
  } catch (error) { state.error = String(error?.message || error) }
  context.redraw?.()
}

async function setSkill(context, id, enabled) {
  const file = 'agents/settings.json'
  let settings = { disabled: [] }
  try { settings = JSON.parse(await context.files.readAgent('project', file)) } catch { /* first setting */ }
  const disabled = new Set(settings.disabled || [])
  if (enabled) disabled.delete(id); else disabled.add(id)
  await context.files.writeAgent('project', file, JSON.stringify({ disabled: [...disabled].sort() }, null, 2) + '\n')
  await refresh(context)
}

async function createNode(context, value = state.form) {
  const scope = value.scope === 'engine' ? 'engine' : 'project'
  const kind = value.kind === 'skill' ? 'skill' : 'instruction'
  const id = String(value.id || '').trim().toLowerCase()
  const title = String(value.title || id).trim()
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('id needs lowercase words joined by hyphens')
  if (!title) throw new Error('title is required')
  if (state.workspace.nodes.some(node => node.id === id)) throw new Error(`node "${id}" already exists`)

  const manifestFile = 'agents/manifest.json'
  const manifest = JSON.parse(await context.files.readAgent(scope, manifestFile))
  const file = kind === 'skill' ? `agents/skills/${id}/SKILL.md` : `agents/${id}.md`
  const node = { id, title, kind, parent: value.parent || (kind === 'skill' ? 'skills' : 'project'), file }
  if (kind === 'skill') node.optional = true
  manifest.nodes.push(node)

  const text = kind === 'skill'
    ? `---\nname: ${id}\ndescription: Explain when an agent should use this skill.\n---\n\n# ${title}\n\n1. Read the task.\n2. Do the work.\n3. Check the result.\n`
    : `# ${title}\n\n- Add short rules here.\n- Use plain words.\n- Say how to check the work.\n`
  await context.files.writeAgent(scope, file, text)
  await context.files.writeAgent(scope, manifestFile, JSON.stringify(manifest, null, 2) + '\n')
  state.form.id = ''
  state.form.title = ''
  await refresh(context)
  context.bus.emit('open:agent-file', { scope, path: file })
  return node
}

function openNode(context, node) {
  state.selected = node.id
  if (node.file) context.bus.emit('open:agent-file', { scope: node.scope, path: node.file })
  context.redraw()
}

export default {
  name: 'Agent Workspace',

  category: 'agents',
  onLoad(context) {
    context.agents = {
      context: request => packetFor(context, request),
      status: async () => ({ workspace: await readAgentWorkspace(reader(context), await pluginNodes(context)), runs: await readRegistry(context) })
    }
    refresh(context)
    context.bus.on('files:written', ({ path }) => {
      if (path === REGISTRY || path.startsWith('agents/')) refresh(context)
    })
  },

  menus: [{
    id: 'agents.browse', label: 'AGENTS', title: 'Build the agent instruction tree', on: () => state.open,
    run: context => { state.open = !state.open; if (state.open) refresh(context); context.redraw() }
  }],

  panels: [{
    id: 'agent-workspace', title: 'Agent Workspace', dock: 'centre', order: 30, when: () => state.open,
    actions: [
      { label: 'Refresh', run: refresh },
      { label: 'Close ×', run: context => { state.open = false; context.redraw() } }
    ],
    render(ui, context) {
      if (state.error) return ui.stack([ui.text(state.error), ui.text('Check agents/manifest.json and project/agents/manifest.json.', { dim: true })])
      if (!state.workspace) return ui.empty('reading agent tree…')

      const active = state.runs.filter(run => run.status === 'active')
      const parents = state.workspace.nodes.filter(node => node.kind === 'group' || node.kind === 'document')
      return ui.stack([
        ui.section(`Instructions · ${state.workspace.nodes.length}`, [
          ui.tree({
            nodes: state.workspace.nodes,
            selected: state.selected,
            row: (node, childCount) => [
              ui.glyph(node.kind === 'skill' ? (node.enabled ? '✓' : '○') : childCount ? '›' : '·'),
              ui.label(node.title || node.id),
              ui.spacer(),
              node.kind === 'skill'
                ? ui.button(node.enabled ? 'On' : 'Off', event => {
                    event.stopPropagation()
                    setSkill(context, node.id, !node.enabled).catch(error => {
                      state.error = String(error?.message || error); context.redraw()
                    })
                  })
                : ui.meta(node.override ? `overrides ${node.override}` : node.file ? `${node.characters} chars` : node.kind)
            ],
            onPick: node => openNode(context, node)
          }),
          state.workspace.problems.length ? ui.text(state.workspace.problems.join(' · ')) : null
        ]),

        ui.section('Add a branch', [
          ui.row([
            ui.pick({ value: state.form.scope, options: ['project', 'engine'], onChange: value => { state.form.scope = value } }),
            ui.pick({ value: state.form.kind, options: ['instruction', 'skill'], onChange: value => { state.form.kind = value; state.form.parent = value === 'skill' ? 'skills' : 'project' } })
          ]),
          ui.field({ k: 'id', v: state.form.id, onChange: value => { state.form.id = value } }),
          ui.field({ k: 'title', v: state.form.title, onChange: value => { state.form.title = value } }),
          ui.pick({
            value: state.form.parent,
            options: parents.map(node => ({ value: node.id, label: node.title })),
            onChange: value => { state.form.parent = value }
          }),
          ui.button('Add branch', () => createNode(context).catch(error => {
            state.error = String(error?.message || error); context.redraw()
          }), { primary: true })
        ]),

        ui.section(`Active work · ${active.length}`, [
          ui.list({ items: active, key: run => run.id, row: run => [ui.glyph('•'), ui.label(run.id), ui.meta(run.task), ui.spacer(), ui.meta(run.mode)], emptyText: 'no active work' })
        ]),
        ui.text('Small edit: current workspace. Parallel writers: separate worktrees.', { dim: true })
      ])
    }
  }],

  commands: [
    { id: 'agent.context', label: 'Build a small instruction packet', run: packetFor },
    { id: 'agent.status', label: 'Read the agent tree and runs', run: async context => ({ workspace: await readAgentWorkspace(reader(context), await pluginNodes(context)), runs: await readRegistry(context) }) },
    { id: 'agent.toggle', label: 'Turn an optional skill on or off', run: (context, value) => setSkill(context, value.id || value[0], value.enabled ?? value[1]) },
    { id: 'agent.create', label: 'Add an instruction or skill', run: (context, value) => createNode(context, value) }
  ]
}
