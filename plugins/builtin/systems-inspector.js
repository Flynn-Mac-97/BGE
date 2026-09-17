import { createSystemsWorkspace } from './systems-inspector/workspace.js'
import { coreFilesMap } from './systems-inspector/core-files.js'
import { functionMap } from './systems-inspector/function-map.js'
import { createCallInspector } from './systems-inspector/call-inspector.js'
import { inspectArchitecture } from './systems-inspector/architecture.js'
import { inspectFlow, findNode } from './systems-inspector/model.js'

function createInspector(context) {
  const state = { open: false, fullscreen: true, phase: 'architecture', selected: 'boot', expanded: new Set(), text: '', line: 1, status: '', file: '', generation: 0 }
  const model = () => state.phase === 'architecture' ? (state.catalog ? coreFilesMap(state.catalog, inspectArchitecture(context).plugins, state.mapMode || 'calls') : inspectArchitecture(context)) : inspectFlow(context, state.phase)
  const refresh = () => context.redraw()
  async function catalog() {
    if (!context.files.sourceCatalog) return
    state.catalog = await context.files.sourceCatalog()
    if (state.phase === 'architecture' && !findNode(model(), state.selected)) state.selected = 'file:engine/index.js'
  }
  const calls = createCallInspector(context, state, refresh)
  async function select(id, fullFile = false) {
    const node = findNode(model(), id)
    if (!node) throw new Error(`no flow node: ${id}`)
    state.callView = false
    state.analysis = null
    state.sourceRef = node.source
    state.selected = id
    const generation = ++state.generation
    state.file = node.source ? `${node.source.scope === 'project' ? 'project/' : ''}${node.source.file}` : 'Loaded function'
    state.line = 1
    state.text = ''
    state.status = 'Reading source…'
    refresh()
    try {
      if (node.code && !fullFile) {
        state.text = node.code
        state.status = 'Loaded function body. Line numbers are local to this excerpt.'
      } else if (node.source) {
        const result = await context.files.readSource(node.source.scope, node.source.file)
        if (generation !== state.generation) return
        const lines = result.text.split('\n')
        const found = node.source.anchor ? lines.findIndex(line => line.includes(node.source.anchor)) : 0
        state.line = found < 0 ? 1 : found + 1
        state.text = result.text
        state.status = !node.source.anchor ? 'Current source file.' : found < 0 ? 'Source anchor moved; showing the full current file.' : 'Current source file. Highlight marks the selected entry point.'
      } else {
        state.status = 'No source file was recorded for this node.'
      }
    } catch (error) {
      if (generation !== state.generation) return
      state.status = `Could not read source: ${error.message}`
    }
    if (generation === state.generation) refresh()
    return { id, file: state.file, line: state.line, text: state.text, status: state.status }
  }
  return {
    state, model, select, calls,
    connections(mode = 'calls') {
      if (!['calls', 'imports'].includes(mode)) throw new Error('connections must be calls or imports')
      state.mapMode = mode; state.callView = false; refresh(); return model()
    },
    fullscreen(value = true) { state.fullscreen = !!value; refresh(); return { fullscreen: state.fullscreen } },
    async open() { state.open = true; await catalog(); return select(state.selected) },
    close() { state.open = false; ++state.generation; refresh(); return { open: false } },
    async phase(value) {
      if (value !== 'architecture') inspectFlow(context, value)
      state.phase = value
      state.selected = value === 'architecture' ? (state.catalog ? 'file:engine/index.js' : 'boot') : value === 'fixed' ? 'positions' : 'frame'
      return select(state.selected)
    },
    expand(id) {
      if (!findNode(model(), id)) throw new Error(`no flow node: ${id}`)
      if (state.expanded.has(id)) state.expanded.delete(id)
      else state.expanded.add(id)
      refresh()
      return { expanded: [...state.expanded] }
    },
    async refresh() {
      await catalog()
      if (!findNode(model(), state.selected)) state.selected = state.phase === 'architecture' ? 'boot' : state.phase === 'fixed' ? 'positions' : 'frame'
      return select(state.selected)
    }
  }
}

export default {
  name: 'Systems Inspector',
  category: 'editor',
  about: 'Inspect code-derived systems, draft architecture diagrams, export AI implementation briefs, and edit JavaScript functions as visual flows. The analysis toolkit is independent of the host engine.',
  lifecycle: 'scoped',
  provides: ['systems.workspace'],
  requires: ['editor.code', 'editor.diagram', 'graph.layout'],
  onLoad(context, scope) {
    context.systemsInspector = createInspector(context)
    context.systemsWorkspace = createSystemsWorkspace(context, scope ? {
      code: scope.require('editor.code'), diagram: scope.require('editor.diagram'), layout: scope.require('graph.layout')
    } : {})
    const listen = scope ? scope.on : context.bus.on
    if (scope) {
      const inspector = context.systemsInspector, workspace = context.systemsWorkspace
      scope.provide('systems.workspace', workspace)
      scope.defer(() => {
        inspector.state.open = false; workspace.dispose()
        if (context.systemsInspector === inspector) delete context.systemsInspector
        if (context.systemsWorkspace === workspace) delete context.systemsWorkspace
      })
    }
    listen('plugins:changed', () => {
      // Registry changes are read afresh; no simulation function is wrapped or replaced.
      if (context.systemsInspector.state.open) context.systemsInspector.refresh()
    })
    listen('shell:ready',()=>{
      if(typeof window!=='undefined'&&new URLSearchParams(window.location.hash.slice(1)).has('systems'))context.systemsWorkspace.safe(()=>context.systemsWorkspace.open())
    })
    if(typeof window!=='undefined'&&scope){
      const workspace=context.systemsWorkspace
      const navigate=()=>{
        const mode=new URLSearchParams(window.location.hash.slice(1)).get('systems')
        if(['inspect','code','design','script'].includes(mode))workspace.safe(()=>workspace.state.open?workspace.mode(mode):workspace.open(mode))
      }
      window.addEventListener('hashchange',navigate)
      scope.defer(()=>window.removeEventListener('hashchange',navigate))
    }
  },
  menus: [{ id: 'systems.open', label: 'SYSTEMS', title: 'Inspect engine flow and code',
    on: context => context.systemsWorkspace.state.open,
    run: context => context.systemsWorkspace.safe(() => context.systemsWorkspace.state.open ? context.systemsWorkspace.close() : context.systemsWorkspace.open()) }],
  panels: [{
    id: 'systems-inspector', title: 'Systems · flow and source', dock: 'centre', order: 15, scroll: false,
    when: context => context.systemsWorkspace.state.open || context.systemsInspector.state.open,
    actions: [{ label: 'Close ×', run: context => context.systemsInspector.close() }],
    render(ui, context) {
      if (context.systemsWorkspace.state.open) return context.systemsWorkspace.render()
      const inspector = context.systemsInspector
      const state = inspector.state
      const graph = inspector.model()
      const selected = findNode(graph, state.selected)
      const expandedMap = state.callView ? functionMap(state.analysis, state.file, state.callSelection) : null
      const selectMapNode = async id => {
        await inspector.select(id, true)

      }
      const followFunction = id => {
        const action = expandedMap.nodes.find(node => node.id === id)?.action
        if (!action) return
        if ('function' in action) return inspector.calls.select(action.function)
        if (action.definition) return inspector.calls.definition(action.definition)
        return inspector.calls.site(action.site)
      }
      return ui.flowInspector({
        mapMode: state.mapMode || 'calls',
        onMapMode: state.catalog && state.phase === 'architecture' ? mode => inspector.connections(mode) : null,
        fullscreen: state.fullscreen, onFullscreen: () => inspector.fullscreen(!state.fullscreen), onClose: () => inspector.close(),
        calls: state.callView ? { ...(state.analysis || { functions: [], calls: [] }), selected: state.callSelection,
          onFunction: id => inspector.calls.select(id), onSite: id => inspector.calls.site(id), onDefinition: id => inspector.calls.definition(id) } : null,
        onCalls: state.sourceRef ? () => inspector.calls.open() : null,
        onBack: state.callView && inspector.calls.canBack ? () => inspector.calls.back() : null,
        onCodeLine: state.callView ? line => inspector.calls.line(line) : null,
        architecture: expandedMap || (state.phase === 'architecture' ? graph : null),
        mapSelected: expandedMap ? 'focus' : state.selected,
        onMapSelect: expandedMap ? followFunction : selectMapNode,
        onMapSite: async id => {
          if (expandedMap) return inspector.calls.site(id)
          const [file, line] = id.split('#')
          await inspector.select(file, true)
          state.line = Number(line)
          context.redraw()
        },
        dependencies: (selected?.dependencies || []).map(name => ({ name, exists: !!findNode(graph, `plugin:${name}`) })),
        phase: state.phase, onPhase: value => inspector.phase(value),
        nodes: graph.nodes, selected: state.selected, expanded: state.expanded,
        onSelect: id => inspector.select(id), onExpand: id => inspector.expand(id),
        onRefresh: () => inspector.refresh(), onFile: selected?.source ? () => inspector.select(state.selected, true) : null,
        basis: expandedMap ? expandedMap.note : graph.basis, detail: state.callView ? 'Static calls and source locations. Use the map tabs to return to systems.' : selected?.detail || 'Select a node.',
        title: state.callView ? (state.analysis?.functions.find(item => item.id === state.callSelection)?.name || 'Module top level') : selected?.title || '', file: state.file, source: state.text, line: state.line, status: state.status
      })
    }
  }],
  commands: [
    { id:'systems.mode', label:'Open a workspace mode', run:async(context,mode)=>{if(!context.systemsWorkspace.state.open)await context.systemsWorkspace.open(mode);return context.systemsWorkspace.mode(mode)} },
    { id:'systems.scan', label:'Scan source', run:context=>context.systemsWorkspace.scan() },
    { id:'systems.workspace', label:'Workspace status', run:context=>context.systemsWorkspace.summary() },
    { id:'systems.graph', label:'Read visible source or design graph', run:context=>context.systemsWorkspace.graph() },
    { id:'systems.filter', label:'Filter source graph', run:(context,values)=>context.systemsWorkspace.filter(values) },
    { id:'systems.inspect', label:'Select a workspace node', run:(context,id)=>context.systemsWorkspace.select(id) },
    { id:'systems.inspectEdge', label:'Select a connection and source line', run:(context,id)=>context.systemsWorkspace.edge(id) },
    { id:'systems.analyze', label:'Analyze code or design', run:context=>context.systemsWorkspace.findings() },
    { id:'systems.design.new', label:'Create a diagram', run:(context,title)=>context.systemsWorkspace.new(title) },
    { id:'systems.design.list', label:'List saved diagrams', run:context=>context.systemsWorkspace.list() },
    { id:'systems.design.open', label:'Open saved diagram', run:(context,id)=>context.systemsWorkspace.load(id) },
    { id:'systems.design.restore', label:'Restore previous saved revision', run:(context,id)=>context.systemsWorkspace.load(id,true) },
    { id:'systems.design.edit', label:'Apply a diagram edit', run:(context,edit)=>context.systemsWorkspace.edit(edit) },
    { id:'systems.design.save', label:'Save diagram', run:context=>context.systemsWorkspace.save() },
    { id:'systems.design.saveCopy', label:'Save diagram copy', run:context=>context.systemsWorkspace.save(true) },
    { id:'systems.design.discard', label:'Discard unsaved diagram edits', run:context=>context.systemsWorkspace.discard() },
    { id:'systems.design.undo', label:'Undo diagram edit', run:context=>context.systemsWorkspace.undo() },
    { id:'systems.design.redo', label:'Redo diagram edit', run:context=>context.systemsWorkspace.redo() },
    { id:'systems.design.import', label:'Import portable diagram', run:(context,value)=>context.systemsWorkspace.import(value) },
    { id:'systems.design.export', label:'Export JSON SVG Mermaid or brief', run:(context,format)=>context.systemsWorkspace.export(format) },
    { id:'systems.design.fromCode', label:'Draft current code graph', run:context=>context.systemsWorkspace.fromCode() },
    { id:'systems.focusFunction', label:'Reveal a function in the open source file', run:(context,start)=>context.systemsWorkspace.focusFunction(Number(start)) },
    { id:'systems.script.open', label:'Load source function as visual flow', run:(context,start)=>context.systemsWorkspace.visual(start) },
    { id:'systems.script.edit', label:'Edit selected flow node', run:(context,values)=>context.systemsWorkspace.flowEdit(values) },
    { id:'systems.script.add', label:'Add visual script node', run:(context,kind)=>context.systemsWorkspace.flowAdd(kind) },
    { id:'systems.script.connect', label:'Connect visual script nodes', run:(context,edge)=>{context.systemsWorkspace.state.flowPort=edge.port;return context.systemsWorkspace.connect(edge.from,edge.to)} },
    { id:'systems.script.preview', label:'Generate source preview', run:context=>context.systemsWorkspace.previewFlow() },
    { id:'systems.source.edit', label:'Edit source buffer', run:(context,text)=>context.systemsWorkspace.editSource(text) },
    { id:'systems.source.apply', label:'Apply validated source buffer', run:context=>context.systemsWorkspace.applySource() },

    { id: 'systems.connections', label: 'Show call or import connections on the map', run: (context, mode) => context.systemsInspector.connections(mode) },
    { id: 'systems.calls', label: 'Inspect functions in source', run: context => context.systemsInspector.calls.open() },
    { id: 'systems.function', label: 'Select a function', run: (context, id) => context.systemsInspector.calls.select(id) },
    { id: 'systems.callSite', label: 'Jump to a call site', run: (context, id) => context.systemsInspector.calls.site(id) },
    { id: 'systems.definition', label: 'Follow a function definition', run: (context, id) => context.systemsInspector.calls.definition(id) },
    { id: 'systems.back', label: 'Return to previous source', run: context => context.systemsInspector.calls.back() },
    { id: 'systems.line', label: 'Inspect function at source line', run: (context, line) => context.systemsInspector.calls.line(Number(line)) },
    { id: 'systems.open', label: 'Open Systems Workspace', run: context => context.systemsWorkspace.open() },
    { id: 'systems.close', label: 'Close Systems Workspace', run: context => { context.systemsInspector.close(); return context.systemsWorkspace.close() } },
    { id: 'systems.map', label: 'Read systems relationships', run: context => context.systemsInspector.model() },
    { id: 'systems.fullscreen', label: 'Expand or dock inspector', run: (context, value) => context.systemsInspector.fullscreen(value) },
    { id: 'systems.flow', label: 'Read current flow', run: (context, phase) => inspectFlow(context, phase || 'fixed') },
    { id: 'systems.phase', label: 'Choose flow phase', run: (context, phase) => context.systemsInspector.phase(phase) },
    { id: 'systems.select', label: 'Inspect a node', run: (context, id) => context.systemsInspector.select(id) },
    { id: 'systems.expand', label: 'Expand a flow node', run: (context, id) => context.systemsInspector.expand(id) },
    { id: 'systems.source', label: 'Read a node source file', run: (context, id) => context.systemsInspector.select(id, true) },
    { id: 'systems.refresh', label: 'Refresh the inspector', run: context => context.systemsInspector.refresh() }
  ]
}
